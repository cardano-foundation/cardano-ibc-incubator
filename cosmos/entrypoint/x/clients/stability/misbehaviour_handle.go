package stability

import (
	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func (ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, msg exported.ClientMessage) bool {
	return false
}

func (cs *ClientState) verifyMisbehaviour(ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec, misbehaviour *Misbehaviour) error {
	_, found := GetConsensusState(clientStore, cdc, misbehaviour.StabilityHeader1.GetHeight())
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "could not get consensus state from clientStore for StabilityHeader1 in Misbehaviour at Height: %s", misbehaviour.StabilityHeader1.GetHeight())
	}
	_, found = GetConsensusState(clientStore, cdc, misbehaviour.StabilityHeader2.GetHeight())
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "could not get consensus state from clientStore for StabilityHeader2 in Misbehaviour at Height: %s", misbehaviour.StabilityHeader2.GetHeight())
	}
	if err := cs.verifyHeader(ctx, clientStore, cdc, misbehaviour.StabilityHeader1); err != nil {
		return errorsmod.Wrap(err, "verifying StabilityHeader1 in Misbehaviour failed")
	}
	if err := cs.verifyHeader(ctx, clientStore, cdc, misbehaviour.StabilityHeader2); err != nil {
		return errorsmod.Wrap(err, "verifying StabilityHeader2 in Misbehaviour failed")
	}
	return nil
}
