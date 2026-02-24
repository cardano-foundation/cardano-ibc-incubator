package types

import (
	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

var _ sdk.Msg = &MsgCreateConsolidatedDataReport{}

func NewMsgCreateConsolidatedDataReport(
	creator string,
	imo string,
	ts uint64,
	totalSamples int32,
	etaOutliers int32,
	etaMeanCleaned uint64,
	etaMeanAll uint64,
	etaStdCleaned uint64,
	etaStdAll uint64,
	depportScore int32,
	depport string,

) *MsgCreateConsolidatedDataReport {
	return &MsgCreateConsolidatedDataReport{
		Creator:        creator,
		Imo:            imo,
		Ts:             ts,
		TotalSamples:   totalSamples,
		EtaOutliers:    etaOutliers,
		EtaMeanCleaned: etaMeanCleaned,
		EtaMeanAll:     etaMeanAll,
		EtaStdCleaned:  etaStdCleaned,
		EtaStdAll:      etaStdAll,
		DepportScore:   depportScore,
		Depport:        depport,
	}
}

func (msg *MsgCreateConsolidatedDataReport) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}

var _ sdk.Msg = &MsgUpdateConsolidatedDataReport{}

func NewMsgUpdateConsolidatedDataReport(
	creator string,
	imo string,
	ts uint64,
	totalSamples int32,
	etaOutliers int32,
	etaMeanCleaned uint64,
	etaMeanAll uint64,
	etaStdCleaned uint64,
	etaStdAll uint64,
	depportScore int32,
	depport string,

) *MsgUpdateConsolidatedDataReport {
	return &MsgUpdateConsolidatedDataReport{
		Creator:        creator,
		Imo:            imo,
		Ts:             ts,
		TotalSamples:   totalSamples,
		EtaOutliers:    etaOutliers,
		EtaMeanCleaned: etaMeanCleaned,
		EtaMeanAll:     etaMeanAll,
		EtaStdCleaned:  etaStdCleaned,
		EtaStdAll:      etaStdAll,
		DepportScore:   depportScore,
		Depport:        depport,
	}
}

func (msg *MsgUpdateConsolidatedDataReport) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}

var _ sdk.Msg = &MsgDeleteConsolidatedDataReport{}

func NewMsgDeleteConsolidatedDataReport(
	creator string,
	imo string,
	ts uint64,

) *MsgDeleteConsolidatedDataReport {
	return &MsgDeleteConsolidatedDataReport{
		Creator: creator,
		Imo:     imo,
		Ts:      ts,
	}
}

func (msg *MsgDeleteConsolidatedDataReport) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}
