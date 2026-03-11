package keeper

import (
	"entrypoint/x/vesseloracle/types"
	"errors"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
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
	packetBytes, err := packetData.GetBytes()
	if err != nil {
		return 0, errorsmod.Wrapf(sdkerrors.ErrJSONMarshal, "cannot marshal the packet: %s", err)
	}

	return k.ics4Wrapper().SendPacket(ctx, sourcePort, sourceChannel, timeoutHeight, timeoutTimestamp, packetBytes)
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
