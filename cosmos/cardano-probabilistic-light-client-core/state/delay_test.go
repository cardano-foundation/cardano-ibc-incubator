package state

import (
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestVerifyDelayPeriodPassedBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name                                                       string
		processedTime, processedHeight, currentTime, currentHeight uint64
		timeDelay, blockDelay                                      uint64
		want                                                       error
	}{
		{name: "zero delays at processed point", processedTime: 10, processedHeight: 10, currentTime: 10, currentHeight: 10},
		{name: "ordinary delays at exact deadline", processedTime: 10, processedHeight: 10, timeDelay: 5, blockDelay: 3, currentTime: 15, currentHeight: 13},
		{name: "after both deadlines", processedTime: 10, processedHeight: 10, timeDelay: 5, blockDelay: 3, currentTime: 16, currentHeight: 14},
		{name: "before time deadline", processedTime: 10, processedHeight: 10, timeDelay: 5, blockDelay: 3, currentTime: 14, currentHeight: 13, want: ErrDelayPeriodNotPassed},
		{name: "before block deadline", processedTime: 10, processedHeight: 10, timeDelay: 5, blockDelay: 3, currentTime: 15, currentHeight: 12, want: ErrDelayPeriodNotPassed},
		{name: "time overflow to zero", processedTime: 1, processedHeight: 1, timeDelay: math.MaxUint64, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "block overflow to zero", processedTime: 1, processedHeight: 1, blockDelay: math.MaxUint64, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "processed time maximum overflow", processedTime: math.MaxUint64, processedHeight: 1, timeDelay: 1, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "processed height maximum overflow", processedTime: 1, processedHeight: math.MaxUint64, blockDelay: 1, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "both deadlines overflow", processedTime: 1, processedHeight: 1, timeDelay: math.MaxUint64, blockDelay: math.MaxUint64, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "representable time maximum is still pending", processedTime: math.MaxUint64 - 1, processedHeight: 1, timeDelay: 1, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "representable height maximum is still pending", processedTime: 1, processedHeight: math.MaxUint64 - 1, blockDelay: 1, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "largest signed host values at deadline", processedTime: math.MaxInt64 - 1, processedHeight: math.MaxInt64 - 1, timeDelay: 1, blockDelay: 1, currentTime: math.MaxInt64, currentHeight: math.MaxInt64},
		{name: "processed time is in future", processedTime: 11, processedHeight: 10, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
		{name: "processed height is in future", processedTime: 10, processedHeight: 11, currentTime: 10, currentHeight: 10, want: ErrDelayPeriodNotPassed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, store := newProbabilisticTestClientStore(t, "delay-boundaries")
			height := NewHeight(0, 10)
			SetProcessedTime(store, height, tc.processedTime)
			SetProcessedHeight(store, height, NewHostHeight(0, tc.processedHeight))
			ctx = ctx.WithBlockTime(time.Unix(0, int64(tc.currentTime))).WithBlockHeight(int64(tc.currentHeight))
			err := VerifyDelayPeriodPassed(ctx, store, height, tc.timeDelay, tc.blockDelay)
			if tc.want == nil {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, tc.want)
			}
		})
	}
}

func TestVerifyDelayPeriodPassedRequiresProcessedMetadata(t *testing.T) {
	ctx, store := newProbabilisticTestClientStore(t, "delay-metadata")
	height := NewHeight(0, 10)
	require.ErrorIs(t, VerifyDelayPeriodPassed(ctx, store, height, 0, 0), ErrProcessedTimeNotFound)
	SetProcessedTime(store, height, uint64(ctx.BlockTime().UnixNano()))
	require.ErrorIs(t, VerifyDelayPeriodPassed(ctx, store, height, 0, 0), ErrProcessedHeightNotFound)
	SetProcessedHeight(store, height, ctx.SelfHeight)
	require.NoError(t, VerifyDelayPeriodPassed(ctx, store, height, 0, 0))
}
