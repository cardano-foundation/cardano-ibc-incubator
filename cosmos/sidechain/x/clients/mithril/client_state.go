package mithril

import (
	"strings"
	"time"

	// ics23 "github.com/cosmos/ics23/go"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	cmttypes "github.com/cometbft/cometbft/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientState = (*ClientState)(nil)

// NewClientState creates a new ClientState instance
func NewClientState(
	chainID string,
	latestHeight *Height,
	currentEpoch uint64,
	trustingPeriod time.Duration,
	protocolParameters *MithrilProtocolParameters,
	upgradePath []string,
) *ClientState {
	zeroHeight := ZeroHeight()
	return &ClientState{
		ChainId:            chainID,
		LatestHeight:       latestHeight,
		FrozenHeight:       &zeroHeight,
		CurrentEpoch:       currentEpoch,
		TrustingPeriod:     trustingPeriod,
		ProtocolParameters: protocolParameters,
		UpgradePath:        upgradePath,
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

// GetTimestampAtHeight returns the timestamp for the consensus state associated with the provided height.
// This value is used to facilitate timeouts by checking the packet timeout timestamp against the returned value.
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

// Status returns the status of the mithril client. Possible statuses:
// - Active: clients are allowed to process packets
// - Frozen: misbehaviour was detected and client is not allowed to be used
// - Expired: client was not updated for longer than the trusting period
//
// A frozen client will become expired, so the Frozen status has higher precedence.
func (cs ClientState) Status(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
) exported.Status {
	if !cs.FrozenHeight.IsZero() {
		return exported.Frozen
	}

	// get latest consensus state from clientStore to check for expiry
	consState, found := GetConsensusState(clientStore, cdc, cs.LatestHeight)
	if !found {
		// if the client state does not have an associated consensus state for its latest height
		// then it must be expired
		return exported.Expired
	}

	if cs.IsExpired(consState.Timestamp, ctx.BlockTime()) {
		return exported.Expired
	}

	return exported.Active
}

// IsExpired returns whether or not the client has passed the trusting period since the last
// update (in which case no headers are considered valid).
func (cs ClientState) IsExpired(latestTimestamp uint64, now time.Time) bool {
	// expirationTime := time.Unix(int64(latestTimestamp), 0).Add(cs.TrustingPeriod)
	return false
}

// Validate performs a basic validation of the client state fields.
func (cs ClientState) Validate() error {
	if strings.TrimSpace(cs.ChainId) == "" {
		return errorsmod.Wrap(ErrInvalidChainID, "chain id cannot be empty string")
	}

	// NOTE: the value of cmttypes.MaxChainIDLen may change in the future.
	// If this occurs, the code here must account for potential difference
	// between the tendermint version being run by the counterparty chain
	// and the tendermint version used by this light client.
	// https://github.com/cosmos/ibc-go/issues/177
	if len(cs.ChainId) > cmttypes.MaxChainIDLen {
		return errorsmod.Wrapf(ErrInvalidChainID, "chainID is too long; got: %d, max: %d", len(cs.ChainId), cmttypes.MaxChainIDLen)
	}

	if cs.LatestHeight.RevisionHeight == 0 {
		return errorsmod.Wrapf(ErrInvalidMithrilHeaderHeight, "mithril client's latest height revision height cannot be zero")
	}

	if cs.CurrentEpoch < 2 {
		return errorsmod.Wrapf(ErrInvalidHeaderEpoch, "mithril client's current epoch cannot be less than 2")
	}

	if cs.TrustingPeriod <= 0 {
		return errorsmod.Wrap(ErrInvalidTrustingPeriod, "trusting period must be greater than zero")
	}

	if err := validateProtocolParameters(cs.ProtocolParameters); err != nil {
		return errorsmod.Wrapf(ErrInvalidProtocolParamaters, err.Error())
	}

	// UpgradePath may be empty, but if it isn't, each key must be non-empty
	for i, k := range cs.UpgradePath {
		if strings.TrimSpace(k) == "" {
			return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "key in upgrade path at index %d cannot be empty", i)
		}
	}

	return nil
}

func validateProtocolParameters(pm *MithrilProtocolParameters) error {
	if pm.K == 0 {
		return errorsmod.Wrapf(ErrInvalidNumberRequiredSignatures, "number of required signatures should be greater than 0")
	}

	if pm.M == 0 {
		return errorsmod.Wrapf(ErrInvalidNumberLotteries, "number of lotteries should be greater than 0")
	}

	if pm.PhiF.Numerator == 0 || pm.PhiF.Denominator == 0 || pm.PhiF.Numerator > pm.PhiF.Denominator {
		return errorsmod.Wrapf(ErrInvalidChanceWinLottery, "chance of a signer to win a lottery should be greater than 0 and less than or equal to 1 (phiF/100)")
	}

	return nil
}

// ZeroCustomFields returns a ClientState that is a copy of the current ClientState
// with all client customizable fields zeroed out. All chain specific fields must
// remain unchanged. This client state will be used to verify chain upgrades when a
// chain breaks a light client verification parameter such as chainID.
func (cs ClientState) ZeroCustomFields() exported.ClientState {
	// copy over all chain-specified fields
	// and leave custom fields empty
	return &ClientState{
		ChainId:      cs.ChainId,
		LatestHeight: cs.LatestHeight,
		UpgradePath:  cs.UpgradePath,
	}
}

// Initialize validates the initial consensus state and sets the initial client state,
// consensus state, and client-specific metadata in the provided client store.
func (cs ClientState) Initialize(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, consState exported.ConsensusState) error {
	consensusState, ok := consState.(*ConsensusState)
	if !ok {
		return errorsmod.Wrapf(clienttypes.ErrInvalidConsensus, "invalid initial consensus state. expected type: %T, got: %T",
			&ConsensusState{}, consState)
	}

	setClientState(clientStore, cdc, &cs)
	setConsensusState(clientStore, cdc, consensusState, cs.LatestHeight)
	setConsensusMetadata(ctx, clientStore, cs.LatestHeight)
	setFcInEpoch(clientStore, *consensusState.FirstCertHashLatestEpoch, cs.CurrentEpoch)
	setLcTsInEpoch(clientStore, MithrilCertificate{Hash: consensusState.LatestCertHashTxSnapshot}, cs.CurrentEpoch)
	setMSDCertificateWithHash(clientStore, *consensusState.FirstCertHashLatestEpoch)

	return nil
}

// GetLatestHeight returns the latest block height that the client state represents.
func (cs ClientState) GetLatestHeight() exported.Height {
	return cs.LatestHeight
}

// VerifyMembership is a generic proof verification method which verifies a proof of the existence of a value at a given CommitmentPath at the specified height.
// The caller is expected to construct the full CommitmentPath from a CommitmentPrefix and a standardized path (as defined in ICS 24).
// If a zero proof height is passed in, it will fail to retrieve the associated consensus state.
//
// NOTE: VerifyMembership must verify the existence of a value at a given commitment path at the specified height.
// TODO: This method currently returns nil without verification. For Mithril-based verification, this would require:
//   1. Extracting the transaction containing the UTXO with the relevant IBC datum from Mithril-certified transactions
//   2. Parsing the UTXO datum to retrieve the IBC state (client state, connection, channel, packet, etc.)
//   3. Verifying the extracted state matches the expected value at the given path
//   4. Ensuring the transaction is included in the Mithril certificate for the specified height
func (cs ClientState) VerifyMembership(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
	delayTimePeriod uint64,
	delayBlockPeriod uint64,
	proof []byte,
	path exported.Path,
	value []byte,
) error {
	return nil
	// return errorsmod.Wrap(ErrNotImplemented, "this method is not implemented")
}

// VerifyNonMembership is a generic proof verification method which verifies the absence of a given CommitmentPath at a specified height.
// The caller is expected to construct the full CommitmentPath from a CommitmentPrefix and a standardized path (as defined in ICS 24).
// If a zero proof height is passed in, it will fail to retrieve the associated consensus state.
//
// NOTE: VerifyNonMembership must verify the absence of a value at a given commitment path at a specified height.
// TODO: This method currently returns nil without verification. For Mithril-based verification, this would require:
//   1. Querying all Mithril-certified transactions for the specified height
//   2. Extracting and parsing all UTXO datums that could contain IBC state for the given path
//   3. Verifying that no UTXO exists with a datum matching the commitment path
//   4. Ensuring the absence proof is based on the complete set of Mithril-certified transactions
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
	return nil
	// return errorsmod.Wrap(ErrNotImplemented, "this method is not implemented")
}
