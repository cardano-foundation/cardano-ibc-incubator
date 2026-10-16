package state

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"sort"
	"testing"

	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/gaskv"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func snapshotTestChanges(count int) []SnapshotChange {
	changes := make([]SnapshotChange, count)
	for i := range changes {
		hash := sha256.Sum256([]byte(fmt.Sprintf("snapshot-test-pool-%d", i)))
		changes[i] = SnapshotChange{bytes.Clone(hash[:28]), bytes.Repeat([]byte{byte(i)}, 80)}
	}
	sort.Slice(changes, func(i, j int) bool { return bytes.Compare(changes[i].Key, changes[j].Key) < 0 })
	return changes
}
func TestSnapshotMapChunkingAndSelectiveUpdates(t *testing.T) {
	meter := storetypes.NewInfiniteGasMeter()
	raw := dbadapter.Store{DB: dbm.NewMemDB()}
	var io []StoreIO
	store := TraceStore(gaskv.NewStore(raw, meter, storetypes.KVGasConfig()), meter.GasConsumed, func(record StoreIO) { io = append(io, record) })
	scope := sha256.Sum256([]byte("client configuration"))
	tree := NewSnapshotMap(store, scope, 1)
	changes := snapshotTestChanges(4000)
	root, err := tree.PutBatch(SnapshotRoot{}, changes)
	require.NoError(t, err)
	require.NoError(t, tree.Pin([]byte("historical checkpoint"), root))
	var staged SnapshotRoot
	for i := 0; i < len(changes); i += 73 {
		last := i + 73
		if last > len(changes) {
			last = len(changes)
		}
		staged, err = tree.PutBatch(staged, changes[i:last])
		require.NoError(t, err)
	}
	require.Equal(t, root, staged, "logical state must not depend on the size of input batches")
	require.NoError(t, tree.Pin([]byte("current checkpoint"), root))
	io = nil
	fresh := NewSnapshotMap(store, scope, 1)
	index := 2500
	replacement := bytes.Repeat([]byte{0xA5}, 80)
	next, err := fresh.Put(root, changes[index].Key, replacement)
	require.NoError(t, err)
	require.NoError(t, fresh.Pin([]byte("current checkpoint"), next))
	var written uint64
	for _, record := range io {
		written += record.WriteBytes
	}
	require.Less(t, written, uint64(64*1024), "one producer change must not rewrite a 4000-pool map")
	value, found, err := fresh.Lookup(root, changes[index].Key)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, changes[index].Value, value)
	value, found, err = fresh.Lookup(next, changes[index].Key)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, replacement, value)
	io = nil
	fresh = NewSnapshotMap(store, scope, 1)
	var visited [][]byte
	n, err := fresh.Visit(next, changes[3900].Key, 4, func(key, value []byte) error { visited = append(visited, key); return nil })
	require.NoError(t, err)
	require.Equal(t, 4, n)
	require.Equal(t, changes[3901].Key, visited[0])
	reads := 0
	for _, record := range io {
		if record.Operation == "get" {
			reads++
		}
	}
	require.Less(t, reads, 16, "a late iteration cursor must not reread all earlier pages")
	wrong := NewSnapshotMap(store, scope, 2)
	_, _, err = wrong.Lookup(next, changes[index].Key)
	require.Error(t, err, "references bind record kind")
	wrong = NewSnapshotMap(store, sha256.Sum256([]byte("other configuration")), 1)
	_, _, err = wrong.Lookup(next, changes[index].Key)
	require.Error(t, err, "references bind configuration")
}

func TestSnapshotMapSharedPagesSurviveBoundedCleanup(t *testing.T) {
	store := dbadapter.Store{DB: dbm.NewMemDB()}
	scope := sha256.Sum256([]byte("cleanup"))
	tree := NewSnapshotMap(store, scope, 3)
	changes := snapshotTestChanges(64)
	old, err := tree.PutBatch(SnapshotRoot{}, changes)
	require.NoError(t, err)
	require.NoError(t, tree.Pin([]byte("old checkpoint"), old))
	current, err := tree.Put(old, changes[0].Key, []byte("new"))
	require.NoError(t, err)
	require.NoError(t, tree.Pin([]byte("session"), current))
	for i := 0; i < 20; i++ {
		_, err = tree.Collect(3)
		require.NoError(t, err)
	}
	_, present, err := NewSnapshotMap(store, scope, 3).Lookup(old, changes[0].Key)
	require.NoError(t, err)
	require.True(t, present)
	require.NoError(t, tree.Pin([]byte("old checkpoint"), SnapshotRoot{}))
	for i := 0; i < 30; i++ {
		_, err = tree.Collect(3)
		require.NoError(t, err)
	}
	value, present, err := NewSnapshotMap(store, scope, 3).Lookup(current, changes[10].Key)
	require.NoError(t, err)
	require.True(t, present)
	require.Equal(t, changes[10].Value, value)
	_, _, err = NewSnapshotMap(store, scope, 3).Lookup(old, changes[0].Key)
	require.Error(t, err)
	require.NoError(t, tree.Pin([]byte("session"), SnapshotRoot{}))
	for i := 0; i < 50; i++ {
		_, err = tree.Collect(3)
		require.NoError(t, err)
	}
	_, _, err = NewSnapshotMap(store, scope, 3).Lookup(current, changes[10].Key)
	require.Error(t, err)
}

func TestSnapshotMapCanonicalCollapseAndRecordLimits(t *testing.T) {
	store := dbadapter.Store{DB: dbm.NewMemDB()}
	tree := NewSnapshotMap(store, [32]byte{1}, 4)
	changes := snapshotTestChanges(30)
	root, err := tree.PutBatch(SnapshotRoot{}, changes)
	require.NoError(t, err)
	for _, c := range changes[5:] {
		root, err = tree.Put(root, c.Key, nil)
		require.NoError(t, err)
	}
	want, err := tree.PutBatch(SnapshotRoot{}, changes[:5])
	require.NoError(t, err)
	require.Equal(t, want, root)
	_, err = tree.Put(root, changes[0].Key, make([]byte, SnapshotRecordBytes+1))
	require.Error(t, err)
	_, err = tree.PutBatch(root, []SnapshotChange{changes[0], changes[0]})
	require.Error(t, err)
}
