package keeper

import (
	"context"

	"entrypoint/x/vesseloracle/types"

	"cosmossdk.io/store/prefix"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/cosmos-sdk/types/query"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (k Keeper) VesselAll(ctx context.Context, req *types.QueryAllVesselRequest) (*types.QueryAllVesselResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	var vessels []types.Vessel

	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	vesselStore := prefix.NewStore(store, types.KeyPrefix(types.VesselKeyPrefix))

	pageRes, err := query.Paginate(vesselStore, req.Pagination, func(key []byte, value []byte) error {
		var vessel types.Vessel
		if err := k.cdc.Unmarshal(value, &vessel); err != nil {
			return err
		}

		vessels = append(vessels, vessel)
		return nil
	})

	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &types.QueryAllVesselResponse{Vessel: vessels, Pagination: pageRes}, nil
}

func (k Keeper) Vessel(ctx context.Context, req *types.QueryGetVesselRequest) (*types.QueryGetVesselResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	val, found := k.GetVessel(
		ctx,
		req.Imo,
		req.Ts,
		req.Source,
	)
	if !found {
		return nil, status.Error(codes.NotFound, "not found")
	}

	return &types.QueryGetVesselResponse{Vessel: val}, nil
}
