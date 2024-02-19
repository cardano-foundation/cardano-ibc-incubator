package ibc

import (
	"context"

	"github.com/misko9/go-substrate-rpc-client/v4/types"
)

func (i IBC) QueryIbcEvents(
	ctx context.Context,
	blockNumbers []types.BlockNumberOrHash,
) (
	types.IBCEventsQueryResult,
	error,
) {
	var res types.IBCEventsQueryResult
	err := i.client.CallContext(ctx, &res, queryEventsMethod, blockNumbers)
	if err != nil {
		return res, err
	}
	return res, nil
}
