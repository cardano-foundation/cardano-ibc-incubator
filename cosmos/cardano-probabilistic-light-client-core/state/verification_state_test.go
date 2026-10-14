package state

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/gaskv"
	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/ledger/common"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func compactTrustedFixture(t *testing.T, count int) (*ClientState, *ConsensusState) {
	t.Helper()
	file, err := os.Open("../testdata/native-recovery.json.gz")
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()
	var fixture struct {
		Client    *ClientState
		Consensus *ConsensusState
	}
	require.NoError(t, json.NewDecoder(reader).Decode(&fixture))
	cs := fixture.Client
	for i := len(cs.EpochStakeDistribution); i < count; i++ {
		hash := sha256.Sum256([]byte(fmt.Sprintf("compact-registry-%d", i)))
		binding := &PoolRegistrationBinding{PoolId: common.PoolId(hash[:28]).String(), VrfKeyHash: hash[:], FirstRegistrationSlot: 1}
		cs.LatestCheckpointPoolRegistry.Pools = append(cs.LatestCheckpointPoolRegistry.Pools, &PoolRegistrationRecord{Registration: binding, Registered: true})
		cs.LatestCheckpointPoolRegistry.Mark = append(cs.LatestCheckpointPoolRegistry.Mark, binding)
		cs.LatestCheckpointPoolRegistry.Effective = append(cs.LatestCheckpointPoolRegistry.Effective, binding)
		cs.EpochStakeDistribution = append(cs.EpochStakeDistribution, &StakeDistributionEntry{PoolId: binding.PoolId, Stake: 1, VrfKeyHash: binding.VrfKeyHash, FirstRegistrationSlot: 1})
	}
	var total uint64
	for _, row := range cs.EpochStakeDistribution {
		total += row.Stake
	}
	for _, row := range cs.EpochStakeDistribution {
		row.RelativeStakeNumerator = row.Stake
		row.RelativeStakeDenominator = total
	}
	cs.EpochContexts[0].StakeDistribution = cs.EpochStakeDistribution
	fixture.Consensus.PoolRegistry = clonePoolRegistry(cs.LatestCheckpointPoolRegistry)
	return cs, fixture.Consensus
}

func TestCompactPublicStateAndFreezeWith4000Pools(t *testing.T) {
	client, consensus := compactTrustedFixture(t, 4000)
	meter := storetypes.NewInfiniteGasMeter()
	shared := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	private := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	ctx := Context{Time: time.Unix(0, int64(consensus.Timestamp)), Height: 1, SelfHeight: NewHostHeight(0, 1), GasConsumed: meter.GasConsumed, ConsumeGas: meter.ConsumeGas, Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	thin, compact, err := EnableSharedSnapshots(ctx, cdc, private, client, consensus)
	require.NoError(t, err)
	require.LessOrEqual(t, len(cdc.EncodeClient(thin)), MaxCompactClientBytes)
	require.LessOrEqual(t, len(cdc.EncodeConsensus(compact)), MaxCompactConsensusBytes)
	require.NoError(t, thin.Validate())
	require.NoError(t, compact.ValidateBasic())
	checkpoint, _, err := currentVerificationCheckpoint(ctx, thin)
	require.NoError(t, err)
	key, err := poolKey(client.EpochStakeDistribution[0].PoolId)
	require.NoError(t, err)
	pool, found, err := lookupBinding(shared, checkpoint.Scope, checkpoint.Registry.Effective, key)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, client.EpochStakeDistribution[0].VrfKeyHash, pool.VrfKeyHash)
	start := meter.GasConsumed()
	thin.UpdateStateOnMisbehaviour(ctx, cdc, private, nil)
	require.Less(t, meter.GasConsumed()-start, uint64(1000000), "freezing must not read or rewrite the registry")
	frozen, found := GetClientState(private, cdc)
	require.True(t, found)
	require.Equal(t, Frozen, frozen.Status(ctx, private, cdc))
	require.Equal(t, thin.CheckpointReference, frozen.CheckpointReference)
}

func TestSharedSnapshotOwnershipAcrossClients(t *testing.T) {
	client, consensus := compactTrustedFixture(t, 13)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{Time: time.Unix(0, int64(consensus.Timestamp)), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	first := dbadapter.Store{DB: dbm.NewMemDB()}
	second := dbadapter.Store{DB: dbm.NewMemDB()}
	cdc := jsonTestCodec{}
	a, _, err := EnableSharedSnapshots(ctx, cdc, first, client, consensus)
	require.NoError(t, err)
	b, _, err := EnableSharedSnapshots(ctx, cdc, second, client, consensus)
	require.NoError(t, err)
	require.NotEqual(t, a.StorageNamespace, b.StorageNamespace)
	require.Equal(t, a.CheckpointReference, b.CheckpointReference)
	checkpoint, _, err := currentVerificationCheckpoint(ctx, a)
	require.NoError(t, err)
	mapStore := NewSnapshotMap(shared, checkpoint.Scope, snapshotRegistry)
	// Dropping one owner's root must not delete the second client's pages.
	require.NoError(t, mapStore.Pin(append(namespaceOwner(a.StorageNamespace, a.VerificationGeneration, 1, nil), 1), SnapshotRoot{}))
	for i := 0; i < 8; i++ {
		_, err = mapStore.Collect(8)
		require.NoError(t, err)
	}
	key, err := poolKey(client.EpochStakeDistribution[0].PoolId)
	require.NoError(t, err)
	_, present, err := mapStore.Lookup(checkpoint.Registry.Records, key)
	require.NoError(t, err)
	require.True(t, present)
}

func TestLazyProductionProjectionMatchesLegacyRules(t *testing.T) {
	store := dbadapter.Store{DB: dbm.NewMemDB()}
	scope := [32]byte{3}
	key := bytes.Repeat([]byte{2}, 28)
	name, _ := poolName(key)
	legacy := &PoolProductionRecord{PoolId: name, CompletedEpochsBitmap: 0b10001, ProducedCurrentEpoch: true}
	root, err := NewSnapshotMap(store, scope, snapshotProduction).Put(SnapshotRoot{}, key, encodeProduction(10, legacy))
	require.NoError(t, err)
	for distance := uint64(0); distance <= 7; distance++ {
		copy := *legacy
		records := map[string]*PoolProductionRecord{name: &copy}
		require.NoError(t, advanceProductionEpoch(records, 10, 10+distance))
		got, err := lookupProduction(store, scope, root, key, 10+distance)
		require.NoError(t, err)
		want := records[name]
		if want == nil {
			want = &PoolProductionRecord{PoolId: name}
		}
		require.Equal(t, want, got)
	}
}

func TestBoundedTrustedBootstrapImport4000Pools(t *testing.T) {
	client, consensus := compactTrustedFixture(t, 4000)
	temporary := dbadapter.Store{DB: dbm.NewMemDB()}
	compact, initial, steps, err := BuildCompactBootstrap(temporary, client, consensus)
	require.NoError(t, err)
	require.Greater(t, len(steps), 20)
	meter := storetypes.NewInfiniteGasMeter()
	shared := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	private := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	ctx := Context{Time: time.Unix(0, int64(consensus.Timestamp)), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }, ConsumeGas: meter.ConsumeGas, GasConsumed: meter.GasConsumed}
	cdc := jsonTestCodec{}
	require.NoError(t, compact.Initialize(ctx, cdc, private, initial))
	fresh, found := GetClientState(private, cdc)
	require.True(t, found)
	require.True(t, fresh.BootstrapPending)
	require.Equal(t, Active, fresh.Status(ctx, private, cdc))
	for _, step := range steps {
		start := meter.GasConsumed()
		runObservationStep(t, ctx, cdc, private, fresh, step)
		require.Less(t, meter.GasConsumed()-start, MaxOperationGas)
	}
	require.False(t, fresh.BootstrapPending)
	cp, _, err := currentVerificationCheckpoint(ctx, fresh)
	require.NoError(t, err)
	require.Equal(t, uint64(4000), cp.Stake.Root.Rows)
	require.Equal(t, compact.CheckpointReference, fresh.CheckpointReference)
}
