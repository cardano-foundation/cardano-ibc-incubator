package types

import (
	"context"

	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

// ChannelKeeper defines the expected IBC channel keeper.
type ChannelKeeper interface {
	GetChannel(ctx context.Context, portID, channelID string) (channeltypes.Channel, bool)
	GetNextSequenceSend(ctx context.Context, portID, channelID string) (uint64, bool)
	ChanCloseInit(ctx context.Context, portID, channelID string) error
}

// ICS4Wrapper defines the expected IBC packet wrapper.
type ICS4Wrapper interface {
	SendPacket(
		ctx sdk.Context,
		sourcePort string,
		sourceChannel string,
		timeoutHeight clienttypes.Height,
		timeoutTimestamp uint64,
		data []byte,
	) (uint64, error)
	WriteAcknowledgement(
		ctx sdk.Context,
		packet exported.PacketI,
		ack exported.Acknowledgement,
	) error
	GetAppVersion(ctx sdk.Context, portID, channelID string) (string, bool)
}
