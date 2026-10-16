package state

import (
	"bytes"

	storetypes "cosmossdk.io/store/types"
)

// StoreIO describes one delegated operation. Tracing does not read additional
// keys, change returned values, consume gas or participate in verification.
type StoreIO struct {
	Operation                  string
	Key                        []byte
	ReadBytes, WriteBytes, Gas uint64
}

type tracedStore struct {
	storetypes.KVStore
	gas    func() uint64
	record func(StoreIO)
}

// TraceStore instruments the actual host store, including its gas meter.
// Callers may aggregate by phase and key without substituting a fake store.
func TraceStore(store storetypes.KVStore, gas func() uint64, record func(StoreIO)) storetypes.KVStore {
	if record == nil {
		return store
	}
	return &tracedStore{store, gas, record}
}

func (s *tracedStore) consumed() uint64 {
	if s.gas == nil {
		return 0
	}
	return s.gas()
}
func (s *tracedStore) emit(operation string, key []byte, read, written, before uint64) {
	s.record(StoreIO{operation, bytes.Clone(key), read, written, s.consumed() - before})
}
func (s *tracedStore) Get(key []byte) []byte {
	before := s.consumed()
	value := s.KVStore.Get(key)
	s.emit("get", key, uint64(len(key)+len(value)), 0, before)
	return value
}
func (s *tracedStore) Has(key []byte) bool {
	before := s.consumed()
	found := s.KVStore.Has(key)
	s.emit("has", key, 0, 0, before)
	return found
}
func (s *tracedStore) Set(key, value []byte) {
	before := s.consumed()
	s.KVStore.Set(key, value)
	s.emit("set", key, 0, uint64(len(key)+len(value)), before)
}
func (s *tracedStore) Delete(key []byte) {
	before := s.consumed()
	s.KVStore.Delete(key)
	s.emit("delete", key, 0, 0, before)
}
func (s *tracedStore) Iterator(start, end []byte) storetypes.Iterator {
	before := s.consumed()
	it := s.KVStore.Iterator(start, end)
	s.emit("iterator", start, 0, 0, before)
	return &tracedIterator{Iterator: it, store: s}
}
func (s *tracedStore) ReverseIterator(start, end []byte) storetypes.Iterator {
	before := s.consumed()
	it := s.KVStore.ReverseIterator(start, end)
	s.emit("reverse_iterator", start, 0, 0, before)
	return &tracedIterator{Iterator: it, store: s}
}

type tracedIterator struct {
	storetypes.Iterator
	store *tracedStore
}

func (it *tracedIterator) Next() {
	before := it.store.consumed()
	it.Iterator.Next()
	it.store.emit("iterator_next", nil, 0, 0, before)
}
func (it *tracedIterator) Key() []byte {
	before := it.store.consumed()
	key := it.Iterator.Key()
	it.store.emit("iterator_key", key, uint64(len(key)), 0, before)
	return key
}
func (it *tracedIterator) Value() []byte {
	before := it.store.consumed()
	value := it.Iterator.Value()
	it.store.emit("iterator_value", nil, uint64(len(value)), 0, before)
	return value
}
