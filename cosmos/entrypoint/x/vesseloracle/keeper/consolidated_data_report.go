package keeper

import (
	"context"

	"entrypoint/x/vesseloracle/types"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/runtime"
)

// SetConsolidatedDataReport set a specific consolidatedDataReport in the store from its index
func (k Keeper) SetConsolidatedDataReport(ctx context.Context, consolidatedDataReport types.ConsolidatedDataReport) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.ConsolidatedDataReportKeyPrefix))
	b := k.cdc.MustMarshal(&consolidatedDataReport)
	store.Set(types.ConsolidatedDataReportKey(
		consolidatedDataReport.Imo,
		consolidatedDataReport.Ts,
	), b)
}

// GetConsolidatedDataReport returns a consolidatedDataReport from its index
func (k Keeper) GetConsolidatedDataReport(
	ctx context.Context,
	imo string,
	ts uint64,

) (val types.ConsolidatedDataReport, found bool) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.ConsolidatedDataReportKeyPrefix))

	b := store.Get(types.ConsolidatedDataReportKey(
		imo,
		ts,
	))
	if b == nil {
		return val, false
	}

	k.cdc.MustUnmarshal(b, &val)
	return val, true
}

// RemoveConsolidatedDataReport removes a consolidatedDataReport from the store
func (k Keeper) RemoveConsolidatedDataReport(
	ctx context.Context,
	imo string,
	ts uint64,

) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.ConsolidatedDataReportKeyPrefix))
	store.Delete(types.ConsolidatedDataReportKey(
		imo,
		ts,
	))
}

// GetAllConsolidatedDataReport returns all consolidatedDataReport
func (k Keeper) GetAllConsolidatedDataReport(ctx context.Context) (list []types.ConsolidatedDataReport) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.ConsolidatedDataReportKeyPrefix))
	iterator := storetypes.KVStorePrefixIterator(store, []byte{})

	defer iterator.Close()

	for ; iterator.Valid(); iterator.Next() {
		var val types.ConsolidatedDataReport
		k.cdc.MustUnmarshal(iterator.Value(), &val)
		list = append(list, val)
	}

	return
}
