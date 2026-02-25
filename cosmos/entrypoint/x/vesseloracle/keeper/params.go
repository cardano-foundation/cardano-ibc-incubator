package keeper

import (
	"context"

	"github.com/cosmos/cosmos-sdk/runtime"

	"entrypoint/x/vesseloracle/types"
)

// GetParams get all parameters as types.Params
func (k Keeper) GetParams(ctx context.Context) (params types.Params) {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	bz := store.Get(types.ParamsKey)
	if bz == nil {
		return params
	}

	k.cdc.MustUnmarshal(bz, &params)
	return params
}

// SetParams set the params
func (k Keeper) SetParams(ctx context.Context, params types.Params) error {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	bz, err := k.cdc.Marshal(&params)
	if err != nil {
		return err
	}
	store.Set(types.ParamsKey, bz)

	return nil
}

func (k Keeper) GetConsolidationWindowMinItemCount(ctx context.Context) int32 {
	params := k.GetParams(ctx)
	return params.ConsolidationWindowMinItemCount
}

func (k Keeper) GetConsolidationWindowMaxItemCount(ctx context.Context) int32 {
	params := k.GetParams(ctx)
	return params.ConsolidationWindowMaxItemCount
}

func (k Keeper) GetConsolidationWindowIntervalWidth(ctx context.Context) uint64 {
	params := k.GetParams(ctx)
	return params.ConsolidationWindowIntervalWidth
}
