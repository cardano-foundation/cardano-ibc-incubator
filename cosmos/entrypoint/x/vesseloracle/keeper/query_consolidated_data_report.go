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

func (k Keeper) ConsolidatedDataReportAll(ctx context.Context, req *types.QueryAllConsolidatedDataReportRequest) (*types.QueryAllConsolidatedDataReportResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	var consolidatedDataReports []types.ConsolidatedDataReport

	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	consolidatedDataReportStore := prefix.NewStore(store, types.KeyPrefix(types.ConsolidatedDataReportKeyPrefix))

	pageRes, err := query.Paginate(consolidatedDataReportStore, req.Pagination, func(key []byte, value []byte) error {
		var consolidatedDataReport types.ConsolidatedDataReport
		if err := k.cdc.Unmarshal(value, &consolidatedDataReport); err != nil {
			return err
		}

		consolidatedDataReports = append(consolidatedDataReports, consolidatedDataReport)
		return nil
	})

	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &types.QueryAllConsolidatedDataReportResponse{ConsolidatedDataReport: consolidatedDataReports, Pagination: pageRes}, nil
}

func (k Keeper) ConsolidatedDataReport(ctx context.Context, req *types.QueryGetConsolidatedDataReportRequest) (*types.QueryGetConsolidatedDataReportResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	val, found := k.GetConsolidatedDataReport(
		ctx,
		req.Imo,
		req.Ts,
	)
	if !found {
		return nil, status.Error(codes.NotFound, "not found")
	}

	return &types.QueryGetConsolidatedDataReportResponse{ConsolidatedDataReport: val}, nil
}
