package keeper

import (
	"encoding/json"
	"entrypoint/x/vesseloracle/types"
	"errors"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
)

// TransmitConsolidatedDataReportPacketPacket transmits the packet over IBC with the specified source port and source channel
func (k Keeper) TransmitConsolidatedDataReportPacketPacket(
	ctx sdk.Context,
	packetData types.ConsolidatedDataReportPacketPacketData,
	sourcePort,
	sourceChannel string,
	timeoutHeight clienttypes.Height,
	timeoutTimestamp uint64,
) (uint64, error) {
	packetBytes, err := json.Marshal(packetData)

	channelCap, ok := k.ScopedKeeper().GetCapability(ctx, host.ChannelCapabilityPath(sourcePort, sourceChannel))
	if !ok {
		return 0, errorsmod.Wrap(channeltypes.ErrChannelCapabilityNotFound, "module does not own channel capability")
	}
	if err != nil {
		return 0, errorsmod.Wrapf(sdkerrors.ErrJSONMarshal, "cannot marshal the packet: %s", err)
	}

	return k.ibcKeeperFn().ChannelKeeper.SendPacket(ctx, channelCap, sourcePort, sourceChannel, timeoutHeight, timeoutTimestamp, packetBytes)
}

// OnRecvConsolidatedDataReportPacketPacket processes packet reception
func (k Keeper) OnRecvConsolidatedDataReportPacketPacket(ctx sdk.Context, packet channeltypes.Packet, data types.ConsolidatedDataReportPacketPacketData) (packetAck types.ConsolidatedDataReportPacketPacketAck, err error) {
	// validate packet data upon receiving
	if err := data.ValidateBasic(); err != nil {
		return packetAck, err
	}

	// TODO: packet reception logic

	return packetAck, nil
}

// OnAcknowledgementConsolidatedDataReportPacketPacket responds to the success or failure of a packet
// acknowledgement written on the receiving chain.
func (k Keeper) OnAcknowledgementConsolidatedDataReportPacketPacket(ctx sdk.Context, packet channeltypes.Packet, data types.ConsolidatedDataReportPacketPacketData, ack channeltypes.Acknowledgement) error {
	switch dispatchedAck := ack.Response.(type) {
	case *channeltypes.Acknowledgement_Error:

		// TODO: failed acknowledgement logic
		_ = dispatchedAck.Error

		return nil
	case *channeltypes.Acknowledgement_Result:
		// Decode the packet acknowledgment
		var packetAck types.ConsolidatedDataReportPacketPacketAck

		if err := types.ModuleCdc.UnmarshalJSON(dispatchedAck.Result, &packetAck); err != nil {
			// The counter-party module doesn't implement the correct acknowledgment format
			return errors.New("cannot unmarshal acknowledgment")
		}

		// TODO: successful acknowledgement logic

		return nil
	default:
		// The counter-party module doesn't implement the correct acknowledgment format
		return errors.New("invalid acknowledgment format")
	}
}

// OnTimeoutConsolidatedDataReportPacketPacket responds to the case where a packet has not been transmitted because of a timeout
func (k Keeper) OnTimeoutConsolidatedDataReportPacketPacket(ctx sdk.Context, packet channeltypes.Packet, data types.ConsolidatedDataReportPacketPacketData) error {

	// TODO: packet timeout logic

	return nil
}
