package state

import (
	"bytes"
	"reflect"
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

func (cs ClientState) CheckSubstituteAndUpdateState(ctx Context, cdc StateCodec, subjectStore, substituteStore storetypes.KVStore, substitute any) error {
	replacement, ok := substitute.(*ClientState)
	if !ok {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "expected type %T, got %T", &ClientState{}, substitute)
	}
	return (&cs).beginRecovery(ctx, cdc, subjectStore, substituteStore, replacement)
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
