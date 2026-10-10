package state

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	cmttypes "github.com/cometbft/cometbft/types"
)

const maxSupportedKesEvolutions = uint64(1 << 6)

func NewClientState(
	chainID string,
	latestHeight *Height,
	currentEpoch uint64,
	trustingPeriod time.Duration,
	maxClockDrift time.Duration,
	upgradePath []string,
) *ClientState {
	zeroHeight := ZeroHeight()
	return &ClientState{
		ChainId:        chainID,
		LatestHeight:   latestHeight,
		FrozenHeight:   zeroHeight,
		CurrentEpoch:   currentEpoch,
		TrustingPeriod: trustingPeriod,
		MaxClockDrift:  maxClockDrift,
		UpgradePath:    upgradePath,
	}
}

func (cs ClientState) GetChainID() string { return cs.ChainId }
func (ClientState) ClientType() string    { return ModuleName }

func (ClientState) GetTimestampAtHeight(
	ctx Context,
	clientStore storetypes.KVStore,
	cdc StateCodec,
	height HeightValue,
) (uint64, error) {
	consState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return 0, errorsmod.Wrapf(ErrIBCConsensusStateNotFound, "height (%s)", height)
	}
	return consState.GetTimestamp(), nil
}

func (cs ClientState) Status(ctx Context, clientStore storetypes.KVStore, cdc StateCodec) Status {
	if cs.FrozenHeight != nil && !cs.FrozenHeight.IsZero() {
		return Frozen
	}
	if cs.MaxClockDrift <= 0 {
		return Expired
	}
	if err := validateSettlementCredit(cs.LatestCheckpointSettlementCredit, cs.CurrentEpoch); err != nil {
		return Expired
	}
	if err := cs.validateNonceConfiguration(); err != nil {
		return Expired
	}
	if err := validatePoolRegistry(cs.LatestCheckpointPoolRegistry, cs.CurrentEpoch, math.MaxUint64); err != nil {
		return Expired
	}
	if err := cs.validateCheckpointFields(); err != nil {
		return Expired
	}
	effectiveCheckpointHeight := cs.effectiveCheckpointHeight()
	if cs.MaxKesEvolutions == 0 ||
		cs.MaxKesEvolutions > maxSupportedKesEvolutions ||
		cs.OperationalCertificateCounterHistoryStartHeight == nil ||
		cs.OperationalCertificateCounterHistoryStartHeight.IsZero() ||
		effectiveCheckpointHeight == nil ||
		effectiveCheckpointHeight.IsZero() ||
		cs.OperationalCertificateCounterHistoryStartHeight.GT(effectiveCheckpointHeight) {
		return Expired
	}
	if cs.LatestHeight == nil {
		return Expired
	}
	consState, found := GetConsensusState(clientStore, cdc, cs.LatestHeight)
	if !found {
		return Expired
	}
	if cs.IsExpired(consState.Timestamp, ctx.BlockTime()) {
		return Expired
	}
	return Active
}

func (cs ClientState) IsExpired(latestTimestamp uint64, now time.Time) bool {
	expirationTime := time.Unix(0, int64(latestTimestamp)).Add(cs.TrustingPeriod)
	return !expirationTime.After(now)
}

func (cs ClientState) Validate() error {
	if err := validateSettlementCredit(cs.LatestCheckpointSettlementCredit, cs.CurrentEpoch); err != nil {
		return err
	}
	if err := cs.validateNonceConfiguration(); err != nil {
		return err
	}
	if err := validatePoolRegistry(cs.LatestCheckpointPoolRegistry, cs.CurrentEpoch, math.MaxUint64); err != nil {
		return err
	}
	if len(cs.PacketLanePolicyId) != 28 {
		return fmt.Errorf("packet lane policy must be configured for this deployment")
	}
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
	if cs.MaxClockDrift <= 0 {
		return errorsmod.Wrap(ErrInvalidMaxClockDrift, "max clock drift must be greater than zero")
	}
	if len(cs.HostStateNftPolicyId) != 28 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "host_state_nft_policy_id must be 28 bytes")
	}
	if len(cs.HostStateNftTokenName) == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "host_state_nft_token_name must not be empty")
	}
	if cs.SystemStartUnixNs == 0 {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "system_start_unix_ns must be greater than zero")
	}
	if cs.SlotLengthNs == 0 {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "slot_length_ns must be greater than zero")
	}
	if cs.SlotsPerKesPeriod == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "slots_per_kes_period must be greater than zero")
	}
	if cs.MaxKesEvolutions == 0 || cs.MaxKesEvolutions > maxSupportedKesEvolutions {
		return errorsmod.Wrapf(
			ErrIBCInvalidClient,
			"max_kes_evolutions must be between 1 and %d",
			maxSupportedKesEvolutions,
		)
	}
	if cs.ActiveSlotCoefficientNumerator == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "active_slot_coefficient_numerator must be greater than zero")
	}
	if cs.ActiveSlotCoefficientDenominator == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "active_slot_coefficient_denominator must be greater than zero")
	}
	if cs.ActiveSlotCoefficientNumerator > cs.ActiveSlotCoefficientDenominator {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "active slot coefficient must not exceed one")
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
	if err := verifyStakeTablePoolBindings(epochContextByEpoch(contexts, cs.CurrentEpoch), cs.LatestCheckpointPoolRegistry); err != nil {
		return err
	}
	return nil
}

func (cs ClientState) ZeroCustomFields() *ClientState {
	return &ClientState{
		ChainId:                            cs.ChainId,
		LatestHeight:                       cs.LatestHeight,
		UpgradePath:                        append([]string(nil), cs.UpgradePath...),
		HostStateNftPolicyId:               append([]byte(nil), cs.HostStateNftPolicyId...),
		HostStateNftTokenName:              append([]byte(nil), cs.HostStateNftTokenName...),
		SystemStartUnixNs:                  cs.SystemStartUnixNs,
		SlotLengthNs:                       cs.SlotLengthNs,
		SlotsPerKesPeriod:                  cs.SlotsPerKesPeriod,
		RandomnessStabilisationWindowSlots: cs.RandomnessStabilisationWindowSlots,
		MaxKesEvolutions:                   cs.MaxKesEvolutions,
		ActiveSlotCoefficientNumerator:     cs.ActiveSlotCoefficientNumerator,
		ActiveSlotCoefficientDenominator:   cs.ActiveSlotCoefficientDenominator,
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

func (cs ClientState) DeriveSlotFromTimestamp(timestamp uint64) (uint64, error) {
	if cs.SystemStartUnixNs == 0 {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "system_start_unix_ns must be greater than zero")
	}
	if cs.SlotLengthNs == 0 {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "slot_length_ns must be greater than zero")
	}
	if timestamp < cs.SystemStartUnixNs {
		return 0, errorsmod.Wrapf(
			ErrInvalidTimestamp,
			"timestamp %d is before system start %d",
			timestamp,
			cs.SystemStartUnixNs,
		)
	}
	delta := timestamp - cs.SystemStartUnixNs
	if delta%cs.SlotLengthNs != 0 {
		return 0, errorsmod.Wrapf(
			ErrInvalidTimestamp,
			"timestamp %d does not fall on a Cardano slot boundary",
			timestamp,
		)
	}
	return delta / cs.SlotLengthNs, nil
}

func (cs ClientState) Initialize(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, consState any) error {
	consensusState, ok := consState.(*ConsensusState)
	if !ok {
		return errorsmod.Wrapf(ErrIBCInvalidConsensus, "invalid initial consensus state. expected type: %T, got: %T", &ConsensusState{}, consState)
	}
	if err := cs.validateNonceConfiguration(); err != nil {
		return err
	}
	if consensusState.NonceState != nil && !praosNonceStatesEqual(consensusState.NonceState, cs.LatestCheckpointNonceState) {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "initial consensus nonce state disagrees with client checkpoint")
	}
	consensusState.NonceState = clonePraosNonceState(cs.LatestCheckpointNonceState)
	if consensusState.PoolRegistry != nil && !poolRegistriesEqual(consensusState.PoolRegistry, cs.LatestCheckpointPoolRegistry) {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "initial consensus pool registry disagrees with client checkpoint")
	}
	consensusState.PoolRegistry = clonePoolRegistry(cs.LatestCheckpointPoolRegistry)
	if err := validateSettlementCredit(cs.LatestCheckpointSettlementCredit, cs.CurrentEpoch); err != nil {
		return err
	}
	if consensusState.SettlementCredit != nil && !settlementCreditsEqual(consensusState.SettlementCredit, cs.LatestCheckpointSettlementCredit) {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "initial settlement credit disagrees with client checkpoint")
	}
	consensusState.SettlementCredit = cloneSettlementCredit(cs.LatestCheckpointSettlementCredit)
	if _, err := cs.normalizedEpochContexts(); err != nil {
		return err
	}
	if err := validateConsensusPacketSnapshot(consensusState, cs.LatestHeight.RevisionHeight); err != nil {
		return err
	}
	if err := cs.resetEpochChallenges(ctx); err != nil {
		return err
	}
	if err := cs.initializeCheckpoint(consensusState); err != nil {
		return err
	}
	SetClientState(clientStore, cdc, &cs)
	SetConsensusState(clientStore, cdc, consensusState, cs.LatestHeight)
	setConsensusMetadata(ctx, clientStore, cs.LatestHeight)
	clientStore.Set(ProbabilisticScoreKey(cs.LatestHeight.RevisionHeight), uint64ToBigEndian(consensusState.SecurityScoreBps))
	clientStore.Set(UniquePoolsKey(cs.LatestHeight.RevisionHeight), uint64ToBigEndian(consensusState.UniquePoolsCount))
	clientStore.Set(UniqueStakeKey(cs.LatestHeight.RevisionHeight), uint64ToBigEndian(consensusState.UniqueStakeBps))
	clientStore.Set(AcceptedBlockHashKey(cs.LatestHeight.RevisionHeight), []byte(consensusState.AcceptedBlockHash))
	return nil
}

func (ClientState) ExportMetadata(store storetypes.KVStore) []Metadata {
	iterator := store.Iterator(nil, nil)
	defer iterator.Close()

	consensusStatePrefix := append([]byte("consensusStates"), '/')
	metadata := make([]Metadata, 0)
	for ; iterator.Valid(); iterator.Next() {
		key := iterator.Key()
		if bytes.Equal(key, []byte("clientState")) ||
			(bytes.HasPrefix(key, consensusStatePrefix) &&
				!bytes.Contains(key[len(consensusStatePrefix):], []byte{'/'})) {
			continue
		}
		metadata = append(metadata, newMetadata(
			bytes.Clone(key),
			bytes.Clone(iterator.Value()),
		))
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

func (cs ClientState) GetLatestHeight() HeightValue {
	if cs.LatestHeight == nil {
		return NewHostHeight(0, 0)
	}
	return NewHostHeight(cs.LatestHeight.GetRevisionNumber(), cs.LatestHeight.GetRevisionHeight())
}

func VerifyDelayPeriodPassed(ctx Context, clientStore storetypes.KVStore, height HeightValue, delayTimePeriod, delayBlockPeriod uint64) error {
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
