package ibc

import (
	"context"

	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
)

func (i IBC) QueryConnection(
	ctx context.Context,
	height int64,
	connectionID string,
) (
	*conntypes.QueryConnectionResponse,
	error,
) {
	var res *conntypes.QueryConnectionResponse
	err := i.client.CallContext(ctx, &res, queryConnectionMethod, height, connectionID)
	if err != nil {
		return &conntypes.QueryConnectionResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryConnections(ctx context.Context) (
	*conntypes.QueryConnectionsResponse,
	error,
) {
	var res *conntypes.QueryConnectionsResponse
	err := i.client.CallContext(ctx, &res, queryConnectionsMethod)
	if err != nil {
		return &conntypes.QueryConnectionsResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryConnectionsUsingClient(
	ctx context.Context,
	height int64,
	clientID string,
) (
	*conntypes.QueryConnectionsResponse,
	error,
) {
	var res *conntypes.QueryConnectionsResponse
	err := i.client.CallContext(ctx, &res, queryConnectionUsingClientMethod, height, clientID)
	if err != nil {
		return &conntypes.QueryConnectionsResponse{}, err
	}
	return res, nil
}
