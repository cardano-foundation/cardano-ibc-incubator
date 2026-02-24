package keeper

import (
	"context"
	"entrypoint/x/vesseloracle/types"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

func (k msgServer) CreateVessel(goCtx context.Context, msg *types.MsgCreateVessel) (*types.MsgCreateVesselResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Check if the value already exists
	_, isFound := k.GetVessel(
		ctx,
		msg.Imo,
		msg.Ts,
		msg.Source,
	)
	if isFound {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "index already set")
	}

	var vessel = types.Vessel{
		Creator:  msg.Creator,
		Imo:      msg.Imo,
		Ts:       msg.Ts,
		Source:   msg.Source,
		Lat:      msg.Lat,
		Lon:      msg.Lon,
		Speed:    msg.Speed,
		Course:   msg.Course,
		Heading:  msg.Heading,
		Adt:      msg.Adt,
		Eta:      msg.Eta,
		Name:     msg.Name,
		Destport: msg.Destport,
		Depport:  msg.Depport,
		Mmsi:     msg.Mmsi,
	}

	k.SetVessel(ctx, vessel)

	return &types.MsgCreateVesselResponse{}, nil
}

func (k msgServer) UpdateVessel(goCtx context.Context, msg *types.MsgUpdateVessel) (*types.MsgUpdateVesselResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Check if the value exists
	valFound, isFound := k.GetVessel(
		ctx,
		msg.Imo,
		msg.Ts,
		msg.Source,
	)
	if !isFound {
		return nil, errorsmod.Wrap(sdkerrors.ErrKeyNotFound, "index not set")
	}

	// Checks if the msg creator is the same as the current owner
	if msg.Creator != valFound.Creator {
		return nil, errorsmod.Wrap(sdkerrors.ErrUnauthorized, "incorrect owner")
	}

	var vessel = types.Vessel{
		Creator:  msg.Creator,
		Imo:      msg.Imo,
		Ts:       msg.Ts,
		Source:   msg.Source,
		Lat:      msg.Lat,
		Lon:      msg.Lon,
		Speed:    msg.Speed,
		Course:   msg.Course,
		Heading:  msg.Heading,
		Adt:      msg.Adt,
		Eta:      msg.Eta,
		Name:     msg.Name,
		Destport: msg.Destport,
		Depport:  msg.Depport,
		Mmsi:     msg.Mmsi,
	}

	k.SetVessel(ctx, vessel)

	return &types.MsgUpdateVesselResponse{}, nil
}

func (k msgServer) DeleteVessel(goCtx context.Context, msg *types.MsgDeleteVessel) (*types.MsgDeleteVesselResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Check if the value exists
	valFound, isFound := k.GetVessel(
		ctx,
		msg.Imo,
		msg.Ts,
		msg.Source,
	)
	if !isFound {
		return nil, errorsmod.Wrap(sdkerrors.ErrKeyNotFound, "index not set")
	}

	// Checks if the msg creator is the same as the current owner
	if msg.Creator != valFound.Creator {
		return nil, errorsmod.Wrap(sdkerrors.ErrUnauthorized, "incorrect owner")
	}

	k.RemoveVessel(
		ctx,
		msg.Imo,
		msg.Ts,
		msg.Source,
	)

	return &types.MsgDeleteVesselResponse{}, nil
}
