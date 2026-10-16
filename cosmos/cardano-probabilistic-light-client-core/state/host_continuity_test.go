package state

import (
	"math"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func TestHostInterruptionDoesNotQuarantineUsableState(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	ctx := Context{Height: 100_000, Time: start}
	old := &HostProgress{Height: ctx.Height - 1, TimeUnixNs: uint64(start.Add(-time.Second).UnixNano()), ClockID: 1, ObservationTime: 123}
	for _, test := range []struct {
		name     string
		previous *HostProgress
	}{
		{"missing", nil},
		{"halt", &HostProgress{Height: ctx.Height - 1, TimeUnixNs: uint64(start.Add(-time.Hour).UnixNano()), ClockID: 1, ObservationTime: 123}},
		{"missed hook", &HostProgress{Height: ctx.Height - 2, TimeUnixNs: old.TimeUnixNs, ClockID: 1, ObservationTime: 123}},
		{"clock backwards", &HostProgress{Height: ctx.Height - 1, TimeUnixNs: uint64(start.Add(time.Second).UnixNano()), ClockID: 1, ObservationTime: 123}},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, err := AdvanceHostProgress(ctx, test.previous)
			require.NoError(t, err)
			if test.previous != nil {
				require.Equal(t, test.previous.ObservationTime, p.ObservationTime)
			}
			if test.previous != nil && test.previous.TimeUnixNs < p.TimeUnixNs {
				require.NoError(t, VerifyHostWindow(ctx, 1, p), "a halt cannot re-lock an old usable root")
			} else {
				require.ErrorIs(t, VerifyHostWindow(ctx, 1, p), ErrEpochContextPending)
			}
		})
	}
	old.TimeUnixNs = uint64(start.Add(-HostBlockGapTolerance).UnixNano())
	p, err := AdvanceHostProgress(ctx, old)
	require.NoError(t, err)
	require.Equal(t, old.ObservationTime+uint64(HostBlockGapTolerance), p.ObservationTime)
	ctx.Height++
	ctx.Time = start.Add(HostBlockGapTolerance + time.Nanosecond)
	next, err := AdvanceHostProgress(ctx, p)
	require.NoError(t, err)
	require.Equal(t, p.ObservationTime, next.ObservationTime)
	require.NoError(t, VerifyHostWindow(ctx, 1, next))
	_, err = AdvanceHostProgress(Context{Height: 0, Time: start}, nil)
	require.ErrorIs(t, err, ErrInvalidTimestamp)
	old.ObservationTime = math.MaxUint64
	_, err = AdvanceHostProgress(Context{Height: old.Height + 1, Time: start}, old)
	require.ErrorIs(t, err, ErrInvalidTimestamp)
}

func TestHostWindowRequiresCommittedInclusionBlock(t *testing.T) {
	deadline := uint64(time.Unix(1_700_000_000, 0).UnixNano())
	ctx := Context{Height: 1_000_000}
	for _, offset := range []int64{0, 1, 2} {
		ctx.Time = time.Unix(0, int64(deadline)+offset)
		p := testHostProgress(ctx)
		err := VerifyHostWindow(ctx, deadline, p)
		if offset < 2 {
			require.ErrorIs(t, err, ErrEpochContextPending)
		} else {
			require.NoError(t, err)
		}
	}
	p := testHostProgress(ctx)
	for _, mutate := range []func(*HostProgress){
		func(p *HostProgress) { p.Height-- }, func(p *HostProgress) { p.TimeUnixNs-- },
		func(p *HostProgress) { p.PreviousTimeUnixNs = 0 }, func(p *HostProgress) { p.PreviousTimeUnixNs = p.TimeUnixNs },
		func(p *HostProgress) { p.ClockID = 0 }, func(p *HostProgress) { p.PreviousObservationTime = p.ObservationTime + 1 },
	} {
		copy := *p
		mutate(&copy)
		require.ErrorIs(t, VerifyHostWindow(ctx, deadline, &copy), ErrEpochContextPending)
	}
	require.ErrorIs(t, VerifyHostWindow(ctx, deadline, nil), ErrEpochContextPending)
}

func TestPendingStakeWindowPausesAcrossHostInterruption(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	ctx := Context{Height: 1, Time: start}
	progress, err := AdvanceHostProgress(ctx, nil)
	require.NoError(t, err)
	ctx.HostProgress = func(Context) *HostProgress { return progress }
	cs := &ClientState{StorageNamespace: make([]byte, 32), VerificationGeneration: 1}
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	require.NoError(t, startStakeWindow(ctx, shared, cs, 8))
	// Five hours of actual host progress have elapsed before a two-hour halt.
	progress.ObservationTime = uint64(5 * time.Hour)
	progress.TimeUnixNs = uint64(start.Add(5 * time.Hour).UnixNano())
	ctx.Height++
	ctx.Time = start.Add(7 * time.Hour)
	progress, err = AdvanceHostProgress(ctx, progress)
	require.NoError(t, err)
	require.Equal(t, uint64(5*time.Hour), progress.ObservationTime)
	require.Greater(t, uint64(ctx.Time.UnixNano()), uint64(start.Add(SharedSnapshotChallengePeriod).UnixNano()))
	require.NoError(t, VerifyHostWindow(ctx, 1, progress), "old usable state has no new window")
	require.ErrorIs(t, verifyStakeWindow(shared, cs, 8, progress), ErrEpochContextPending)
	// Snapshot export/import preserves the unfinished target. The adapter exports
	// the host clock in the same module and reloads it unchanged after restart.
	exported, err := ExportSnapshotGenesis(shared)
	require.NoError(t, err)
	restored := dbadapter.Store{DB: dbm.NewMemDB()}
	require.NoError(t, ImportSnapshotGenesis(restored, exported))
	shared = restored
	require.ErrorIs(t, verifyStakeWindow(shared, cs, 8, progress), ErrEpochContextPending)
	// A second interruption does not restart the six-hour budget.
	for i := 0; i < 360; i++ {
		ctx.Height++
		ctx.Time = ctx.Time.Add(HostBlockGapTolerance)
		progress, err = AdvanceHostProgress(ctx, progress)
		require.NoError(t, err)
	}
	require.Equal(t, uint64(SharedSnapshotChallengePeriod), progress.ObservationTime)
	require.ErrorIs(t, verifyStakeWindow(shared, cs, 8, progress), ErrEpochContextPending)
	ctx.Height++
	ctx.Time = ctx.Time.Add(time.Hour)
	progress, err = AdvanceHostProgress(ctx, progress)
	require.NoError(t, err)
	require.ErrorIs(t, verifyStakeWindow(shared, cs, 8, progress), ErrEpochContextPending, "a completed post-cutoff block is still required")
	for i := 0; i < 2; i++ {
		ctx.Height++
		ctx.Time = ctx.Time.Add(time.Second)
		progress, err = AdvanceHostProgress(ctx, progress)
		require.NoError(t, err)
	}
	require.NoError(t, verifyStakeWindow(shared, cs, 8, progress))
	// Accepted allocations and unrelated epochs have no pending stake clock.
	shared.Delete(stakeWindowKey(cs, 8))
	require.NoError(t, verifyStakeWindow(shared, cs, 8, progress))
	require.NoError(t, verifyStakeWindow(shared, cs, 9, progress))
	// Losing the clock cannot silently complete an unfinished challenge.
	require.NoError(t, startStakeWindow(ctx, shared, cs, 10))
	progress.ClockID++
	require.ErrorIs(t, verifyStakeWindow(shared, cs, 10, progress), ErrEpochContextPending)
}
