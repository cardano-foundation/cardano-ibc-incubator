package stability

import (
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func (ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, msg exported.ClientMessage) bool {
	switch msg := msg.(type) {
	case *StabilityHeader:
		if existingConsState, found := GetConsensusState(clientStore, cdc, msg.GetHeight()); found {
			return !strings.EqualFold(existingConsState.AcceptedBlockHash, msg.AnchorBlock.Hash)
		}
	case *Misbehaviour:
		return headersConflict(msg.StabilityHeader1, msg.StabilityHeader2)
	}

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
	if !headersConflict(misbehaviour.StabilityHeader1, misbehaviour.StabilityHeader2) {
		return errorsmod.Wrap(clienttypes.ErrInvalidMisbehaviour, "stability headers do not conflict")
	}
	return nil
}

func headersConflict(header1, header2 *StabilityHeader) bool {
	if header1 == nil || header2 == nil {
		return false
	}

	if header1.GetHeight().EQ(header2.GetHeight()) {
		return !strings.EqualFold(header1.AnchorBlock.Hash, header2.AnchorBlock.Hash)
	}

	if header1.GetHeight().GT(header2.GetHeight()) {
		return !header1.GetTime().After(header2.GetTime())
	}

	return !header2.GetTime().After(header1.GetTime())
}
