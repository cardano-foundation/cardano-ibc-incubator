package state

import (
	"math"
	"time"

	errorsmod "cosmossdk.io/errors"
)

// HostBlockGapTolerance is a consensus rule for the maintained local profiles.
// Public hosts must separately approve this bound and challenge inclusion capacity.
const HostBlockGapTolerance = 10 * time.Second

// HostProgress is recorded before transactions in each host block. It lives in
// the host's IBC store, independently of any client's update frequency.
type HostProgress struct {
	Height                  int64
	TimeUnixNs              uint64
	PreviousTimeUnixNs      uint64
	ResumeUsableAfterUnixNs uint64
}

func AdvanceHostProgress(ctx Context, previous *HostProgress) (*HostProgress, error) {
	now := ctx.BlockTime().UnixNano()
	if ctx.Height <= 0 || now <= 0 {
		return nil, errorsmod.Wrap(ErrInvalidTimestamp, "invalid host block height or time")
	}
	progress := &HostProgress{Height: ctx.Height, TimeUnixNs: uint64(now)}
	interrupted := previous == nil
	if previous != nil {
		progress.PreviousTimeUnixNs = previous.TimeUnixNs
		progress.ResumeUsableAfterUnixNs = previous.ResumeUsableAfterUnixNs
		interrupted = previous.ResumeUsableAfterUnixNs == 0 || previous.ResumeUsableAfterUnixNs > math.MaxInt64 || previous.TimeUnixNs == 0 || previous.Height != ctx.Height-1 || uint64(now) <= previous.TimeUnixNs ||
			uint64(now)-previous.TimeUnixNs > uint64(HostBlockGapTolerance)
	}
	if interrupted {
		deadline, err := sharedSnapshotChallengeDeadline(ctx)
		if err != nil {
			return nil, err
		}
		progress.ResumeUsableAfterUnixNs = deadline
	}
	return progress, nil
}

func VerifyHostWindow(ctx Context, epochDeadline uint64, progress *HostProgress) error {
	now := ctx.BlockTime().UnixNano()
	if progress == nil || now <= 0 || progress.Height != ctx.Height || progress.TimeUnixNs != uint64(now) ||
		progress.PreviousTimeUnixNs == 0 || progress.PreviousTimeUnixNs >= uint64(now) ||
		progress.ResumeUsableAfterUnixNs == 0 || progress.ResumeUsableAfterUnixNs > math.MaxInt64 {
		return errorsmod.Wrapf(ErrEpochContextPending, "host continuity record is missing or stale at height %d time %d (record %+v)", ctx.Height, now, progress)
	}
	resumeDeadline := progress.ResumeUsableAfterUnixNs
	if ctx.RequiredResponseWindow > SharedSnapshotChallengePeriod {
		extra := uint64(ctx.RequiredResponseWindow - SharedSnapshotChallengePeriod)
		if resumeDeadline > math.MaxInt64-extra {
			return errorsmod.Wrap(ErrEpochContextPending, "host resumption deadline cannot represent the staged response window")
		}
		resumeDeadline += extra
	}
	deadline := max(epochDeadline, resumeDeadline)
	// Reserve a completed block after the cutoff for challenge inclusion. A
	// transaction's presence in a mempool never satisfies this condition.
	if uint64(now) <= deadline || progress.PreviousTimeUnixNs <= deadline {
		return errorsmod.Wrapf(ErrEpochContextPending, "host proofs are pending until a committed block after Unix nanoseconds %d", deadline)
	}
	return nil
}
