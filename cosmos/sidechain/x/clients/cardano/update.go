package cardano

import (
	"fmt"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/fxamacker/cbor/v2"

	"encoding/hex"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"golang.org/x/crypto/blake2b"
)

// VerifyClientMessage checks if the clientMessage is of type Header or Misbehaviour and verifies the message
func (cs *ClientState) VerifyClientMessage(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) error {
	switch msg := clientMsg.(type) {
	case *BlockData:
		return cs.verifyBlockData(ctx, clientStore, cdc, msg)
	case *Misbehaviour:
		return cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	default:
		return clienttypes.ErrInvalidClientType
	}
}

func unpackVerifyBlockOutput(s string) VerifyBlockOutput {
	data, _ := hex.DecodeString(s)
	var vOutput VerifyBlockOutput
	err2 := cbor.Unmarshal(data, &vOutput)
	if err2 != nil {
		fmt.Println("error:", err2)
	}
	return vOutput
}

func extractBlockOutput(s string) ExtractBlockOutput {
	data, _ := hex.DecodeString(s)
	var vOutput ExtractBlockOutput
	err2 := cbor.Unmarshal(data, &vOutput)
	if err2 != nil {
		fmt.Println("error:", err2)
	}
	return vOutput
}

// verifyBlockData returns an error if:
// - signature is not valid
// - vrf key hash is not in SPO list
// - header timestamp is past the trusting period in relation to the consensus state
func (cs *ClientState) verifyBlockData(
	ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec,
	blockData *BlockData,
) error {
	vOutput := VerifyBlock(BlockHexCbor{
		HeaderCbor:    blockData.HeaderCbor,
		Eta0:          blockData.EpochNonce,
		Spk:           int(cs.SlotPerKesPeriod),
		BlockBodyCbor: blockData.BodyCbor,
	})

	if len(vOutput) == 0 {
		return errorsmod.Wrapf(ErrInvalidBlockData, "Verify: Invalid block data")
	}
	vOutputObj := unpackVerifyBlockOutput(vOutput)

	if !vOutputObj.IsValid {
		return errorsmod.Wrap(ErrInvalidBlockData, "Verify: Invalid block data")
	}

	// check, calculator and store validator set for new epoch
	if cs.CurrentEpoch != blockData.EpochNo {
		newValidatorSet := calValidatorsNewEpoch(clientStore, cs.CurrentEpoch, blockData.EpochNo)

		// verify
		if !newValidatorSetIsValid(newValidatorSet, vOutputObj.VrfKHexString) {
			return errorsmod.Wrap(ErrInvalidSPOsNewEpoch, "Verify: Invalid new validator set for new epoch")
		}

		// store
		setClientSPOs(clientStore, newValidatorSet, blockData.EpochNo)
	}

	return nil
	//currentTimestamp := ctx.BlockTime()
	//
	//// Retrieve trusted consensus states for each Header in misbehaviour
	//consState, found := GetConsensusState(clientStore, cdc, blockData.TrustedHeight)
	//if !found {
	//	return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "could not get trusted consensus state from clientStore for Header at TrustedHeight: %s", blockData.TrustedHeight)
	//}
	//
	//if err := checkTrustedBlockHeader(blockData, consState); err != nil {
	//	return err
	//}
	//
	//// UpdateClient only accepts updates with a blockData at the same revision
	//// as the trusted consensus state
	//if blockData.GetHeight().GetRevisionNumber() != blockData.TrustedHeight.RevisionNumber {
	//	return errorsmod.Wrapf(
	//		ErrInvalidBlockDataHeight,
	//		"blockData height revision %d does not match trusted blockData revision %d",
	//		blockData.GetHeight().GetRevisionNumber(), blockData.TrustedHeight.RevisionNumber,
	//	)
	//}
	//
	//tmTrustedValidators, err := tmtypes.ValidatorSetFromProto(blockData.TrustedValidators)
	//if err != nil {
	//	return errorsmod.Wrap(err, "trusted validator set in not cardano validator set type")
	//}
	//
	//tmSignedHeader, err := tmtypes.SignedHeaderFromProto(blockData.SignedHeader)
	//if err != nil {
	//	return errorsmod.Wrap(err, "signed blockData in not cardano signed blockData type")
	//}
	//
	//tmValidatorSet, err := tmtypes.ValidatorSetFromProto(blockData.ValidatorSet)
	//if err != nil {
	//	return errorsmod.Wrap(err, "validator set in not cardano validator set type")
	//}
	//
	//// assert blockData height is newer than consensus state
	//if blockData.GetHeight().LTE(blockData.TrustedHeight) {
	//	return errorsmod.Wrapf(
	//		clienttypes.ErrInvalidHeader,
	//		"blockData height ≤ consensus state height (%s ≤ %s)", blockData.GetHeight(), blockData.TrustedHeight,
	//	)
	//}
	//
	//// Construct a trusted blockData using the fields in consensus state
	//// Only Height, Time, and NextValidatorsHash are necessary for verification
	//// NOTE: updates must be within the same revision
	//trustedHeader := tmtypes.Header{
	//	ChainID:            cs.GetChainID(),
	//	Height:             int64(blockData.TrustedHeight.RevisionHeight),
	//	Time:               consState.Timestamp,
	//	NextValidatorsHash: consState.NextValidatorsHash,
	//}
	//signedHeader := tmtypes.SignedHeader{
	//	Header: &trustedHeader,
	//}
	//
	//// Verify next blockData with the passed-in trustedVals
	//// - asserts trusting period not passed
	//// - assert blockData timestamp is not past the trusting period
	//// - assert blockData timestamp is past latest stored consensus state timestamp
	//// - assert that a TrustLevel proportion of TrustedValidators signed new Commit
	//err = light.Verify(
	//	&signedHeader,
	//	tmTrustedValidators, tmSignedHeader, tmValidatorSet,
	//	cs.TrustingPeriod, currentTimestamp, cs.MaxClockDrift, cs.TrustLevel.ToCardano(),
	//)
	//if err != nil {
	//	return errorsmod.Wrap(err, "failed to verify blockData")
	//}
	//
	//return nil
}

// calValidatorsNewEpoch calculate SPO for new epoch
func calValidatorsNewEpoch(clientStore storetypes.KVStore, oldEpoch, newEpoch uint64) []*Validator {
	// current validator set
	oldValidatorSetBytes := clientStore.Get(ClientSPOsKey(oldEpoch))
	oldValidatorSet := MustUnmarshalClientSPOs(oldValidatorSetBytes)

	// get next register cert
	registerCert := getRegisterCert(clientStore, newEpoch)

	// get next register cert
	unregisterCert := getUnregisterCert(clientStore, fmt.Sprint(newEpoch))

	// calculate
	newValidatorSet := make([]*Validator, 0)
	for _, validator := range oldValidatorSet {
		// check register list
		for _, cert := range registerCert {
			if strings.EqualFold(cert.RegisPoolId, validator.PoolId) {
				// update pool vrf key
				newValidatorSet = append(newValidatorSet, &Validator{
					VrfKeyHash: cert.RegisPoolVrf,
					PoolId:     cert.RegisPoolId,
				})
				continue
			}
		}

		// check unregister list
		for _, cert := range unregisterCert {
			if cert.DeRegisPoolId == validator.PoolId {
				continue
			}
		}

		// set new validator
		newValidatorSet = append(newValidatorSet, validator)
	}
	return newValidatorSet
}

func newValidatorSetIsValid(validatorSet []*Validator, vrfKHexString string) bool {
	bytesVrfKey, err := hex.DecodeString(vrfKHexString)
	if err != nil {
		return false
	}
	hashBytesVrfKey := blake2b.Sum256(bytesVrfKey)
	for _, validator := range validatorSet {
		if strings.EqualFold(validator.VrfKeyHash, hex.EncodeToString(hashBytesVrfKey[:])) {
			return true
		}
	}
	return false
}

// UpdateState may be used to either create a consensus state for:
// - a future height greater than the latest client state height
// - a past height that was skipped during bisection
// If we are updating to a past height, a consensus state is created for that height to be persisted in client store
// If we are updating to a future height, the consensus state is created and the client state is updated to reflect
// the new latest height
// A list containing the updated consensus height is returned.
// UpdateState must only be used to update within a single revision, thus header revision number and trusted height's revision
// number must be the same. To update to a new revision, use a separate upgrade path
// UpdateState will prune the oldest consensus state if it is expired.
func (cs ClientState) UpdateState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, clientMsg exported.ClientMessage) []exported.Height {
	blockData, ok := clientMsg.(*BlockData)
	if !ok {
		panic(fmt.Errorf("expected type %T, got %T", &BlockData{}, clientMsg))
	}

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)

	// check for duplicate update
	if _, found := GetConsensusState(clientStore, cdc, blockData.GetHeight()); found {
		// perform no-op
		return []exported.Height{blockData.GetHeight()}
	}

	height := blockData.Height
	if height.GT(*cs.LatestHeight) {
		cs.LatestHeight = height
	}

	// update current epoch - TODO: check range need to update
	if cs.CurrentEpoch != blockData.EpochNo {
		// update ClientState
		cs.CurrentEpoch = blockData.EpochNo
		cs.CurrentValidatorSet = getClientSPOs(clientStore, blockData.EpochNo)
		// TODO: update NextValidatorSet after set (maybe set when verify BlockData)
		//cs.NextValidatorSet = getClientSPOs(clientStore, blockData.EpochNo + 1)
	}

	consensusState := &ConsensusState{
		Timestamp: uint64(blockData.GetTime().Unix()),
		Slot:      blockData.Slot,
	}

	// set client state, consensus state and asssociated metadata
	setClientState(clientStore, cdc, &cs)
	setConsensusState(clientStore, cdc, consensusState, blockData.GetHeight())
	setConsensusMetadata(ctx, clientStore, blockData.GetHeight())

	blockOutput := extractBlockOutput(ExtractBlockData(blockData.BodyCbor))

	// update register cert
	updateRegisterCert(clientStore, blockOutput.RegisCerts, blockData.EpochNo)
	// update unregister cert
	updateUnregisterCert(clientStore, blockOutput.DeRegisCerts)

	// set UTXOs
	setUTXOs(clientStore, blockOutput.Outputs,blockData.GetHeight())
	return []exported.Height{height}
}

// pruneOldestConsensusState will retrieve the earliest consensus state for this clientID and check if it is expired. If it is,
// that consensus state will be pruned from store along with all associated metadata. This will prevent the client store from
// becoming bloated with expired consensus states that can no longer be used for updates and packet verification.
func (cs ClientState) pruneOldestConsensusState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore) {
	// Check the earliest consensus state to see if it is expired, if so then set the prune height
	// so that we can delete consensus state and all associated metadata.
	var (
		pruneHeight exported.Height
	)

	pruneCb := func(height exported.Height) bool {
		consState, found := GetConsensusState(clientStore, cdc, height)
		// this error should never occur
		if !found {
			panic(errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "failed to retrieve consensus state at height: %s", height))
		}

		if cs.IsExpired(consState.GetTime(), ctx.BlockTime()) {
			pruneHeight = height
		}

		return true
	}

	IterateConsensusStateAscending(clientStore, pruneCb)

	// if pruneHeight is set, delete consensus state and metadata
	if pruneHeight != nil {
		deleteConsensusState(clientStore, pruneHeight)
		deleteConsensusMetadata(clientStore, pruneHeight)
	}
}

// UpdateStateOnMisbehaviour updates state upon misbehaviour, freezing the ClientState. This method should only be called when misbehaviour is detected
// as it does not perform any misbehaviour checks.
func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, _ exported.ClientMessage) {
	cs.FrozenHeight = &FrozenHeight

	clientStore.Set(host.ClientStateKey(), clienttypes.MustMarshalClientState(cdc, &cs))
}

// checkTrustedBlockHeader checks that consensus state matches trusted fields of Header
//func checkTrustedBlockHeader(header *Header, consState *ConsensusState) error {
//	tmTrustedValidators, err := tmtypes.ValidatorSetFromProto(header.TrustedValidators)
//	if err != nil {
//		return errorsmod.Wrap(err, "trusted validator set in not cardano validator set type")
//	}
//
//	// assert that trustedVals is NextValidators of last trusted header
//	// to do this, we check that trustedVals.Hash() == consState.NextValidatorsHash
//	tvalHash := tmTrustedValidators.Hash()
//	if !bytes.Equal(consState.NextValidatorsHash, tvalHash) {
//		return errorsmod.Wrapf(
//			ErrInvalidValidatorSet,
//			"trusted validators %s, does not hash to latest trusted validators. Expected: %X, got: %X",
//			header.TrustedValidators, consState.NextValidatorsHash, tvalHash,
//		)
//	}
//	return nil
//}
