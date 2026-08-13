package types

import (
	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

var _ sdk.Msg = &MsgCreateVessel{}

func NewMsgCreateVessel(
	creator string,
	imo string,
	ts uint64,
	source string,
	lat int32,
	lon int32,
	speed int32,
	course int32,
	heading int32,
	adt uint64,
	eta uint64,
	name string,
	destport string,
	depport string,
	mmsi string,

) *MsgCreateVessel {
	return &MsgCreateVessel{
		Creator:  creator,
		Imo:      imo,
		Ts:       ts,
		Source:   source,
		Lat:      lat,
		Lon:      lon,
		Speed:    speed,
		Course:   course,
		Heading:  heading,
		Adt:      adt,
		Eta:      eta,
		Name:     name,
		Destport: destport,
		Depport:  depport,
		Mmsi:     mmsi,
	}
}

func (msg *MsgCreateVessel) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}

var _ sdk.Msg = &MsgUpdateVessel{}

func NewMsgUpdateVessel(
	creator string,
	imo string,
	ts uint64,
	source string,
	lat int32,
	lon int32,
	speed int32,
	course int32,
	heading int32,
	adt uint64,
	eta uint64,
	name string,
	destport string,
	depport string,
	mmsi string,

) *MsgUpdateVessel {
	return &MsgUpdateVessel{
		Creator:  creator,
		Imo:      imo,
		Ts:       ts,
		Source:   source,
		Lat:      lat,
		Lon:      lon,
		Speed:    speed,
		Course:   course,
		Heading:  heading,
		Adt:      adt,
		Eta:      eta,
		Name:     name,
		Destport: destport,
		Depport:  depport,
		Mmsi:     mmsi,
	}
}

func (msg *MsgUpdateVessel) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}

var _ sdk.Msg = &MsgDeleteVessel{}

func NewMsgDeleteVessel(
	creator string,
	imo string,
	ts uint64,
	source string,

) *MsgDeleteVessel {
	return &MsgDeleteVessel{
		Creator: creator,
		Imo:     imo,
		Ts:      ts,
		Source:  source,
	}
}

func (msg *MsgDeleteVessel) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}
