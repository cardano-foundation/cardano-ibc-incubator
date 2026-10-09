package state

import (
	"bytes"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"reflect"
	"strings"
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
)

type recoveryInvariantClientState struct {
	RandomnessStabilisationWindowSlots uint64
	PacketLanePolicyId                 []byte
	UpgradePath                        []string
	HostStateNftPolicyId               []byte
	HostStateNftTokenName              []byte
	SystemStartUnixNs                  uint64
	SlotLengthNs                       uint64
	SlotsPerKesPeriod                  uint64
	MaxKesEvolutions                   uint64
	ActiveSlotCoefficientNumerator     uint64
	ActiveSlotCoefficientDenominator   uint64
	MaxClockDrift                      time.Duration
}

func (cs ClientState) CheckSubstituteAndUpdateState(
	ctx Context, cdc StateCodec, subjectClientStore,
	substituteClientStore storetypes.KVStore, substituteClient any,
) error {
	substituteClientState, ok := substituteClient.(*ClientState)
	if !ok {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "expected type %T, got %T", &ClientState{}, substituteClient)
	}
	if err := substituteClientState.Validate(); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
	}
	if !IsMatchingClientState(cs, *substituteClientState) {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, "subject client state does not match substitute client state")
	}
	if err := validateOperationalCertificateCounterRecovery(cs, *substituteClientState); err != nil {
		return err
	}
	if substituteClientState.LatestHeight == nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, "substitute client latest height cannot be nil")
	}
	subjectCheckpointHeight := cs.effectiveCheckpointHeight()
	substituteCheckpointHeight := substituteClientState.effectiveCheckpointHeight()
	if subjectCheckpointHeight == nil || substituteCheckpointHeight == nil ||
		!substituteCheckpointHeight.GT(subjectCheckpointHeight) {
		return errorsmod.Wrapf(
			ErrIBCInvalidSubstitute,
			"substitute Cardano checkpoint %v must be newer than subject checkpoint %v",
			substituteCheckpointHeight,
			subjectCheckpointHeight,
		)
	}
	subjectCheckpointSlot, subjectCheckpointTimestamp, err := cs.recoveryCheckpointTemporalCursor(subjectClientStore, cdc)
	if err != nil {
		return errorsmod.Wrap(ErrIBCInvalidClient, err.Error())
	}
	substituteCheckpointSlot, substituteCheckpointTimestamp, err := substituteClientState.recoveryCheckpointTemporalCursor(
		substituteClientStore,
		cdc,
	)
	if err != nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
	}
	if substituteCheckpointSlot <= subjectCheckpointSlot ||
		substituteCheckpointTimestamp <= subjectCheckpointTimestamp {
		return errorsmod.Wrapf(
			ErrIBCInvalidSubstitute,
			"substitute Cardano checkpoint slot/time (%d, %d) must be later than subject checkpoint slot/time (%d, %d)",
			substituteCheckpointSlot,
			substituteCheckpointTimestamp,
			subjectCheckpointSlot,
			subjectCheckpointTimestamp,
		)
	}
	height := substituteClientState.LatestHeight
	consensusState, found := GetConsensusState(substituteClientStore, cdc, height)
	if !found {
		return errorsmod.Wrap(ErrIBCConsensusStateNotFound, "unable to retrieve latest consensus state for substitute client")
	}
	if err := consensusState.ValidateBasic(); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
	}
	if substituteCheckpointHeight.EQ(height) &&
		!praosNonceStatesEqual(substituteClientState.LatestCheckpointNonceState, consensusState.NonceState) {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, "substitute checkpoint nonce state does not match its latest consensus state")
	}
	if substituteCheckpointHeight.EQ(height) && !poolRegistriesEqual(substituteClientState.LatestCheckpointPoolRegistry, consensusState.PoolRegistry) {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, "substitute checkpoint pool registry does not match its latest consensus state")
	}
	if substituteClientState.LatestCheckpointHeight != nil &&
		substituteClientState.LatestCheckpointHeight.EQ(height) &&
		(!strings.EqualFold(substituteClientState.LatestCheckpointBlockHash, consensusState.AcceptedBlockHash) ||
			substituteClientState.LatestCheckpointEpoch != consensusState.AcceptedEpoch ||
			substituteCheckpointTimestamp != consensusState.Timestamp) {
		return errorsmod.Wrap(
			ErrIBCInvalidSubstitute,
			"substitute checkpoint cursor does not match its latest consensus state",
		)
	}
	if err := validateConsensusPacketSnapshot(consensusState, height.RevisionHeight); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
	}
	checkpointSnapshot := substituteClientStore.Get(packetSnapshotKey(substituteCheckpointHeight.RevisionHeight))
	if substituteCheckpointHeight.EQ(height) {
		checkpointSnapshot = consensusState.PacketStateSnapshot
	}
	tracked, err := probabilisticcore.DecodePacketStateSnapshot(checkpointSnapshot)
	if err != nil || tracked.Height != substituteCheckpointHeight.RevisionHeight ||
		!strings.EqualFold(tracked.BlockHash, substituteClientState.LatestCheckpointBlockHash) && !substituteCheckpointHeight.EQ(height) {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, "substitute packet checkpoint is unavailable or inconsistent")
	}
	processedHeight, found := GetProcessedHeight(substituteClientStore, height)
	if !found {
		return errorsmod.Wrap(ErrIBCUpdateClientFailed, "unable to retrieve processed height for substitute client latest height")
	}
	processedTime, found := GetProcessedTime(substituteClientStore, height)
	if !found {
		return errorsmod.Wrap(ErrIBCUpdateClientFailed, "unable to retrieve processed time for substitute client latest height")
	}
	if cs.Status(ctx, subjectClientStore, cdc) == Frozen || cs.FrozenHeight == nil {
		zeroHeight := ZeroHeight()
		cs.FrozenHeight = zeroHeight
	}
	contexts, err := substituteClientState.normalizedEpochContexts()
	if err != nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
	}
	subjectClientStore.Set(packetSnapshotKey(substituteCheckpointHeight.RevisionHeight), bytes.Clone(checkpointSnapshot))
	SetConsensusState(subjectClientStore, cdc, consensusState, height)
	SetConsensusMetadataWithValues(subjectClientStore, height, processedHeight, processedTime)
	cs.LatestHeight = substituteClientState.LatestHeight
	if err := clearOperationalCertificateCounterHistory(subjectClientStore); err != nil {
		return err
	}
	if substituteClientState.LatestCheckpointHeight != nil && !substituteClientState.LatestCheckpointHeight.IsZero() {
		cs.setLatestCheckpoint(
			substituteClientState.LatestCheckpointHeight,
			substituteClientState.LatestCheckpointBlockHash,
			substituteClientState.LatestCheckpointEpoch,
			substituteCheckpointSlot,
			substituteCheckpointTimestamp,
		)
	} else {
		slot, err := cs.DeriveSlotFromTimestamp(consensusState.Timestamp)
		if err != nil {
			return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
		}
		cs.setLatestCheckpoint(
			height,
			consensusState.AcceptedBlockHash,
			consensusState.AcceptedEpoch,
			slot,
			consensusState.Timestamp,
		)
	}
	cs.LatestCheckpointNonceState = clonePraosNonceState(substituteClientState.LatestCheckpointNonceState)
	cs.LatestCheckpointPoolRegistry = clonePoolRegistry(substituteClientState.LatestCheckpointPoolRegistry)
	cs.LatestCheckpointOperationalCertificateCounters = cloneOperationalCertificateCounters(
		substituteClientState.LatestCheckpointOperationalCertificateCounters,
	)
	cs.OperationalCertificateCounterHistoryStartHeight = NewHeight(
		cs.LatestCheckpointHeight.RevisionNumber,
		cs.LatestCheckpointHeight.RevisionHeight,
	)
	cs.ChainId = substituteClientState.ChainId
	cs.TrustingPeriod = substituteClientState.TrustingPeriod
	cs.MaxKesEvolutions = substituteClientState.MaxKesEvolutions
	cs.ActiveSlotCoefficientNumerator = substituteClientState.ActiveSlotCoefficientNumerator
	cs.ActiveSlotCoefficientDenominator = substituteClientState.ActiveSlotCoefficientDenominator
	cs.MaxClockDrift = substituteClientState.MaxClockDrift
	if err := syncCurrentEpochFields(&cs, contexts, substituteClientState.CurrentEpoch); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
	}
	// Recovery installs a new trusted bootstrap. Never copy a substitute's
	// elapsed deadlines to release roots immediately on the subject client.
	for _, challenge := range cs.EpochContextChallenges {
		if challenge != nil {
			subjectClientStore.Delete(epochChallengeCheckpointKey(challenge.Epoch))
			subjectClientStore.Delete(epochChallengePacketSnapshotKey(challenge.Epoch))
		}
	}
	if err := cs.resetEpochChallenges(ctx); err != nil {
		return err
	}
	SetClientState(subjectClientStore, cdc, &cs)
	return nil
}

func validateOperationalCertificateCounterRecovery(subject, substitute ClientState) error {
	subjectCounters, err := operationalCertificateCounterMap(
		subject.LatestCheckpointOperationalCertificateCounters,
	)
	if err != nil {
		return errorsmod.Wrap(ErrIBCInvalidClient, err.Error())
	}
	substituteCounters, err := operationalCertificateCounterMap(
		substitute.LatestCheckpointOperationalCertificateCounters,
	)
	if err != nil {
		return errorsmod.Wrap(ErrIBCInvalidSubstitute, err.Error())
	}
	for poolID, subjectSequenceNumber := range subjectCounters {
		substituteSequenceNumber := substituteCounters[poolID]
		if substituteSequenceNumber < subjectSequenceNumber {
			return errorsmod.Wrapf(
				ErrIBCInvalidSubstitute,
				"operational certificate counter for pool %s regressed from %d to %d",
				poolID,
				subjectSequenceNumber,
				substituteSequenceNumber,
			)
		}
	}
	return nil
}

func (cs ClientState) effectiveCheckpointHeight() *Height {
	if cs.LatestCheckpointHeight != nil && !cs.LatestCheckpointHeight.IsZero() {
		return cs.LatestCheckpointHeight
	}
	return cs.LatestHeight
}

func (cs ClientState) recoveryCheckpointTemporalCursor(
	clientStore storetypes.KVStore,
	cdc StateCodec,
) (uint64, uint64, error) {
	if cs.LatestCheckpointTimestamp != 0 {
		return cs.LatestCheckpointSlot, cs.LatestCheckpointTimestamp, nil
	}
	checkpointHeight := cs.effectiveCheckpointHeight()
	if checkpointHeight == nil || cs.LatestHeight == nil || !checkpointHeight.EQ(cs.LatestHeight) {
		return 0, 0, errorsmod.Wrap(
			ErrInvalidTimestamp,
			"checkpoint timestamp is missing; pre-upgrade rootless checkpoints require an app-state migration",
		)
	}
	consensusState, found := GetConsensusState(clientStore, cdc, checkpointHeight)
	if !found {
		return 0, 0, errorsmod.Wrapf(
			ErrIBCConsensusStateNotFound,
			"height (%s)",
			checkpointHeight.String(),
		)
	}
	slot, err := cs.DeriveSlotFromTimestamp(consensusState.Timestamp)
	if err != nil {
		return 0, 0, err
	}
	return slot, consensusState.Timestamp, nil
}

func IsMatchingClientState(subject, substitute ClientState) bool {
	start, end, err := subject.epochSlotBounds(substitute.CurrentEpoch)
	if err != nil || start != substitute.CurrentEpochStartSlot || end != substitute.CurrentEpochEndSlotExclusive {
		return false
	}
	return reflect.DeepEqual(
		recoveryInvariantProjection(subject),
		recoveryInvariantProjection(substitute),
	)
}

func recoveryInvariantProjection(cs ClientState) recoveryInvariantClientState {
	return recoveryInvariantClientState{
		PacketLanePolicyId:                 bytes.Clone(cs.PacketLanePolicyId),
		RandomnessStabilisationWindowSlots: cs.RandomnessStabilisationWindowSlots,
		UpgradePath:                        append([]string(nil), cs.UpgradePath...),
		HostStateNftPolicyId:               bytes.Clone(cs.HostStateNftPolicyId),
		HostStateNftTokenName:              bytes.Clone(cs.HostStateNftTokenName),
		SystemStartUnixNs:                  cs.SystemStartUnixNs,
		SlotLengthNs:                       cs.SlotLengthNs,
		SlotsPerKesPeriod:                  cs.SlotsPerKesPeriod,
		MaxKesEvolutions:                   cs.MaxKesEvolutions,
		ActiveSlotCoefficientNumerator:     cs.ActiveSlotCoefficientNumerator,
		ActiveSlotCoefficientDenominator:   cs.ActiveSlotCoefficientDenominator,
		MaxClockDrift:                      cs.MaxClockDrift,
	}
}
