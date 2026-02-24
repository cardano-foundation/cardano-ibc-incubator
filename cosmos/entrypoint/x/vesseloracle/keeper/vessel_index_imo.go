package keeper

import (
	"context"

	"entrypoint/x/vesseloracle/types"

	"cosmossdk.io/store/prefix"
	"github.com/cosmos/cosmos-sdk/runtime"
)

// Adds a new entry to the vessel key imo index. If no entry with the given imo exists a new list is created.
// Otherwise the new entry is appended to the existing list.
func (k Keeper) AddVesselKeyToIndexImo(ctx context.Context, vesselIndexEntry types.VesselIndexImo_Key) {
	k.Logger().Info("adding vessel key", "Imo", vesselIndexEntry.Imo, "Ts", vesselIndexEntry.Ts, "Source", vesselIndexEntry.Source)
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VesselIndexImoKeyPrefix))

	b := store.Get(types.VesselIndexImoKey(
		vesselIndexEntry.Imo,
	))

	vesselIndex := types.VesselIndexImo{
		Keys: make([]*types.VesselIndexImo_Key, 0),
	}
	if b != nil {
		k.cdc.MustUnmarshal(b, &vesselIndex)
	}

	k.Logger().Debug("old index length is", "indexLength", len(vesselIndex.Keys))
	vesselIndex.Keys = append(vesselIndex.Keys, &vesselIndexEntry)
	k.Logger().Debug("new index length is", "indexLength", len(vesselIndex.Keys))

	newB := k.cdc.MustMarshal(&vesselIndex)
	store.Set(types.VesselIndexImoKey(
		vesselIndexEntry.Imo,
	), newB)
}

// Return all vessel keys for a given imo.
func (k Keeper) GetVesselKeysFromIndexImo(
	ctx context.Context,
	imo string,
) (vesselIndexImo types.VesselIndexImo, found bool) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VesselIndexImoKeyPrefix))

	b := store.Get(types.VesselIndexImoKey(
		imo,
	))
	if b == nil {
		return vesselIndexImo, false
	}

	k.cdc.MustUnmarshal(b, &vesselIndexImo)
	return vesselIndexImo, true
}

// Remove a single vessel key.
func (k Keeper) RemoveVesselKeyFromIndexImo(
	ctx context.Context,
	vesselIndexEntry types.VesselIndexImo_Key,
) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VesselIndexImoKeyPrefix))
	b := store.Get(types.VesselIndexImoKey(
		vesselIndexEntry.Imo,
	))

	if b == nil {
		return
	}

	vesselIndexImo := types.VesselIndexImo{}
	k.cdc.MustUnmarshal(b, &vesselIndexImo)

	for idx, vesselKey := range vesselIndexImo.Keys {
		if vesselKey.Imo == vesselIndexEntry.Imo &&
			vesselKey.Source == vesselIndexEntry.Source &&
			vesselKey.Ts == vesselIndexEntry.Ts {
			vesselIndexImo.Keys = append(vesselIndexImo.Keys[:idx], vesselIndexImo.Keys[idx+1:]...)
			break
		}
	}

	newB := k.cdc.MustMarshal(&vesselIndexImo)
	store.Set(types.VesselIndexImoKey(
		vesselIndexEntry.Imo,
	), newB)
}

// Remove a whole set of vessel keys from the index.
func (k Keeper) RemoveAllVesselKeysFromIndexImo(
	ctx context.Context,
	imo string,
) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VesselIndexImoKeyPrefix))
	store.Delete(types.VesselIndexImoKey(
		imo,
	))
}
