package cardano

import (
	"bytes"
	"strings"
	"time"

	// ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	tmtypes "github.com/cometbft/cometbft/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	ibcerrors "github.com/cosmos/ibc-go/v8/modules/core/errors"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	tmStruct "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
)

var _ exported.ClientState = (*ClientState)(nil)

// NewClientState creates a new ClientState instance
func NewClientState(
	chainID string,
	latestHeight *Height,
	validAfter uint64,
	genesisTime uint64,
	currentEpoch uint64,
	epochLength uint64,
	slotPerKesPeriod uint64,
	currentValidatorSet []*Validator,
	nextValidatorSet []*Validator,
	trustingPeriod uint64,
	upgradePath []string,
	tokenConfigs *TokenConfigs,
) *ClientState {
	zeroHeight := ZeroHeight()
	return &ClientState{
		ChainId:             chainID,
		LatestHeight:        latestHeight,
		FrozenHeight:        &zeroHeight,
		ValidAfter:          validAfter,
		GenesisTime:         genesisTime,
		CurrentEpoch:        currentEpoch,
		EpochLength:         epochLength,
		SlotPerKesPeriod:    slotPerKesPeriod,
		CurrentValidatorSet: currentValidatorSet,
		NextValidatorSet:    nextValidatorSet,
		TrustingPeriod:      trustingPeriod,
		UpgradePath:         upgradePath,
		TokenConfigs:        tokenConfigs,
	}
}

// GetChainID returns the chain-id
func (cs ClientState) GetChainID() string {
	return cs.ChainId
}

// ClientType is Cardano.
func (ClientState) ClientType() string {
	return ModuleName
}

// GetLatestHeight returns latest block height.
func (cs ClientState) GetLatestHeight() exported.Height {
	return Height{
		RevisionNumber: cs.LatestHeight.RevisionNumber,
		RevisionHeight: cs.LatestHeight.RevisionHeight,
	}
}

// GetCurrentValidatorSet returns current validator set.
func (cs ClientState) GetCurrentValidatorSet() []*Validator {
	return cs.CurrentValidatorSet
}

// GetTimestampAtHeight returns the timestamp in nanoseconds of the consensus state at the given height.
func (ClientState) GetTimestampAtHeight(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
) (uint64, error) {
	// get consensus state at height from clientStore to check for expiry
	consState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return 0, errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height)
	}
	return consState.GetTimestamp(), nil
}

// Status returns the status of the Cardano client.
// The client may be:
// - Active: FrozenHeight is zero and client is not expired
// - Frozen: Frozen Height is not zero
// - Expired: the latest consensus state timestamp + trusting period <= current time
//
// A frozen client will become expired, so the Frozen status
// has higher precedence.
func (cs ClientState) Status(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
) exported.Status {
	if !cs.FrozenHeight.IsZero() {
		return exported.Frozen
	}

	// get latest consensus state from clientStore to check for expiry
	_, found := GetConsensusState(clientStore, cdc, cs.GetLatestHeight())
	if !found {
		// if the client state does not have an associated consensus state for its latest height
		// then it must be expired
		return exported.Expired
	}

	// TODO: check with trusted period
	//if cs.IsExpired(consState.Timestamp, ctx.BlockTime()) {
	//	return exported.Expired
	//}

	return exported.Active
}

// IsExpired returns whether or not the client has passed the trusting period since the last
// update (in which case no headers are considered valid).
func (cs ClientState) IsExpired(latestTimestamp, now time.Time) bool {
	expirationTime := latestTimestamp.Add(time.Duration(cs.TrustingPeriod * uint64(time.Second)))
	return !expirationTime.After(now)
}

// Validate performs a basic validation of the client state fields.
func (cs ClientState) Validate() error {
	if strings.TrimSpace(cs.ChainId) == "" {
		return errorsmod.Wrap(ErrInvalidChainID, "chain id cannot be empty string")
	}

	if len(cs.ChainId) > tmtypes.MaxChainIDLen {
		return errorsmod.Wrapf(ErrInvalidChainID, "chainID is too long; got: %d, max: %d", len(cs.ChainId), tmtypes.MaxChainIDLen)
	}

	if cs.TrustingPeriod <= 0 {
		return errorsmod.Wrap(ErrInvalidTrustingPeriod, "trusting period must be greater than zero")
	}

	// the latest height revision number must match the chain id revision number
	if cs.LatestHeight.RevisionNumber != clienttypes.ParseChainID(cs.ChainId) {
		return errorsmod.Wrapf(ErrInvalidBlockDataHeight,
			"latest height revision number must match chain id revision number (%d != %d)", cs.LatestHeight.RevisionNumber, clienttypes.ParseChainID(cs.ChainId))
	}
	if cs.LatestHeight.RevisionHeight == 0 {
		return errorsmod.Wrapf(ErrInvalidBlockDataHeight, "cardano client's latest height revision height cannot be zero")
	}

	if cs.EpochLength == 0 {
		return errorsmod.Wrapf(ErrInvalidEpochLength, "cardano client's epoch length cannot be zero")
	}
	if cs.SlotPerKesPeriod == 0 {
		return errorsmod.Wrapf(ErrInvalidEpochLength, "cardano client's slot per kes period cannot be zero")
	}

	// UpgradePath may be empty, but if it isn't, each key must be non-empty
	for i, k := range cs.UpgradePath {
		if strings.TrimSpace(k) == "" {
			return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "key in upgrade path at index %d cannot be empty", i)
		}
	}
	// TODO: should validate validator set and token config
	return nil
}

// ZeroCustomFields returns a ClientState that is a copy of the current ClientState
// with all client customizable fields zeroed out
func (cs ClientState) ZeroCustomFields() exported.ClientState {
	// copy over all chain-specified fields
	// and leave custom fields empty
	return &ClientState{
		ChainId:          cs.ChainId,
		LatestHeight:     cs.LatestHeight,
		UpgradePath:      cs.UpgradePath,
		EpochLength:      cs.EpochLength,
		CurrentEpoch:     cs.CurrentEpoch,
		SlotPerKesPeriod: cs.SlotPerKesPeriod,
		TokenConfigs:     cs.TokenConfigs,
	}
}

// Initialize checks that the initial consensus state is an 099-cardano consensus state and
// sets the client state, consensus state and associated metadata in the provided client store.
func (cs ClientState) Initialize(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, consState exported.ConsensusState) error {
	consensusState, ok := consState.(*ConsensusState)
	if !ok {
		return errorsmod.Wrapf(clienttypes.ErrInvalidConsensus, "invalid initial consensus state. expected type: %T, got: %T",
			&ConsensusState{}, consState)
	}

	setClientState(clientStore, cdc, &cs)
	setConsensusState(clientStore, cdc, consensusState, cs.GetLatestHeight())
	setConsensusMetadata(ctx, clientStore, cs.GetLatestHeight())
	// create SPOs
	setClientSPOs(clientStore, cs.CurrentValidatorSet, cs.CurrentEpoch)
	setClientSPOs(clientStore, cs.NextValidatorSet, cs.CurrentEpoch+1)
	return nil
}

// VerifyMembership is a function which verifies a proof of the existence of a value at a given CommitmentPath at the specified height.
// Since Cardano doesn't exposed and have built-in proofs like Cosmos, we will do proof using path point to correct KVStore path key belong to each Client Store
func (cs ClientState) VerifyMembership(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
	delayTimePeriod uint64,
	delayBlockPeriod uint64,
	proof []byte,
	path exported.Path,
	expectedValue []byte,
) error {
	if cs.GetLatestHeight().LT(height) {
		return errorsmod.Wrapf(
			ibcerrors.ErrInvalidHeight,
			"client state height < proof height (%d < %d), please ensure the client has been updated", cs.GetLatestHeight(), height,
		)
	}
	// TODO: verifyDelayPeriodPassed
	// if err := verifyDelayPeriodPassed(ctx, clientStore, height, delayTimePeriod, delayBlockPeriod); err != nil {
	// 	return err
	// }

	_, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "please ensure the proof was constructed against a height that exists on the client")
	}

	merklePath, _ := path.(commitmenttypes.MerklePath)
	return VerifyProof(proof, merklePath, expectedValue, cdc, clientStore)
}

// Expecting Counterpart will be Cosmos client inside Cardano chain
func VerifyProof(proofPath []byte, merklePath commitmenttypes.MerklePath, expectedValue []byte, cdc codec.BinaryCodec, clientStore storetypes.KVStore) error {
	// merkleKeyPath := merklePath.KeyPath
	if expectedValue == nil || proofPath == nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path and expectedValue is correct")
	}

	proofPathString := strings.ToLower(string(proofPath[:]))
	switch true {
	case strings.Contains(proofPathString, "/client/"):
		// get utxo
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString))
		// compare value
		if proofDataInStore == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path is correct")
		}
		return VerifyProofClientState(proofPathString, expectedValue, proofDataInStore, cdc)
	case strings.Contains(proofPathString, "/consensus/"):
		merklePathData := merklePath.KeyPath[1]
		merklePathArray := strings.Split(merklePathData, "/")
		consensusHeight := merklePathArray[3]
		// get utxo
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString + "/" + consensusHeight))
		// compare value
		if proofDataInStore == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path is correct")
		}
		return VerifyProofConsensusState(proofPathString, expectedValue, proofDataInStore, cdc)
	case strings.Contains(proofPathString, "/connection/"):
		// get utxo
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString))
		// compare value
		if proofDataInStore == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path is correct")
		}
		return VerifyProofConnectionState(proofPathString, expectedValue, proofDataInStore, cdc)
	case strings.Contains(proofPathString, "/channel/"):
		merklePathData := merklePath.KeyPath[1]
		merklePathArray := strings.Split(merklePathData, "/")
		portId := merklePathArray[2]
		channelId := merklePathArray[4]
		// get utxo
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString + "/" + portId + "/" + channelId))
		// compare value
		if proofDataInStore == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path is correct")
		}
		return VerifyProofChannelState(proofPathString, expectedValue, proofDataInStore, cdc)
	case strings.Contains(proofPathString, "/commitments/"):
		merklePathData := merklePath.KeyPath[1]
		merklePathArray := strings.Split(merklePathData, "/")
		portId := merklePathArray[2]
		channelId := merklePathArray[4]
		sequence := merklePathArray[6]
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString + "/" + portId + "/" + channelId + "/" + sequence))
		if proofDataInStore == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path is correct")
		}
		if !bytes.Equal(proofDataInStore, expectedValue) {
			return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Commitment: Commitment bytes not match, expect %v, got %v", expectedValue, proofDataInStore)
		}
		return nil
	case strings.Contains(proofPathString, "/acks/"):
		merklePathData := merklePath.KeyPath[1]
		merklePathArray := strings.Split(merklePathData, "/")
		portId := merklePathArray[2]
		channelId := merklePathArray[4]
		sequence := merklePathArray[6]
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString + "/" + portId + "/" + channelId + "/" + sequence))
		if proofDataInStore == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path is correct")
		}
		if !bytes.Equal(proofDataInStore, expectedValue) {
			return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Acknowledgement: Acknowledgement bytes not match, expect %v, got %v", expectedValue, proofDataInStore)
		}
		return nil
	case strings.Contains(proofPathString, "/nextsequencerecv/"):
		merklePathData := merklePath.KeyPath[1]
		merklePathArray := strings.Split(merklePathData, "/")
		portId := merklePathArray[2]
		channelId := merklePathArray[4]
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString + "/" + portId + "/" + channelId))
		if proofDataInStore == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path is correct")
		}
		if !bytes.Equal(proofDataInStore, expectedValue) {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "NextSequenceRecv: NextSequenceRecv bytes not match")
		}
		return nil
	default:
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "VerifyProof: not implemented")
	}
}

// ProofPath will be like this: {height}/client/{tx_hash}/{utxo_index}
// Example: 0-100/client/af.../0
// MerklePath: [connection.Counterparty.Prefix, clients/{clientID}/clientState]
func VerifyProofClientState(proofPath string, expectedValueBytes []byte, proofDataInStore []byte, cdc codec.BinaryCodec) error {
	var expectedClientStateI exported.ClientState
	var currentClientState ClientStateDatum
	errI := cdc.UnmarshalInterface(expectedValueBytes, &expectedClientStateI)
	if errI != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "Not Client state bytes")
	}
	expectedClientState := expectedClientStateI.(*tmStruct.ClientState)
	cbor.Unmarshal(proofDataInStore, &currentClientState)
	return currentClientState.Cmp(expectedClientState)
}

// ProofPath will be like this: {height}/consensus/{tx_hash}/{utxo_index}
// MerklePath: [connection.Counterparty.Prefix, clients/{client_id}/consensusStates/{consensusHeight}]
// Example: [connection.Counterparty.Prefix, "clients/{counterpart_client_id}/consensusStates/0-100"]
func VerifyProofConsensusState(proofPath string, expectedValueBytes []byte, proofDataInStore []byte, cdc codec.BinaryCodec) error {
	var expectedConsensusStateI exported.ConsensusState
	var currentConsensusState ConsensusStateDatum
	errI := cdc.UnmarshalInterface(expectedValueBytes, &expectedConsensusStateI)
	if errI != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "Not Consensus state bytes")
	}
	expectedConsensusState := expectedConsensusStateI.(*tmStruct.ConsensusState)
	cbor.Unmarshal(proofDataInStore, &currentConsensusState)
	return currentConsensusState.Cmp(expectedConsensusState)
}

// ProofPath will be like this: {height}/connection/{tx_hash}/{utxo_index}
func VerifyProofConnectionState(proofPath string, expectedValueBytes []byte, proofDataInStore []byte, cdc codec.BinaryCodec) error {
	var currentConnectionEnd ConnectionEndDatum
	var expectedConnectionEnd connectiontypes.ConnectionEnd
	errI := cdc.Unmarshal(expectedValueBytes, &expectedConnectionEnd)
	if errI != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "Not ConnectionEnd bytes")
	}
	cbor.Unmarshal(proofDataInStore, &currentConnectionEnd)
	return currentConnectionEnd.Cmp(expectedConnectionEnd)
}

// ProofPath will be like this: {height}/channel/{tx_hash}/{utxo_index}
func VerifyProofChannelState(proofPath string, expectedValueBytes []byte, proofDataInStore []byte, cdc codec.BinaryCodec) error {
	var currentChannelState ChannelDatum
	var expectedChannelState channeltypes.Channel
	errI := cdc.Unmarshal(expectedValueBytes, &expectedChannelState)
	if errI != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "Not Channel bytes")
	}
	cbor.Unmarshal(proofDataInStore, &currentChannelState)
	return currentChannelState.Cmp(expectedChannelState)
}

// VerifyMembership is a function which verifies a proof of the existence of a value at a given CommitmentPath at the specified height.
// Since Cardano doesn't exposed and have built-in proofs like Cosmos, we will do non-membership proof using path point to correct KVStore path key belong to each Client Store
// If that key doesn't exist, then it could be considered as not existed at a specified height
func (cs ClientState) VerifyNonMembership(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
	delayTimePeriod uint64,
	delayBlockPeriod uint64,
	proof []byte,
	path exported.Path,
) error {
	if cs.GetLatestHeight().LT(height) {
		return errorsmod.Wrapf(
			ibcerrors.ErrInvalidHeight,
			"client state height < proof height (%d < %d), please ensure the client has been updated", cs.GetLatestHeight(), height,
		)
	}

	// TODO: verifyDelayPeriodPassed
	// if err := verifyDelayPeriodPassed(ctx, clientStore, height, delayTimePeriod, delayBlockPeriod); err != nil {
	// 	return err
	// }

	_, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "please ensure the proof was constructed against a height that exists on the client")
	}

	merklePath, ok := path.(commitmenttypes.MerklePath)
	if !ok {
		return errorsmod.Wrapf(ibcerrors.ErrInvalidType, "expected %T, got %T", commitmenttypes.MerklePath{}, path)
	}

	return VerifyNonMembershipProof(proof, merklePath, cdc, clientStore)
}

func VerifyNonMembershipProof(proofPath []byte, merklePath commitmenttypes.MerklePath, cdc codec.BinaryCodec, clientStore storetypes.KVStore) error {
	if proofPath == nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "please ensure the proof path and expectedValue is correct")
	}

	proofPathString := string(proofPath[:])
	switch true {
	case strings.Contains(proofPathString, "/receipts/"):
		merklePathData := merklePath.KeyPath[1]
		merklePathArray := strings.Split(merklePathData, "/")
		portId := merklePathArray[2]
		channelId := merklePathArray[4]
		sequence := merklePathArray[6]
		proofDataInStore := clientStore.Get([]byte(KeyUTXOsPrefix + "/" + proofPathString + "/" + portId + "/" + channelId + "/" + sequence))
		// compare value
		if proofDataInStore != nil {
			return errorsmod.Wrap(clienttypes.ErrFailedNonMembershipVerification, "VerifyPacketReceiptAbsence: Path existed")
		}
		return nil
	default:
		return errorsmod.Wrap(clienttypes.ErrFailedNonMembershipVerification, "VerifyNonMembershipProof: not implemented")
	}
}

// verifyDelayPeriodPassed will ensure that at least delayTimePeriod amount of time and delayBlockPeriod number of blocks have passed
// since consensus state was submitted before allowing verification to continue.
// func verifyDelayPeriodPassed(ctx sdk.Context, store storetypes.KVStore, proofHeight exported.Height, delayTimePeriod, delayBlockPeriod uint64) error {
// 	if delayTimePeriod != 0 {
// 		// check that executing chain's timestamp has passed consensusState's processed time + delay time period
// 		processedTime, ok := GetProcessedTime(store, proofHeight)
// 		if !ok {
// 			return errorsmod.Wrapf(ErrProcessedTimeNotFound, "processed time not found for height: %s", proofHeight)
// 		}

// 		currentTimestamp := uint64(ctx.BlockTime().UnixNano())
// 		validTime := processedTime + delayTimePeriod

// 		// NOTE: delay time period is inclusive, so if currentTimestamp is validTime, then we return no error
// 		if currentTimestamp < validTime {
// 			return errorsmod.Wrapf(ErrDelayPeriodNotPassed, "cannot verify packet until time: %d, current time: %d",
// 				validTime, currentTimestamp)
// 		}

// 	}

// 	if delayBlockPeriod != 0 {
// 		// check that executing chain's height has passed consensusState's processed height + delay block period
// 		processedHeight, ok := GetProcessedHeight(store, proofHeight)
// 		if !ok {
// 			return errorsmod.Wrapf(ErrProcessedHeightNotFound, "processed height not found for height: %s", proofHeight)
// 		}

// 		currentHeight := clienttypes.GetSelfHeight(ctx)
// 		validHeight := clienttypes.NewHeight(processedHeight.GetRevisionNumber(), processedHeight.GetRevisionHeight()+delayBlockPeriod)

// 		// NOTE: delay block period is inclusive, so if currentHeight is validHeight, then we return no error
// 		if currentHeight.LT(validHeight) {
// 			return errorsmod.Wrapf(ErrDelayPeriodNotPassed, "cannot verify packet until height: %s, current height: %s",
// 				validHeight, currentHeight)
// 		}
// 	}

// 	return nil
// }
