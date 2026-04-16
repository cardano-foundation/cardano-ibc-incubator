package keeper

import (
	"context"
	"entrypoint/x/vesseloracle/types"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

func (k msgServer) TransmitReport(goCtx context.Context, msg *types.MsgTransmitReport) (*types.MsgTransmitReportResponse, error) {
	_ = sdk.UnwrapSDKContext(goCtx)
	_ = msg

	return nil, errorsmod.Wrap(
		sdkerrors.ErrInvalidRequest,
		"legacy vesseloracle packet transport has been removed; use async-ICQ on port icqhost instead",
	)
}
