package state

import (
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHostInterruptionStartsFreshWindow(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	ctx := Context{Height: 100_000, Time: start}
	old := &HostProgress{Height: ctx.Height - 1, TimeUnixNs: uint64(start.Add(-time.Second).UnixNano()), ResumeUsableAfterUnixNs: 1}
	for _, test := range []struct {
		name     string
		previous *HostProgress
	}{
		{"missing", nil},
		{"halt after many blocks", &HostProgress{Height: ctx.Height - 1, TimeUnixNs: uint64(start.Add(-HostBlockGapTolerance - time.Nanosecond).UnixNano()), ResumeUsableAfterUnixNs: 1}},
		{"missed block hook", &HostProgress{Height: ctx.Height - 2, TimeUnixNs: old.TimeUnixNs, ResumeUsableAfterUnixNs: 1}},
		{"clock went backwards", &HostProgress{Height: ctx.Height - 1, TimeUnixNs: uint64(start.Add(time.Second).UnixNano()), ResumeUsableAfterUnixNs: 1}},
		{"invalid deadline", &HostProgress{Height: ctx.Height - 1, TimeUnixNs: old.TimeUnixNs}},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, err := AdvanceHostProgress(ctx, test.previous)
			require.NoError(t, err)
			require.Equal(t, uint64(start.Add(EpochContextChallengePeriod).UnixNano()), p.ResumeUsableAfterUnixNs)
			require.ErrorIs(t, VerifyHostWindow(ctx, 1, p), ErrEpochContextPending)
		})
	}
	// Equal to the explicit tolerance remains continuous. Ordinary blocks never
	// shorten a previous quarantine and do not depend on a client update arriving.
	old.TimeUnixNs = uint64(start.Add(-HostBlockGapTolerance).UnixNano())
	old.ResumeUsableAfterUnixNs = uint64(start.Add(time.Minute).UnixNano())
	p, err := AdvanceHostProgress(ctx, old)
	require.NoError(t, err)
	require.Equal(t, old.ResumeUsableAfterUnixNs, p.ResumeUsableAfterUnixNs)
	ctx.Height++
	ctx.Time = start.Add(HostBlockGapTolerance + time.Nanosecond)
	next, err := AdvanceHostProgress(ctx, p)
	require.NoError(t, err)
	require.Equal(t, uint64(ctx.Time.Add(EpochContextChallengePeriod).UnixNano()), next.ResumeUsableAfterUnixNs)
}

func TestHostWindowRequiresCommittedInclusionBlock(t *testing.T) {
	deadline := uint64(time.Unix(1_700_000_000, 0).UnixNano())
	ctx := Context{Height: 1_000_000}
	for _, cutoff := range []struct{ epoch, resume uint64 }{{deadline, 1}, {1, deadline}} {
		for _, offset := range []int64{0, 1, 2} {
			ctx.Time = time.Unix(0, int64(deadline)+offset)
			p := &HostProgress{Height: ctx.Height, TimeUnixNs: uint64(ctx.Time.UnixNano()), PreviousTimeUnixNs: uint64(ctx.Time.UnixNano() - 1), ResumeUsableAfterUnixNs: cutoff.resume}
			err := VerifyHostWindow(ctx, cutoff.epoch, p)
			if offset < 2 {
				require.ErrorIs(t, err, ErrEpochContextPending)
			} else {
				require.NoError(t, err)
			}
		}
	}
	p := &HostProgress{Height: ctx.Height, TimeUnixNs: uint64(ctx.Time.UnixNano()), PreviousTimeUnixNs: deadline + 1, ResumeUsableAfterUnixNs: 1}
	for _, mutate := range []func(*HostProgress){
		func(p *HostProgress) { p.Height-- }, func(p *HostProgress) { p.TimeUnixNs-- }, func(p *HostProgress) { p.PreviousTimeUnixNs = 0 }, func(p *HostProgress) { p.PreviousTimeUnixNs = p.TimeUnixNs }, func(p *HostProgress) { p.ResumeUsableAfterUnixNs = math.MaxUint64 },
	} {
		copy := *p
		mutate(&copy)
		require.ErrorIs(t, VerifyHostWindow(ctx, deadline, &copy), ErrEpochContextPending)
	}
	require.ErrorIs(t, VerifyHostWindow(ctx, deadline, nil), ErrEpochContextPending)
	_, err := AdvanceHostProgress(Context{Height: 1, Time: time.Unix(0, math.MaxInt64)}, nil)
	require.ErrorIs(t, err, ErrInvalidTimestamp)
}
