package keeper

import (
	"context"
	"entrypoint/x/vesseloracle/types"
	"fmt"
	"time"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

func (k msgServer) TransmitReport(goCtx context.Context, msg *types.MsgTransmitReport) (*types.MsgTransmitReportResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	report, found := k.GetConsolidatedDataReport(ctx, msg.Imo, msg.Ts)
	if !found {
		return nil, errorsmod.Wrap(sdkerrors.ErrLogic, fmt.Sprintf("Cannot find a consolidated data report with imo %v and ts %v", msg.Imo, msg.Ts))
	}

	k.TransmitConsolidatedDataReportPacketPacket(
		ctx, types.ConsolidatedDataReportPacketPacketData{
			Imo:            report.Imo,
			Ts:             report.Ts,
			TotalSamples:   report.TotalSamples,
			EtaOutliers:    report.EtaOutliers,
			EtaMeanCleaned: report.EtaMeanCleaned,
			EtaStdCleaned:  report.EtaStdCleaned,
			EtaMeanAll:     report.EtaMeanAll,
			EtaStdAll:      report.EtaStdAll,
			Depport:        report.Depport,
			DepportScore:   report.DepportScore,
		},
		types.PortID,
		msg.Channel,
		clienttypes.NewHeight(1, uint64(ctx.BlockHeight()+1000)),
		uint64(ctx.BlockTime().UnixNano()+int64(10*time.Minute)),
	)
	return &types.MsgTransmitReportResponse{
		Imo: msg.Imo,
		Ts:  msg.Ts,
	}, nil
}
