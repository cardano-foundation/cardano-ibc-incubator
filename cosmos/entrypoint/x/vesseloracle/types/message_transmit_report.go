package types

import (
	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

var _ sdk.Msg = &MsgTransmitReport{}

func NewMsgTransmitReport(creator string, imo string, ts uint64) *MsgTransmitReport {
	return &MsgTransmitReport{
		Creator: creator,
		Imo:     imo,
		Ts:      ts,
	}
}

func (msg *MsgTransmitReport) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}
