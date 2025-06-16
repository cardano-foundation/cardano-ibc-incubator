package ibc

import (
	"context"

	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
)

func (i IBC) QueryChannelClient(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
) (
	*clienttypes.IdentifiedClientState,
	error,
) {
	var res clienttypes.IdentifiedClientState
	err := i.client.CallContext(ctx, &res, queryChannelClientMethod, height, channelID, portID)
	if err != nil {
		return &clienttypes.IdentifiedClientState{}, err
	}
	return &res, nil
}

func (i IBC) QueryConnectionChannels(
	ctx context.Context,
	height uint32,
	connectionID string,
) (
	*chantypes.QueryChannelsResponse,
	error,
) {
	var res *chantypes.QueryChannelsResponse
	err := i.client.CallContext(ctx, &res, queryConnectionChannelsMethod, height, connectionID)
	if err != nil {
		return &chantypes.QueryChannelsResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryChannel(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
) (
	*chantypes.QueryChannelResponse,
	error,
) {
	var res *chantypes.QueryChannelResponse
	err := i.client.CallContext(ctx, &res, queryChannelMethod, height, channelID, portID)
	if err != nil {
		return &chantypes.QueryChannelResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryChannels(ctx context.Context) (
	*chantypes.QueryChannelsResponse,
	error,
) {
	var res *chantypes.QueryChannelsResponse
	err := i.client.CallContext(ctx, &res, queryChannelsMethod)
	if err != nil {
		return &chantypes.QueryChannelsResponse{}, err
	}
	return res, nil
}
