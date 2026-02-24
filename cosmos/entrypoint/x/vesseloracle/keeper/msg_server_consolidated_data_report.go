package keeper

import (
	"context"

	"entrypoint/x/vesseloracle/types"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

func (k msgServer) CreateConsolidatedDataReport(goCtx context.Context, msg *types.MsgCreateConsolidatedDataReport) (*types.MsgCreateConsolidatedDataReportResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Check if the value already exists
	_, isFound := k.GetConsolidatedDataReport(
		ctx,
		msg.Imo,
		msg.Ts,
	)
	if isFound {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "index already set")
	}

	var consolidatedDataReport = types.ConsolidatedDataReport{
		Creator:        msg.Creator,
		Imo:            msg.Imo,
		Ts:             msg.Ts,
		TotalSamples:   msg.TotalSamples,
		EtaOutliers:    msg.EtaOutliers,
		EtaMeanCleaned: msg.EtaMeanCleaned,
		EtaMeanAll:     msg.EtaMeanAll,
		EtaStdCleaned:  msg.EtaStdCleaned,
		EtaStdAll:      msg.EtaStdAll,
		DepportScore:   msg.DepportScore,
		Depport:        msg.Depport,
	}

	k.SetConsolidatedDataReport(
		ctx,
		consolidatedDataReport,
	)
	return &types.MsgCreateConsolidatedDataReportResponse{}, nil
}

func (k msgServer) UpdateConsolidatedDataReport(goCtx context.Context, msg *types.MsgUpdateConsolidatedDataReport) (*types.MsgUpdateConsolidatedDataReportResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Check if the value exists
	valFound, isFound := k.GetConsolidatedDataReport(
		ctx,
		msg.Imo,
		msg.Ts,
	)
	if !isFound {
		return nil, errorsmod.Wrap(sdkerrors.ErrKeyNotFound, "index not set")
	}

	// Checks if the msg creator is the same as the current owner
	if msg.Creator != valFound.Creator {
		return nil, errorsmod.Wrap(sdkerrors.ErrUnauthorized, "incorrect owner")
	}

	var consolidatedDataReport = types.ConsolidatedDataReport{
		Creator:        msg.Creator,
		Imo:            msg.Imo,
		Ts:             msg.Ts,
		TotalSamples:   msg.TotalSamples,
		EtaOutliers:    msg.EtaOutliers,
		EtaMeanCleaned: msg.EtaMeanCleaned,
		EtaMeanAll:     msg.EtaMeanAll,
		EtaStdCleaned:  msg.EtaStdCleaned,
		EtaStdAll:      msg.EtaStdAll,
		DepportScore:   msg.DepportScore,
		Depport:        msg.Depport,
	}

	k.SetConsolidatedDataReport(ctx, consolidatedDataReport)

	return &types.MsgUpdateConsolidatedDataReportResponse{}, nil
}

func (k msgServer) DeleteConsolidatedDataReport(goCtx context.Context, msg *types.MsgDeleteConsolidatedDataReport) (*types.MsgDeleteConsolidatedDataReportResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Check if the value exists
	valFound, isFound := k.GetConsolidatedDataReport(
		ctx,
		msg.Imo,
		msg.Ts,
	)
	if !isFound {
		return nil, errorsmod.Wrap(sdkerrors.ErrKeyNotFound, "index not set")
	}

	// Checks if the msg creator is the same as the current owner
	if msg.Creator != valFound.Creator {
		return nil, errorsmod.Wrap(sdkerrors.ErrUnauthorized, "incorrect owner")
	}

	k.RemoveConsolidatedDataReport(
		ctx,
		msg.Imo,
		msg.Ts,
	)

	return &types.MsgDeleteConsolidatedDataReportResponse{}, nil
}
