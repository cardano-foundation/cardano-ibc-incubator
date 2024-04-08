package cardano

import (
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	"reflect"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// CheckForMisbehaviour detects duplicate height misbehaviour
// and verifies the correctness of a submitted Misbehaviour ClientMessage
// In Misbehaviour case, assumed that both BlockDatas is valid, and already recorded
// This function will actually confirm if found Misbehaviour or not,
// then will do frozen client
func (ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, msg exported.ClientMessage) bool {
	switch msg := msg.(type) {
	case *BlockData:
		blockData := msg
		consensusState := blockData.ConsensusState()
		blockDataHeight := blockData.GetHeight()

		// Check if the Client store already has a consensus state for the header's height
		// If the consensus state exists, and it matches the header then we return early
		// since header has already been submitted in a previous UpdateClient.
		if existingConsState, found := GetConsensusState(clientStore, cdc, blockDataHeight); found {
			// This header has already been submitted and the necessary state is already stored
			// in client store, thus we can return early without further validation.
			// TODO: Should update proto to include block hash in consensusState
			if reflect.DeepEqual(existingConsState, consensusState) { //nolint:gosimple
				return false
			}

			// A consensus state already exists for this height, but it does not match the provided header.
			// The assumption is that Header has already been validated. Thus we can return true as misbehaviour is present
			return true
		}

		// Check that consensus state timestamps are monotonic
		prevCons, prevOk := GetPreviousConsensusState(clientStore, cdc, blockDataHeight)
		nextCons, nextOk := GetNextConsensusState(clientStore, cdc, blockDataHeight)
		// if previous consensus state exists, check consensus state time is greater than previous consensus state time
		// if previous consensus state is not before current consensus state return true
		if prevOk && (!(prevCons.Timestamp < consensusState.Timestamp) || !(prevCons.Slot < consensusState.Slot)) {
			return true
		}
		// if next consensus state exists, check consensus state time is less than next consensus state time
		// if next consensus state is not after current consensus state return true
		if nextOk && (!(nextCons.Timestamp > consensusState.Timestamp) || !(nextCons.Slot > consensusState.Slot)) {
			return true
		}
	case *Misbehaviour:
		// if heights are equal check that this is valid misbehaviour of a fork
		// otherwise if heights are unequal check that this is valid misbehavior of BFT time violation
		if msg.BlockData1.GetHeight().EQ(msg.BlockData2.GetHeight()) {
			blockHash1 := msg.BlockData1.Hash
			blockHash2 := msg.BlockData2.Hash

			// Ensure that Block Hashes are different
			if blockHash1 != blockHash2 {
				return true
			}

		} else {
			// TODO: compare blockData.Hash with consState.blockHash

			csBlock1Valid := CheckBlockDataConsensusState(clientStore, cdc, msg.BlockData1)
			csBlock2Valid := CheckBlockDataConsensusState(clientStore, cdc, msg.BlockData2)
			if !csBlock1Valid || !csBlock2Valid {
				// ConsensusState not found or not match
				return true
			}
			if !msg.BlockData1.GetTime().After(msg.BlockData2.GetTime()) {
				// Block1 is at greater height than Block2, therefore Block1 time must be less than or equal to
				// Block2 time in order to be valid misbehaviour (violation of monotonic time).
				return true
			}
		}
	}

	return false
}

func CheckBlockDataConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, bd *BlockData) bool {
	currentCs := bd.ConsensusState()
	blockDataHeight := bd.GetHeight()
	if existingConsState, found := GetConsensusState(clientStore, cdc, blockDataHeight); found {
		// TODO: Should update proto to include block hash in consensusState
		if reflect.DeepEqual(existingConsState, currentCs) { //nolint:gosimple
			return true
		}
		storedBlockHash, _ := GetConsensusStateBlockHash(clientStore, blockDataHeight)
		// mismatch hash
		if storedBlockHash != bd.Hash {
			return true
		}

		return false
	}
	return false
}

// verifyMisbehaviour determines whether or not two conflicting
// blockDatas at the same height would have convinced the light client.
// Called by clientState.VerifyClientMessage, before clientState.CheckForMisbehaviour
func (cs *ClientState) verifyMisbehaviour(ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec, misbehaviour *Misbehaviour) error {
	// Regardless of the type of misbehaviour, ensure that both BlockDatas are valid and would have been accepted by light-client

	// Retrieve trusted consensus states for each BlockData in misbehaviour
	cardanoConsensusState1, found := GetConsensusState(clientStore, cdc, misbehaviour.BlockData1.Height)
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "could not get consensus state from clientStore for BlockData1 at Height: %s", misbehaviour.BlockData1.Height)
	}

	cardanoConsensusState2, found := GetConsensusState(clientStore, cdc, misbehaviour.BlockData2.Height)
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "could not get trusted consensus state from clientStore for BlockData2 at TrustedHeight: %s", misbehaviour.BlockData2.Height)
	}

	// Check if blockDatas is valid or not
	if err := checkMisbehaviourBlockData(
		ctx, clientStore, cdc, cs, cardanoConsensusState1, misbehaviour.BlockData1, ctx.BlockTime(),
	); err != nil {
		return errorsmod.Wrap(err, "verifying BlockData1 in Misbehaviour failed")
	}
	if err := checkMisbehaviourBlockData(
		ctx, clientStore, cdc, cs, cardanoConsensusState2, misbehaviour.BlockData2, ctx.BlockTime(),
	); err != nil {
		return errorsmod.Wrap(err, "verifying BlockData2 in Misbehaviour failed")
	}

	return nil
}

// checkMisbehaviourBlockData checks that a Header in Misbehaviour is valid misbehaviour given
// a trusted ConsensusState
func checkMisbehaviourBlockData(
	ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec, clientState *ClientState, consState *ConsensusState, blockData *BlockData, currentTimestamp time.Time,
) error {
	// assert that the age of the trusted consensus state is not older than the ValidAfter period
	if uint64(currentTimestamp.Sub(consState.GetTime()).Seconds()) >= clientState.ValidAfter {
		return errorsmod.Wrapf(
			ErrTrustingPeriodExpired,
			"CheckMisbehaviourBlockData: current timestamp minus the latest consensus state timestamp is greater than or equal to the ValidAfter period (%d >= %d)",
			uint64(currentTimestamp.Sub(consState.GetTime()).Seconds()), clientState.ValidAfter,
		)
	}

	tmpCs := NewClientState(
		clientState.ChainId,
		clientState.LatestHeight,
		clientState.ValidAfter,
		clientState.GenesisTime,
		blockData.EpochNo,
		clientState.EpochLength,
		clientState.SlotPerKesPeriod,
		clientState.CurrentValidatorSet,
		clientState.NextValidatorSet,
		clientState.TrustingPeriod,
		clientState.UpgradePath,
		clientState.TokenConfigs,
	)
	err := tmpCs.verifyBlockData(ctx, clientStore, cdc, blockData)

	if err != nil {
		return errorsmod.Wrap(err, "CheckMisbehaviourBlockData: Failed verifyBlockData")
	}

	return nil
}
