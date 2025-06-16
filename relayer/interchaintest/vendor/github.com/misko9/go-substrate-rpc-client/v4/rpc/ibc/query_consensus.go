package ibc

import (
	"context"

	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
)

func (i IBC) QueryConsensusState(
	ctx context.Context,
	height uint32,
) (
	*clienttypes.QueryConsensusStateResponse,
	error,
) {
	var res *clienttypes.QueryConsensusStateResponse
	err := i.client.CallContext(ctx, &res, queryConsensusStateMethod, height)
	if err != nil {
		return &clienttypes.QueryConsensusStateResponse{}, err
	}
	return res, nil
}
