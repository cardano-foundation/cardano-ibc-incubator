package state

import (
	"encoding/binary"
	"fmt"
	"math"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
)

func stakeWindowKey(cs *ClientState, epoch uint64) []byte {
	return binary.BigEndian.AppendUint64(binary.BigEndian.AppendUint64(append([]byte("snapshots/v2/stakeWindows/"), cs.StorageNamespace...), cs.VerificationGeneration), epoch)
}

func startStakeWindow(ctx Context, shared storetypes.KVStore, cs *ClientState, epoch uint64) error {
	progress, err := hostProgress(ctx)
	if err != nil {
		return err
	}
	if progress.ObservationTime > math.MaxUint64-uint64(SharedSnapshotChallengePeriod) {
		return fmt.Errorf("stake response window overflows the observation clock")
	}
	raw := binary.BigEndian.AppendUint64(nil, progress.ClockID)
	raw = binary.BigEndian.AppendUint64(raw, progress.ObservationTime+uint64(SharedSnapshotChallengePeriod))
	shared.Set(stakeWindowKey(cs, epoch), raw)
	return nil
}

func stakeWindow(shared storetypes.KVStore, cs *ClientState, epoch uint64) (clock, target uint64, err error) {
	raw := shared.Get(stakeWindowKey(cs, epoch))
	if len(raw) == 0 {
		return 0, 0, nil
	}
	if len(raw) != 16 || binary.BigEndian.Uint64(raw) == 0 {
		return 0, 0, fmt.Errorf("invalid stake response window")
	}
	return binary.BigEndian.Uint64(raw), binary.BigEndian.Uint64(raw[8:]), nil
}

func verifyStakeWindow(shared storetypes.KVStore, cs *ClientState, epoch uint64, progress *HostProgress) error {
	clock, target, err := stakeWindow(shared, cs, epoch)
	if err != nil || clock == 0 {
		return err
	}
	if progress.ClockID != clock {
		return errorsmod.Wrap(ErrEpochContextPending, "pending stake response window lost its host observation clock")
	}
	if progress.PreviousObservationTime <= target {
		return errorsmod.Wrapf(ErrEpochContextPending, "epoch %d is pending until its full stake response window has committed", epoch)
	}
	return nil
}
