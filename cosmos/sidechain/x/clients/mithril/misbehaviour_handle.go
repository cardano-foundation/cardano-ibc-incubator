package mithril

import (
	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// CheckForMisbehaviour detects duplicate height misbehaviour and time violation misbehaviour
// in a submitted MithrilHeader message and verifies the correctness of a submitted Misbehaviour ClientMessage
func (ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, msg exported.ClientMessage) bool {
	// switch msg := msg.(type) {
	// case *MithrilHeader:
	// 	mithrilHeader := msg
	// 	consState := mithrilHeader.ConsensusState()

	// 	// Check if the Client store already has a consensus state for the header's height
	// 	// If the consensus state exists, and it matches the header then we return early
	// 	// since header has already been submitted in a previous UpdateClient.
	// 	if existingConsState, found := GetConsensusState(clientStore, cdc, mithrilHeader.GetHeight()); found {
	// 		// If this header has already been submitted and the necessary state is already stored
	// 		// in client store, thus we can return false
	// 		// Else if a consensus state already exists for this height, but it does not match the provided header,
	// 		// thus we can return true
	// 		// The assumption is that MithrilHeader has already been validated.
	// 		return !reflect.DeepEqual(existingConsState, mithrilHeader.ConsensusState())
	// 	}

	// 	// Check that consensus state timestamps are monotonic
	// 	prevCons, prevOk := GetPreviousConsensusState(clientStore, cdc, mithrilHeader.GetHeight())
	// 	nextCons, nextOk := GetNextConsensusState(clientStore, cdc, mithrilHeader.GetHeight())
	// 	// if previous consensus state exists, check consensus state time is greater than previous consensus state time
	// 	// if previous consensus state is not before current consensus state return true
	// 	if prevOk && !(prevCons.Timestamp < consState.Timestamp) {
	// 		return true
	// 	}
	// 	// if next consensus state exists, check consensus state time is less than next consensus state time
	// 	// if next consensus state is not after current consensus state return true
	// 	if nextOk && !(nextCons.Timestamp > consState.Timestamp) {
	// 		return true
	// 	}
	// case *Misbehaviour:
	// 	// if heights are equal check that this is valid misbehaviour of a fork
	// 	// otherwise if heights are unequal check that this is valid misbehavior of BFT time violation
	// 	if msg.MithrilHeader1.GetHeight().EQ(msg.MithrilHeader2.GetHeight()) {
	// 		// Ensure that Transaction Snapshot Hashes are different
	// 		if msg.MithrilHeader1.TransactionSnapshot.SnapshotHash != msg.MithrilHeader2.TransactionSnapshot.SnapshotHash {
	// 			return true
	// 		}

	// 	} else if !msg.MithrilHeader1.GetTime().After(msg.MithrilHeader2.GetTime()) {
	// 		// MithrilHeader1 is at greater height than MithrilHeader2, therefore MithrilHeader1 time must be less than or equal to
	// 		// MithrilHeader2 time in order to be valid misbehaviour (violation of monotonic time).
	// 		return true
	// 	}
	// }

	return false
}

// verifyMisbehaviour determines whether or not two conflicting
// headers at the same height would have convinced the light client.
// Misbehaviour sets frozen height to {0, 1} since it is only used as a boolean value (zero or non-zero).
// Called by clientState.VerifyClientMessage, before clientState.CheckForMisbehaviour
func (cs *ClientState) verifyMisbehaviour(ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec, misbehaviour *Misbehaviour) error {
	// Regardless of the type of misbehaviour, ensure that both mithril headers are valid and would have been accepted by light-client

	// Check clientStore stored the respective consensus state for each MithrilHeader in misbehaviour or not
	_, found := GetConsensusState(clientStore, cdc, misbehaviour.MithrilHeader1.GetHeight())
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "could not get consensus state from clientStore for MithrilHeader1 in Misbehaviour at Height: %s", misbehaviour.MithrilHeader1.GetHeight())
	}

	_, found = GetConsensusState(clientStore, cdc, misbehaviour.MithrilHeader2.GetHeight())
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "could not get consensus state from clientStore for MithrilHeader2 in Misbehaviour at Height: %s", misbehaviour.MithrilHeader2.GetHeight())
	}

	// Check the validity of the two conflicting headers
	if err := cs.verifyHeader(ctx, clientStore, cdc, misbehaviour.MithrilHeader1); err != nil {
		return errorsmod.Wrap(err, "verifying MithrilHeader1 in Misbehaviour failed")
	}

	if err := cs.verifyHeader(ctx, clientStore, cdc, misbehaviour.MithrilHeader2); err != nil {
		return errorsmod.Wrap(err, "verifying MithrilHeader2 in Misbehaviour failed")
	}

	return nil
}
