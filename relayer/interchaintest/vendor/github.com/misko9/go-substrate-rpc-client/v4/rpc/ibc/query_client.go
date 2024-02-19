package ibc

import (
	"context"

	"github.com/misko9/go-substrate-rpc-client/v4/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
)

func (i IBC) QueryClientStateResponse(
	ctx context.Context,
	height int64,
	srcClientID string,
) (
	clienttypes.QueryClientStateResponse,
	error,
) {
	var res QueryClientStateResponse
	err := i.client.CallContext(ctx, &res, queryClientStateMethod, height, srcClientID)
	if err != nil {
		return clienttypes.QueryClientStateResponse{}, err
	}
	return parseQueryClientStateResponse(res)
}

func (i IBC) QueryClientConsensusState(
	ctx context.Context,
	chainHeight uint32,
	clientID string,
	revisionHeight,
	revisionNumber uint64,
	latestConsensusState bool) (
	*clienttypes.QueryConsensusStateResponse,
	error,
) {
	var res QueryConsensusStateResponse
	err := i.client.CallContext(ctx, &res,
		queryClientConsensusStateMethod,
		chainHeight,
		clientID,
		revisionHeight,
		revisionNumber,
		latestConsensusState)
	if err != nil {
		return &clienttypes.QueryConsensusStateResponse{}, err
	}
	return parseQueryConsensusStateResponse(res)
}

func (i IBC) QueryUpgradedClient(
	ctx context.Context,
	height int64,
) (*clienttypes.QueryClientStateResponse, error) {
	var res *clienttypes.QueryClientStateResponse
	err := i.client.CallContext(ctx, &res, queryUpgradedClientMethod, height)
	if err != nil {
		return &clienttypes.QueryClientStateResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryUpgradedConsState(
	ctx context.Context,
	height int64,
) (
	*clienttypes.QueryConsensusStateResponse,
	error,
) {
	var res *clienttypes.QueryConsensusStateResponse
	err := i.client.CallContext(ctx, &res, queryUpgradedConnectionStateMethod, height)
	if err != nil {
		return &clienttypes.QueryConsensusStateResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryClients(ctx context.Context) (
	clienttypes.IdentifiedClientStates,
	error,
) {
	var res IdentifiedClientStates
	err := i.client.CallContext(ctx, &res, queryClientsMethod)
	if err != nil {
		return clienttypes.IdentifiedClientStates{}, err
	}
	return parseIdentifiedClientStates(res)
}

func (i IBC) QueryNewlyCreatedClient(
	ctx context.Context,
	blockHash types.Hash,
	extHash types.Hash,
) (
	clienttypes.IdentifiedClientState,
	error,
) {
	var res clienttypes.IdentifiedClientState
	err := i.client.CallContext(ctx, &res, queryNewlyCreatedClientMethod, blockHash, extHash)
	if err != nil {
		return clienttypes.IdentifiedClientState{}, err
	}
	return res, nil
}
