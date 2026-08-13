package types

import (
	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

var _ sdk.Msg = &MsgConsolidateReports{}

func NewMsgConsolidateReports(creator string, imo string) *MsgConsolidateReports {
	return &MsgConsolidateReports{
		Creator: creator,
		Imo:     imo,
	}
}

func (msg *MsgConsolidateReports) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}
