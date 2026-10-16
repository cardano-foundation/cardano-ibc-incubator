package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sort"

	storetypes "cosmossdk.io/store/types"
)

const (
	SnapshotPageBytes   = 4096
	SnapshotRecordBytes = 256
	SnapshotLeafRows    = 14
	SnapshotKeyBytes    = 32
	SnapshotMaxDepth    = 2 * SnapshotKeyBytes
)

// SnapshotMap is a bounded persistent radix tree in the destination store.
// Roots are supplied by authenticated checkpoints, never by record witnesses.
// Every changed path is copied. Existing pages are never overwritten.
type SnapshotMap struct {
	store storetypes.KVStore
	scope [32]byte
	kind  byte
	cache map[[32]byte]*snapshotPage
}

type snapshotEntry struct{ Key, Value []byte }
type snapshotChild struct {
	Hash [32]byte
	Rows uint64
}
type snapshotPage struct {
	Depth    byte
	Entries  []snapshotEntry
	Children *[16]snapshotChild
	Rows     uint64
}
type SnapshotRoot struct {
	Hash [32]byte
	Rows uint64
}

func NewSnapshotMap(store storetypes.KVStore, scope [32]byte, kind byte) *SnapshotMap {
	return &SnapshotMap{store: store, scope: scope, kind: kind, cache: make(map[[32]byte]*snapshotPage)}
}
func (m *SnapshotMap) key(hash [32]byte) []byte {
	key := append([]byte("snapshots/v2/pages/"), m.scope[:]...)
	key = append(key, m.kind)
	return append(key, hash[:]...)
}
func (m *SnapshotMap) digest(raw []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte("cardano-ibc.snapshot-page/v2\x00"))
	h.Write(m.scope[:])
	h.Write([]byte{m.kind})
	h.Write(raw)
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum
}
func snapshotNibble(key []byte, depth int) byte {
	if depth/2 >= len(key) {
		return 0
	}
	if depth%2 == 0 {
		return key[depth/2] >> 4
	}
	return key[depth/2] & 15
}
func encodeSnapshotPage(p *snapshotPage) ([]byte, error) {
	raw := []byte{2, p.Depth, 0}
	raw = binary.BigEndian.AppendUint64(raw, p.Rows)
	if p.Children != nil {
		raw[2] = 1
		for _, child := range p.Children {
			raw = append(raw, child.Hash[:]...)
			raw = binary.BigEndian.AppendUint64(raw, child.Rows)
		}
	} else {
		raw = binary.BigEndian.AppendUint16(raw, uint16(len(p.Entries)))
		for i, entry := range p.Entries {
			if len(entry.Key) == 0 || len(entry.Key) > SnapshotKeyBytes || len(entry.Value) == 0 || len(entry.Value) > SnapshotRecordBytes {
				return nil, fmt.Errorf("snapshot record exceeds its bounded encoding")
			}
			if i > 0 && bytes.Compare(p.Entries[i-1].Key, entry.Key) >= 0 {
				return nil, fmt.Errorf("snapshot keys must be strictly ordered")
			}
			raw = append(raw, byte(len(entry.Key)))
			raw = binary.BigEndian.AppendUint16(raw, uint16(len(entry.Value)))
			raw = append(raw, entry.Key...)
			raw = append(raw, entry.Value...)
		}
	}
	if len(raw) > SnapshotPageBytes {
		return nil, fmt.Errorf("snapshot page exceeds %d bytes", SnapshotPageBytes)
	}
	return raw, nil
}
func decodeSnapshotPage(raw []byte) (*snapshotPage, error) {
	if len(raw) < 13 || len(raw) > SnapshotPageBytes || raw[0] != 2 || int(raw[1]) > SnapshotMaxDepth {
		return nil, fmt.Errorf("invalid snapshot page envelope")
	}
	p := &snapshotPage{Depth: raw[1], Rows: binary.BigEndian.Uint64(raw[3:11])}
	if raw[2] == 1 {
		if len(raw) != 11+16*40 || int(p.Depth) >= SnapshotMaxDepth {
			return nil, fmt.Errorf("invalid snapshot directory")
		}
		p.Children = new([16]snapshotChild)
		var total uint64
		for i := range p.Children {
			start := 11 + i*40
			child := &p.Children[i]
			copy(child.Hash[:], raw[start:start+32])
			child.Rows = binary.BigEndian.Uint64(raw[start+32 : start+40])
			if (child.Rows == 0) != (child.Hash == [32]byte{}) || ^uint64(0)-total < child.Rows {
				return nil, fmt.Errorf("invalid snapshot child count")
			}
			total += child.Rows
		}
		if total != p.Rows || total == 0 {
			return nil, fmt.Errorf("snapshot directory total disagrees with children")
		}
	} else if raw[2] == 0 {
		count := int(binary.BigEndian.Uint16(raw[11:13]))
		cursor := 13
		for i := 0; i < count; i++ {
			if len(raw)-cursor < 3 {
				return nil, fmt.Errorf("truncated snapshot record")
			}
			n := int(raw[cursor])
			v := int(binary.BigEndian.Uint16(raw[cursor+1 : cursor+3]))
			cursor += 3
			if n == 0 || n > SnapshotKeyBytes || v == 0 || v > SnapshotRecordBytes || n+v > len(raw)-cursor {
				return nil, fmt.Errorf("invalid snapshot record lengths")
			}
			entry := snapshotEntry{bytes.Clone(raw[cursor : cursor+n]), bytes.Clone(raw[cursor+n : cursor+n+v])}
			cursor += n + v
			if i > 0 && bytes.Compare(p.Entries[i-1].Key, entry.Key) >= 0 {
				return nil, fmt.Errorf("snapshot keys are not canonical")
			}
			p.Entries = append(p.Entries, entry)
		}
		if cursor != len(raw) || p.Rows != uint64(count) || count == 0 || count > SnapshotLeafRows {
			return nil, fmt.Errorf("snapshot leaf count or trailing data is invalid")
		}
	} else {
		return nil, fmt.Errorf("unknown snapshot node kind")
	}
	return p, nil
}
func (m *SnapshotMap) load(root SnapshotRoot, depth int) (*snapshotPage, error) {
	if root.Rows == 0 && root.Hash == [32]byte{} {
		return &snapshotPage{Depth: byte(depth)}, nil
	}
	if root.Rows == 0 || root.Hash == [32]byte{} {
		return nil, fmt.Errorf("invalid snapshot root")
	}
	p := m.cache[root.Hash]
	if p == nil {
		raw := m.store.Get(m.key(root.Hash))
		if m.digest(raw) != root.Hash {
			return nil, fmt.Errorf("snapshot page is missing or its context hash disagrees")
		}
		var err error
		p, err = decodeSnapshotPage(raw)
		if err != nil {
			return nil, err
		}
		m.cache[root.Hash] = p
	}
	if p.Rows != root.Rows || int(p.Depth) != depth {
		return nil, fmt.Errorf("snapshot reference count or depth disagrees with its page")
	}
	return p, nil
}
func (m *SnapshotMap) save(p *snapshotPage) (SnapshotRoot, error) {
	if p.Rows == 0 {
		return SnapshotRoot{}, nil
	}
	raw, err := encodeSnapshotPage(p)
	if err != nil {
		return SnapshotRoot{}, err
	}
	hash := m.digest(raw)
	if _, exists := m.cache[hash]; !exists {
		old := m.store.Get(m.key(hash))
		if len(old) > 0 && !bytes.Equal(old, raw) {
			return SnapshotRoot{}, fmt.Errorf("immutable snapshot page collision")
		}
		if len(old) == 0 {
			m.store.Set(m.key(hash), raw)
			m.store.Set(m.gcKey(hash), []byte{1})
			if p.Children != nil {
				for _, child := range p.Children {
					if child.Rows > 0 {
						if err := m.adjustReferences(child.Hash, 1); err != nil {
							return SnapshotRoot{}, err
						}
					}
				}
			}
		}
		m.cache[hash] = p
	}
	return SnapshotRoot{hash, p.Rows}, nil
}

type SnapshotChange struct{ Key, Value []byte }

// PutBatch constructs each changed page once. Chunking the same ordered changes
// produces the same root. There is no intermediate full-map write per row.
func (m *SnapshotMap) PutBatch(root SnapshotRoot, changes []SnapshotChange) (SnapshotRoot, error) {
	if len(changes) == 0 {
		return root, nil
	}
	for i, c := range changes {
		if len(c.Key) == 0 || len(c.Key) > SnapshotKeyBytes || len(c.Value) > SnapshotRecordBytes || i > 0 && bytes.Compare(changes[i-1].Key, c.Key) >= 0 {
			return SnapshotRoot{}, fmt.Errorf("snapshot batch keys must be ordered, unique and bounded")
		}
	}
	return m.batch(root, changes, 0)
}
func (m *SnapshotMap) batch(root SnapshotRoot, changes []SnapshotChange, depth int) (SnapshotRoot, error) {
	p, err := m.load(root, depth)
	if err != nil {
		return SnapshotRoot{}, err
	}
	if p.Children == nil {
		entries := append([]snapshotEntry(nil), p.Entries...)
		for _, c := range changes {
			i := sort.Search(len(entries), func(i int) bool { return bytes.Compare(entries[i].Key, c.Key) >= 0 })
			if i < len(entries) && bytes.Equal(entries[i].Key, c.Key) {
				if len(c.Value) == 0 {
					entries = append(entries[:i], entries[i+1:]...)
				} else {
					entries[i] = snapshotEntry{bytes.Clone(c.Key), bytes.Clone(c.Value)}
				}
			} else if len(c.Value) > 0 {
				entries = append(entries, snapshotEntry{})
				copy(entries[i+1:], entries[i:])
				entries[i] = snapshotEntry{bytes.Clone(c.Key), bytes.Clone(c.Value)}
			}
		}
		return m.build(entries, depth)
	}
	children := *p.Children
	for index, child := range children {
		var group []SnapshotChange
		for _, c := range changes {
			if int(snapshotNibble(c.Key, depth)) == index {
				group = append(group, c)
			}
		}
		if len(group) == 0 {
			continue
		}
		next, err := m.batch(SnapshotRoot{child.Hash, child.Rows}, group, depth+1)
		if err != nil {
			return SnapshotRoot{}, err
		}
		children[index] = snapshotChild{next.Hash, next.Rows}
	}
	var count uint64
	for _, c := range children {
		if ^uint64(0)-count < c.Rows {
			return SnapshotRoot{}, fmt.Errorf("snapshot row total overflow")
		}
		count += c.Rows
	}
	if count <= SnapshotLeafRows {
		var entries []snapshotEntry
		for _, c := range children {
			rows, err := m.entries(SnapshotRoot{c.Hash, c.Rows}, depth+1)
			if err != nil {
				return SnapshotRoot{}, err
			}
			entries = append(entries, rows...)
		}
		return m.build(entries, depth)
	}
	return m.save(&snapshotPage{Depth: byte(depth), Rows: count, Children: &children})
}

func (m *SnapshotMap) privateKey(prefix string, hash [32]byte) []byte {
	key := append([]byte(prefix), m.scope[:]...)
	key = append(key, m.kind)
	return append(key, hash[:]...)
}
func (m *SnapshotMap) gcKey(hash [32]byte) []byte { return m.privateKey("snapshots/v2/garbage/", hash) }
func (m *SnapshotMap) referenceKey(hash [32]byte) []byte {
	return m.privateKey("snapshots/v2/references/", hash)
}
func (m *SnapshotMap) references(hash [32]byte) (uint64, error) {
	raw := m.store.Get(m.referenceKey(hash))
	if len(raw) == 0 {
		return 0, nil
	}
	if len(raw) != 8 {
		return 0, fmt.Errorf("invalid snapshot reference counter")
	}
	return binary.BigEndian.Uint64(raw), nil
}
func (m *SnapshotMap) adjustReferences(hash [32]byte, delta int) error {
	count, err := m.references(hash)
	if err != nil {
		return err
	}
	if delta > 0 {
		if count == ^uint64(0) {
			return fmt.Errorf("snapshot reference count overflow")
		}
		count++
	} else {
		if count == 0 {
			return fmt.Errorf("snapshot reference underflow")
		}
		count--
	}
	m.store.Set(m.referenceKey(hash), binary.BigEndian.AppendUint64(nil, count))
	if count == 0 {
		m.store.Set(m.gcKey(hash), []byte{1})
	}
	return nil
}
func (m *SnapshotMap) ownerKey(owner []byte) []byte {
	hash := sha256.Sum256(owner)
	return m.privateKey("snapshots/v2/pins/", hash)
}

// Pin transfers one named ownership record atomically in the host transaction.
// Checkpoints, pending proposals and sessions each have their own owner.
func (m *SnapshotMap) Pin(owner []byte, root SnapshotRoot) error {
	if root.Rows == 0 && root.Hash != [32]byte{} {
		return fmt.Errorf("invalid empty snapshot pin")
	}
	if root.Rows > 0 {
		if _, err := m.load(root, 0); err != nil {
			return err
		}
	}
	key := m.ownerKey(owner)
	old := m.store.Get(key)
	var previous [32]byte
	if len(old) > 0 {
		if len(old) != 32 {
			return fmt.Errorf("invalid snapshot pin")
		}
		copy(previous[:], old)
	}
	if previous == root.Hash {
		return nil
	}
	if root.Rows > 0 {
		if _, err := m.load(root, 0); err != nil {
			return err
		}
		if err := m.adjustReferences(root.Hash, 1); err != nil {
			return err
		}
		m.store.Set(key, root.Hash[:])
	} else {
		if root.Hash != [32]byte{} {
			return fmt.Errorf("invalid empty snapshot pin")
		}
		m.store.Delete(key)
	}
	if previous != [32]byte{} {
		return m.adjustReferences(previous, -1)
	}
	return nil
}

// Collect removes at most limit queued objects. Parent edges and explicit pins
// protect shared pages. It never follows an unbounded backwards history chain.
func (m *SnapshotMap) Collect(limit int) (int, error) {
	if limit <= 0 || limit > 128 {
		return 0, fmt.Errorf("snapshot cleanup limit must be between 1 and 128")
	}
	prefix := m.privateKey("snapshots/v2/garbage/", [32]byte{})
	prefix = prefix[:len(prefix)-32]
	var hashes [][32]byte
	it := storetypes.KVStorePrefixIterator(m.store, prefix)
	for ; it.Valid() && len(hashes) < limit; it.Next() {
		key := it.Key()
		if len(key) != len(prefix)+32 {
			it.Close()
			return 0, fmt.Errorf("invalid snapshot cleanup key")
		}
		var hash [32]byte
		copy(hash[:], key[len(prefix):])
		hashes = append(hashes, hash)
	}
	if err := it.Close(); err != nil {
		return 0, err
	}
	removed := 0
	for _, hash := range hashes {
		count, err := m.references(hash)
		if err != nil {
			return removed, err
		}
		m.store.Delete(m.gcKey(hash))
		if count > 0 {
			continue
		}
		raw := m.store.Get(m.key(hash))
		if len(raw) == 0 {
			continue
		}
		if m.digest(raw) != hash {
			return removed, fmt.Errorf("corrupt snapshot object during cleanup")
		}
		p, err := decodeSnapshotPage(raw)
		if err != nil {
			return removed, err
		}
		if p.Children != nil {
			for _, child := range p.Children {
				if child.Rows > 0 {
					if err := m.adjustReferences(child.Hash, -1); err != nil {
						return removed, err
					}
				}
			}
		}
		m.store.Delete(m.key(hash))
		m.store.Delete(m.referenceKey(hash))
		delete(m.cache, hash)
		removed++
	}
	return removed, nil
}
func (m *SnapshotMap) Lookup(root SnapshotRoot, key []byte) ([]byte, bool, error) {
	if len(key) == 0 || len(key) > SnapshotKeyBytes {
		return nil, false, fmt.Errorf("invalid snapshot lookup key")
	}
	for depth := 0; depth <= SnapshotMaxDepth; depth++ {
		p, err := m.load(root, depth)
		if err != nil {
			return nil, false, err
		}
		if p.Children == nil {
			i := sort.Search(len(p.Entries), func(i int) bool { return bytes.Compare(p.Entries[i].Key, key) >= 0 })
			if i < len(p.Entries) && bytes.Equal(p.Entries[i].Key, key) {
				return bytes.Clone(p.Entries[i].Value), true, nil
			}
			return nil, false, nil
		}
		child := p.Children[snapshotNibble(key, depth)]
		root = SnapshotRoot{child.Hash, child.Rows}
	}
	return nil, false, fmt.Errorf("snapshot lookup depth exceeded")
}
func (m *SnapshotMap) Put(root SnapshotRoot, key, value []byte) (SnapshotRoot, error) {
	if len(key) == 0 || len(key) > SnapshotKeyBytes || len(value) > SnapshotRecordBytes {
		return SnapshotRoot{}, fmt.Errorf("invalid snapshot mutation size")
	}
	return m.mutate(root, bytes.Clone(key), bytes.Clone(value), 0)
}
func (m *SnapshotMap) mutate(root SnapshotRoot, key, value []byte, depth int) (SnapshotRoot, error) {
	p, err := m.load(root, depth)
	if err != nil {
		return SnapshotRoot{}, err
	}
	if p.Children != nil {
		children := *p.Children
		index := snapshotNibble(key, depth)
		child := children[index]
		next, err := m.mutate(SnapshotRoot{child.Hash, child.Rows}, key, value, depth+1)
		if err != nil {
			return SnapshotRoot{}, err
		}
		if next.Hash == child.Hash {
			return root, nil
		}
		children[index] = snapshotChild{next.Hash, next.Rows}
		var total uint64
		for _, c := range children {
			if ^uint64(0)-total < c.Rows {
				return SnapshotRoot{}, fmt.Errorf("snapshot row count overflow")
			}
			total += c.Rows
		}
		if total <= SnapshotLeafRows {
			var entries []snapshotEntry
			for _, child := range children {
				rows, err := m.entries(SnapshotRoot{child.Hash, child.Rows}, depth+1)
				if err != nil {
					return SnapshotRoot{}, err
				}
				entries = append(entries, rows...)
			}
			return m.build(entries, depth)
		}
		return m.save(&snapshotPage{Depth: byte(depth), Rows: total, Children: &children})
	}
	entries := append([]snapshotEntry(nil), p.Entries...)
	index := sort.Search(len(entries), func(i int) bool { return bytes.Compare(entries[i].Key, key) >= 0 })
	if index < len(entries) && bytes.Equal(entries[index].Key, key) {
		if bytes.Equal(entries[index].Value, value) {
			return root, nil
		}
		if len(value) == 0 {
			entries = append(entries[:index], entries[index+1:]...)
		} else {
			entries[index] = snapshotEntry{key, value}
		}
	} else {
		if len(value) == 0 {
			return root, nil
		}
		entries = append(entries, snapshotEntry{})
		copy(entries[index+1:], entries[index:])
		entries[index] = snapshotEntry{key, value}
	}
	return m.build(entries, depth)
}
func (m *SnapshotMap) build(entries []snapshotEntry, depth int) (SnapshotRoot, error) {
	page := &snapshotPage{Depth: byte(depth), Entries: entries, Rows: uint64(len(entries))}
	if len(entries) <= SnapshotLeafRows {
		return m.save(page)
	}
	if depth >= SnapshotMaxDepth {
		return SnapshotRoot{}, fmt.Errorf("snapshot key collision exceeds page bound")
	}
	children := new([16]snapshotChild)
	for i := 0; i < 16; i++ {
		var group []snapshotEntry
		for _, entry := range entries {
			if int(snapshotNibble(entry.Key, depth)) == i {
				group = append(group, entry)
			}
		}
		if len(group) == 0 {
			continue
		}
		root, err := m.build(group, depth+1)
		if err != nil {
			return SnapshotRoot{}, err
		}
		children[i] = snapshotChild{root.Hash, root.Rows}
	}
	return m.save(&snapshotPage{Depth: byte(depth), Rows: uint64(len(entries)), Children: children})
}

func (m *SnapshotMap) entries(root SnapshotRoot, depth int) ([]snapshotEntry, error) {
	if root.Rows == 0 {
		return nil, nil
	}
	p, err := m.load(root, depth)
	if err != nil {
		return nil, err
	}
	if p.Children == nil {
		return append([]snapshotEntry(nil), p.Entries...), nil
	}
	var entries []snapshotEntry
	for _, child := range p.Children {
		rows, err := m.entries(SnapshotRoot{child.Hash, child.Rows}, depth+1)
		if err != nil {
			return nil, err
		}
		entries = append(entries, rows...)
	}
	return entries, nil
}

// Visit follows immutable pages in canonical order. The callback can stop a
// bounded batch. No mutable latest map or backwards delta replay is involved.
func (m *SnapshotMap) Visit(root SnapshotRoot, after []byte, limit int, visit func([]byte, []byte) error) (int, error) {
	if limit <= 0 {
		return 0, fmt.Errorf("snapshot visit requires a positive bound")
	}
	count := 0
	var walk func(SnapshotRoot, int, int) error
	walk = func(root SnapshotRoot, depth int, relation int) error {
		if count >= limit || root.Rows == 0 {
			return nil
		}
		p, err := m.load(root, depth)
		if err != nil {
			return err
		}
		if p.Children == nil {
			for _, e := range p.Entries {
				if count >= limit {
					break
				}
				if bytes.Compare(e.Key, after) <= 0 {
					continue
				}
				if err := visit(bytes.Clone(e.Key), bytes.Clone(e.Value)); err != nil {
					return err
				}
				count++
			}
			return nil
		}
		for index, child := range p.Children {
			nextRelation := relation
			if relation == 0 && len(after) > 0 {
				nibble := int(snapshotNibble(after, depth))
				if index < nibble {
					continue
				}
				if index > nibble {
					nextRelation = 1
				}
			}
			if err := walk(SnapshotRoot{child.Hash, child.Rows}, depth+1, nextRelation); err != nil {
				return err
			}
			if count >= limit {
				break
			}
		}
		return nil
	}
	return count, walk(root, 0, 0)
}
