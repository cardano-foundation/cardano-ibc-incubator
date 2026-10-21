package state

import (
	"bytes"
	"math"
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
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
		StorageVersion: StorageVersion,
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
	if err := cs.Validate(); err != nil {
		return Expired
	}
	if cs.FrozenHeight != nil && !cs.FrozenHeight.IsZero() {
		return Frozen
	}
	consensus, found := GetConsensusState(clientStore, cdc, cs.LatestHeight)
	if !found || consensus.VerificationGeneration != cs.VerificationGeneration || cs.IsExpired(cs.LatestCheckpointTimestamp, ctx.BlockTime()) {
		return Expired
	}
	return Active
}

func (cs ClientState) IsExpired(latestTimestamp uint64, now time.Time) bool {
	expirationTime := time.Unix(0, int64(latestTimestamp)).Add(cs.TrustingPeriod)
	return !expirationTime.After(now)
}

func (cs ClientState) Validate() error {
	if err := validateClientState(&cs); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidClient, err.Error())
	}
	return nil
}

func (cs ClientState) ZeroCustomFields() *ClientState {
	return &ClientState{
		StorageVersion:                     StorageVersion,
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
	if err := cs.Validate(); err != nil {
		return err
	}
	consensus, ok := consState.(*ConsensusState)
	if !ok {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "initial consensus state has the wrong type")
	}
	if err := consensus.ValidateBasic(); err != nil {
		return err
	}
	return cs.initializeClientState(ctx, cdc, clientStore, consensus)
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
	// A future deadline outside uint64 must not wrap into an elapsed deadline.
	if delayTimePeriod > math.MaxUint64-processedTime || currentTime < processedTime+delayTimePeriod {
		return ErrDelayPeriodNotPassed
	}
	processedHeight, found := GetProcessedHeight(clientStore, height)
	if !found {
		return ErrProcessedHeightNotFound
	}
	currentHeight := uint64(ctx.BlockHeight())
	processedBlockHeight := processedHeight.GetRevisionHeight()
	if delayBlockPeriod > math.MaxUint64-processedBlockHeight || currentHeight < processedBlockHeight+delayBlockPeriod {
		return ErrDelayPeriodNotPassed
	}
	return nil
}
