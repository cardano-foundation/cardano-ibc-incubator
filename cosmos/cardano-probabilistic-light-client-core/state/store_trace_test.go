package state

import (
	"testing"

	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/gaskv"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func TestTraceStorePreservesValuesGasAndIterations(t *testing.T) {
	run := func(trace bool) ([][]byte, uint64, []StoreIO) {
		meter := storetypes.NewInfiniteGasMeter()
		var records []StoreIO
		var store storetypes.KVStore = gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
		if trace {
			store = TraceStore(store, meter.GasConsumed, func(io StoreIO) { records = append(records, io) })
		}
		store.Set([]byte("a"), []byte("first"))
		store.Set([]byte("b"), []byte("second"))
		require.True(t, store.Has([]byte("a")))
		values := [][]byte{store.Get([]byte("a")), store.Get([]byte("absent"))}
		it := store.Iterator(nil, nil)
		for ; it.Valid(); it.Next() {
			values = append(values, it.Key(), it.Value())
		}
		require.NoError(t, it.Close())
		store.Delete([]byte("a"))
		require.False(t, store.Has([]byte("a")))
		return values, meter.GasConsumed(), records
	}
	want, gas, _ := run(false)
	got, tracedGas, records := run(true)
	require.Equal(t, want, got)
	require.Equal(t, gas, tracedGas)
	var attributed uint64
	for _, io := range records {
		attributed += io.Gas
	}
	require.Equal(t, gas, attributed, "every metered operation must be attributed without extra store reads")
}
