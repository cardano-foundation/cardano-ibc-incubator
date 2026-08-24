package probabilistic

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	cmttypes "github.com/cometbft/cometbft/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	commitmenttypesv2 "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types/v2"
	host "github.com/cosmos/ibc-go/v10/modules/core/24-host"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.ClientState = (*ClientState)(nil)

const maxSupportedKesEvolutions = uint64(1 << 6)

func NewClientState(
	chainID string,
	latestHeight *Height,
	currentEpoch uint64,
	trustingPeriod time.Duration,
	upgradePath []string,
) *ClientState {
	zeroHeight := ZeroHeight()
	return &ClientState{
		ChainId:        chainID,
		LatestHeight:   latestHeight,
		FrozenHeight:   zeroHeight,
		CurrentEpoch:   currentEpoch,
		TrustingPeriod: trustingPeriod,
		UpgradePath:    upgradePath,
	}
}

func (cs ClientState) GetChainID() string { return cs.ChainId }
func (ClientState) ClientType() string    { return ModuleName }

func (ClientState) GetTimestampAtHeight(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
) (uint64, error) {
	consState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return 0, errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height)
	}
	return consState.GetTimestamp(), nil
}

func (cs ClientState) Status(ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec) exported.Status {
	if cs.FrozenHeight != nil && !cs.FrozenHeight.IsZero() {
		return exported.Frozen
	}
	effectiveCheckpointHeight := cs.effectiveCheckpointHeight()
	if cs.MaxKesEvolutions == 0 ||
		cs.MaxKesEvolutions > maxSupportedKesEvolutions ||
		cs.OperationalCertificateCounterHistoryStartHeight == nil ||
		cs.OperationalCertificateCounterHistoryStartHeight.IsZero() ||
		effectiveCheckpointHeight == nil ||
		effectiveCheckpointHeight.IsZero() ||
		cs.OperationalCertificateCounterHistoryStartHeight.GT(effectiveCheckpointHeight) {
		return exported.Expired
	}
	if cs.LatestHeight == nil {
		return exported.Expired
	}
	consState, found := GetConsensusState(clientStore, cdc, cs.LatestHeight)
	if !found {
		return exported.Expired
	}
	if cs.IsExpired(consState.Timestamp, ctx.BlockTime()) {
		return exported.Expired
	}
	return exported.Active
}

func (cs ClientState) IsExpired(latestTimestamp uint64, now time.Time) bool {
	expirationTime := time.Unix(0, int64(latestTimestamp)).Add(cs.TrustingPeriod)
	return !expirationTime.After(now)
}

func (cs ClientState) Validate() error {
	if strings.TrimSpace(cs.ChainId) == "" {
		return errorsmod.Wrap(ErrInvalidChainID, "chain id cannot be empty string")
	}
	if len(cs.ChainId) > cmttypes.MaxChainIDLen {
		return errorsmod.Wrapf(ErrInvalidChainID, "chainID is too long; got: %d, max: %d", len(cs.ChainId), cmttypes.MaxChainIDLen)
	}
	if cs.LatestHeight == nil || cs.LatestHeight.RevisionHeight == 0 {
		return errorsmod.Wrapf(ErrInvalidHeaderHeight, "probabilistic client's latest height revision height cannot be zero")
	}
	if cs.TrustingPeriod <= 0 {
		return errorsmod.Wrap(ErrInvalidTrustingPeriod, "trusting period must be greater than zero")
	}
	if len(cs.HostStateNftPolicyId) != 28 {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "host_state_nft_policy_id must be 28 bytes")
	}
	if len(cs.HostStateNftTokenName) == 0 {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "host_state_nft_token_name must not be empty")
	}
	if cs.SystemStartUnixNs == 0 {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "system_start_unix_ns must be greater than zero")
	}
	if cs.SlotLengthNs == 0 {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "slot_length_ns must be greater than zero")
	}
	if cs.SlotsPerKesPeriod == 0 {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "slots_per_kes_period must be greater than zero")
	}
	if cs.MaxKesEvolutions == 0 || cs.MaxKesEvolutions > maxSupportedKesEvolutions {
		return errorsmod.Wrapf(
			clienttypes.ErrInvalidClient,
			"max_kes_evolutions must be between 1 and %d",
			maxSupportedKesEvolutions,
		)
	}
	if cs.ActiveSlotCoefficientNumerator == 0 {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "active_slot_coefficient_numerator must be greater than zero")
	}
	if cs.ActiveSlotCoefficientDenominator == 0 {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "active_slot_coefficient_denominator must be greater than zero")
	}
	if cs.ActiveSlotCoefficientNumerator > cs.ActiveSlotCoefficientDenominator {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "active slot coefficient must not exceed one")
	}
	if err := cs.validateCheckpointFields(); err != nil {
		return err
	}

	contexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return err
	}
	if len(contexts) == 0 {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "at least one epoch context must be present")
	}
	if epochContextByEpoch(contexts, cs.CurrentEpoch) == nil {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "missing epoch context for current epoch %d", cs.CurrentEpoch)
	}
	return nil
}

func (cs ClientState) ZeroCustomFields() exported.ClientState {
	return &ClientState{
		ChainId:                          cs.ChainId,
		LatestHeight:                     cs.LatestHeight,
		UpgradePath:                      append([]string(nil), cs.UpgradePath...),
		HostStateNftPolicyId:             append([]byte(nil), cs.HostStateNftPolicyId...),
		HostStateNftTokenName:            append([]byte(nil), cs.HostStateNftTokenName...),
		SystemStartUnixNs:                cs.SystemStartUnixNs,
		SlotLengthNs:                     cs.SlotLengthNs,
		SlotsPerKesPeriod:                cs.SlotsPerKesPeriod,
		MaxKesEvolutions:                 cs.MaxKesEvolutions,
		ActiveSlotCoefficientNumerator:   cs.ActiveSlotCoefficientNumerator,
		ActiveSlotCoefficientDenominator: cs.ActiveSlotCoefficientDenominator,
	}
}

func (cs ClientState) DeriveTimestampFromSlot(slot uint64) (uint64, error) {
	if cs.SystemStartUnixNs == 0 {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "system_start_unix_ns must be greater than zero")
	}
	if cs.SlotLengthNs == 0 {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "slot_length_ns must be greater than zero")
	}
	if slot > (math.MaxUint64-cs.SystemStartUnixNs)/cs.SlotLengthNs {
		return 0, errorsmod.Wrapf(ErrInvalidTimestamp, "slot-derived timestamp overflows uint64 for slot %d", slot)
	}
	return cs.SystemStartUnixNs + slot*cs.SlotLengthNs, nil
}

func (cs ClientState) Initialize(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, consState exported.ConsensusState) error {
	consensusState, ok := consState.(*ConsensusState)
	if !ok {
		return errorsmod.Wrapf(clienttypes.ErrInvalidConsensus, "invalid initial consensus state. expected type: %T, got: %T", &ConsensusState{}, consState)
	}
	if err := cs.initializeCheckpoint(consensusState); err != nil {
		return err
	}
	setClientState(clientStore, cdc, &cs)
	setConsensusState(clientStore, cdc, consensusState, cs.LatestHeight)
	setConsensusMetadata(ctx, clientStore, cs.LatestHeight)
	clientStore.Set(ProbabilisticScoreKey(cs.LatestHeight.RevisionHeight), sdk.Uint64ToBigEndian(consensusState.SecurityScoreBps))
	clientStore.Set(UniquePoolsKey(cs.LatestHeight.RevisionHeight), sdk.Uint64ToBigEndian(consensusState.UniquePoolsCount))
	clientStore.Set(UniqueStakeKey(cs.LatestHeight.RevisionHeight), sdk.Uint64ToBigEndian(consensusState.UniqueStakeBps))
	clientStore.Set(AcceptedBlockHashKey(cs.LatestHeight.RevisionHeight), []byte(consensusState.AcceptedBlockHash))
	return nil
}

func (ClientState) ExportMetadata(store storetypes.KVStore) []exported.GenesisMetadata {
	iterator := store.Iterator(nil, nil)
	defer iterator.Close()

	consensusStatePrefix := append([]byte(host.KeyConsensusStatePrefix), '/')
	metadata := make([]exported.GenesisMetadata, 0)
	for ; iterator.Valid(); iterator.Next() {
		key := iterator.Key()
		if bytes.Equal(key, host.ClientStateKey()) ||
			(bytes.HasPrefix(key, consensusStatePrefix) &&
				!bytes.Contains(key[len(consensusStatePrefix):], []byte{'/'})) {
			continue
		}
		metadata = append(metadata, clienttypes.NewGenesisMetadata(
			bytes.Clone(key),
			bytes.Clone(iterator.Value()),
		))
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

func (cs ClientState) GetLatestHeight() exported.Height {
	if cs.LatestHeight == nil {
		return clienttypes.ZeroHeight()
	}
	return clienttypes.NewHeight(cs.LatestHeight.GetRevisionNumber(), cs.LatestHeight.GetRevisionHeight())
}

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
	if err := verifyDelayPeriodPassed(ctx, clientStore, height, delayTimePeriod, delayBlockPeriod); err != nil {
		return err
	}
	consState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height)
	}
	key, err := ibcStateKeyFromPath(path)
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	if err := VerifyIbcStateMembership(consState.IbcStateRoot, key, value, proof); err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	return nil
}

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
	if err := verifyDelayPeriodPassed(ctx, clientStore, height, delayTimePeriod, delayBlockPeriod); err != nil {
		return err
	}
	consState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height)
	}
	key, err := ibcStateKeyFromPath(path)
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	if err := VerifyIbcStateNonMembership(consState.IbcStateRoot, key, proof); err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	return nil
}

func ibcStateKeyFromPath(path exported.Path) ([]byte, error) {
	mpath, ok := path.(commitmenttypesv2.MerklePath)
	if !ok {
		return nil, fmt.Errorf("path is not a MerklePath")
	}
	if len(mpath.KeyPath) == 0 {
		return nil, fmt.Errorf("empty MerklePath")
	}
	key := string(mpath.KeyPath[len(mpath.KeyPath)-1])
	return []byte(normalizeConsensusKeyForCardano(key)), nil
}

func verifyDelayPeriodPassed(ctx sdk.Context, clientStore storetypes.KVStore, height exported.Height, delayTimePeriod, delayBlockPeriod uint64) error {
	processedTime, found := GetProcessedTime(clientStore, height)
	if !found {
		return ErrProcessedTimeNotFound
	}
	currentTime := uint64(ctx.BlockTime().UnixNano())
	if currentTime < processedTime+delayTimePeriod {
		return ErrDelayPeriodNotPassed
	}
	processedHeight, found := GetProcessedHeight(clientStore, height)
	if !found {
		return ErrProcessedHeightNotFound
	}
	currentHeight := uint64(ctx.BlockHeight())
	if currentHeight < processedHeight.GetRevisionHeight()+delayBlockPeriod {
		return ErrDelayPeriodNotPassed
	}
	return nil
}
