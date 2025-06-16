package ibc

import (
	"context"

	transfertypes "github.com/cosmos/ibc-go/v7/modules/apps/transfer/types"
)

func (i IBC) QueryDenomTrace(
	ctx context.Context,
	denom string,
) (
	transfertypes.QueryDenomTraceResponse,
	error,
) {
	var res transfertypes.QueryDenomTraceResponse
	err := i.client.CallContext(ctx, &res, queryDenomTraceMethod, denom)
	if err != nil {
		return transfertypes.QueryDenomTraceResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryDenomTraces(
	ctx context.Context,
	offset,
	limit uint64,
	height uint32,
) (
	*transfertypes.QueryDenomTracesResponse,
	error,
) {
	var res *transfertypes.QueryDenomTracesResponse
	err := i.client.CallContext(ctx, &res, queryDenomTracesMethod, offset, limit, height)
	if err != nil {
		return &transfertypes.QueryDenomTracesResponse{}, err
	}
	return res, nil
}
