package state

import (
	"math"
	"time"

	errorsmod "cosmossdk.io/errors"
)

// HostBlockGapTolerance bounds time credited to an uncertified stake table's
// response window. Public hosts must approve this inclusion assumption.
const HostBlockGapTolerance = 10 * time.Second

// HostProgress records committed host time and a clock that excludes interrupted
// intervals. A halt never starts a challenge. Only an uncertified stake proposal
// records a target on this clock.
type HostProgress struct {
	Height                  int64
	TimeUnixNs              uint64
	PreviousTimeUnixNs      uint64
	ClockID                 uint64
	ObservationTime         uint64
	PreviousObservationTime uint64
}

func AdvanceHostProgress(ctx Context, previous *HostProgress) (*HostProgress, error) {
	now := ctx.BlockTime().UnixNano()
	if ctx.Height <= 0 || now <= 0 {
		return nil, errorsmod.Wrap(ErrInvalidTimestamp, "invalid host block height or time")
	}
	progress := &HostProgress{Height: ctx.Height, TimeUnixNs: uint64(now), ClockID: uint64(now)}
	if previous == nil || previous.ClockID == 0 {
		return progress, nil
	}
	progress.PreviousTimeUnixNs = previous.TimeUnixNs
	progress.ClockID = previous.ClockID
	progress.ObservationTime = previous.ObservationTime
	progress.PreviousObservationTime = previous.ObservationTime
	if previous.Height == ctx.Height-1 && previous.TimeUnixNs > 0 && uint64(now) > previous.TimeUnixNs {
		elapsed := uint64(now) - previous.TimeUnixNs
		if elapsed <= uint64(HostBlockGapTolerance) {
			if previous.ObservationTime > math.MaxUint64-elapsed {
				return nil, errorsmod.Wrap(ErrInvalidTimestamp, "host observation clock overflow")
			}
			progress.ObservationTime += elapsed
		}
	}
	return progress, nil
}

func hostProgress(ctx Context) (*HostProgress, error) {
	if ctx.HostProgress == nil {
		return nil, errorsmod.Wrap(ErrEpochContextPending, "host continuity tracking is missing")
	}
	progress := ctx.HostProgress(ctx)
	now := ctx.BlockTime().UnixNano()
	if progress == nil || now <= 0 || progress.Height != ctx.Height || progress.TimeUnixNs != uint64(now) ||
		progress.ClockID == 0 || progress.PreviousObservationTime > progress.ObservationTime {
		return nil, errorsmod.Wrap(ErrEpochContextPending, "host continuity record is missing or stale")
	}
	return progress, nil
}

func VerifyHostWindow(ctx Context, deadline uint64, progress *HostProgress) error {
	ctx.HostProgress = func(Context) *HostProgress { return progress }
	if _, err := hostProgress(ctx); err != nil {
		return err
	}
	// A completed block after the operation's own cutoff leaves challenges an
	// inclusion opportunity. Host interruption does not create another cutoff.
	if progress.PreviousTimeUnixNs == 0 || progress.PreviousTimeUnixNs >= progress.TimeUnixNs ||
		progress.TimeUnixNs <= deadline || progress.PreviousTimeUnixNs <= deadline {
		return errorsmod.Wrapf(ErrEpochContextPending, "host proofs are pending until a committed block after Unix nanoseconds %d", deadline)
	}
	return nil
}
