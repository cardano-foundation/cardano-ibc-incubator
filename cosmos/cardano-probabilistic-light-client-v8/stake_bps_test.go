package probabilistic

import (
	"math/big"
	"testing"

	"github.com/stretchr/testify/require"
)

const maxStakeUint64 = ^uint64(0)

func TestMinBpsBoundaries(t *testing.T) {
	overflowBoundary := maxStakeUint64 / 10_000
	testCases := []struct {
		name           string
		qualifiedStake uint64
		totalStake     uint64
		want           uint64
	}{
		{
			name:           "zero qualified stake",
			qualifiedStake: 0,
			totalStake:     22_000_000_000_000_000,
			want:           0,
		},
		{
			name:           "largest legacy multiplication without overflow",
			qualifiedStake: overflowBoundary,
			totalStake:     22_000_000_000_000_000,
			want:           838,
		},
		{
			name:           "first legacy multiplication overflow",
			qualifiedStake: overflowBoundary + 1,
			totalStake:     22_000_000_000_000_000,
			want:           838,
		},
		{
			name:           "qualified stake near uint64 maximum",
			qualifiedStake: maxStakeUint64 - 1,
			totalStake:     maxStakeUint64,
			want:           9_999,
		},
		{
			name:           "all stake qualified at uint64 maximum",
			qualifiedStake: maxStakeUint64,
			totalStake:     maxStakeUint64,
			want:           10_000,
		},
		{
			name:           "qualified stake capped when above total",
			qualifiedStake: maxStakeUint64,
			totalStake:     maxStakeUint64 - 1,
			want:           10_000,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			oracle := gatewayStakeBpsOracle(tc.qualifiedStake, tc.totalStake)
			require.Equal(t, tc.want, oracle)

			got := minBps(tc.qualifiedStake, tc.totalStake)
			require.Equal(t, oracle, got)
		})
	}
}

func TestMinBpsZeroTargetIsFullySatisfied(t *testing.T) {
	require.Equal(t, uint64(10_000), minBps(0, 0))
	require.Equal(t, uint64(10_000), minBps(1, 0))
}

func TestMinBpsMatchesGatewayBigInt(t *testing.T) {
	// Use a fixed LCG so this adversarial sweep is reproducible across Go versions.
	state := uint64(647)
	next := func() uint64 {
		state = state*6_364_136_223_846_793_005 + 1_442_695_040_888_963_407
		return state
	}

	for i := 0; i < 512; i++ {
		totalStake := next()
		if totalStake == 0 {
			totalStake = 1
		}
		qualifiedStake := next()
		switch i % 4 {
		case 0:
			qualifiedStake %= totalStake
		case 1:
			qualifiedStake = totalStake - 1
		case 2:
			qualifiedStake = totalStake
		case 3:
			if totalStake < maxStakeUint64 {
				qualifiedStake = totalStake + 1
			}
		}

		want := gatewayStakeBpsOracle(qualifiedStake, totalStake)
		got := minBps(qualifiedStake, totalStake)
		if got != want {
			t.Fatalf("case %d (%d/%d): got %d bps, want %d", i, qualifiedStake, totalStake, got, want)
		}
	}
}

func TestCheckedAddStakeDetectsOverflow(t *testing.T) {
	testCases := []struct {
		name     string
		current  uint64
		addition uint64
		want     uint64
		wantOK   bool
	}{
		{name: "zero", current: 0, addition: 0, want: 0, wantOK: true},
		{name: "exact maximum", current: maxStakeUint64 - 1, addition: 1, want: maxStakeUint64, wantOK: true},
		{name: "maximum plus zero", current: maxStakeUint64, addition: 0, want: maxStakeUint64, wantOK: true},
		{name: "maximum plus one", current: maxStakeUint64, addition: 1, wantOK: false},
		{name: "crosses maximum", current: maxStakeUint64 - 9, addition: 10, wantOK: false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := checkedAddStake(tc.current, tc.addition)
			require.Equal(t, tc.wantOK, ok)
			if tc.wantOK {
				require.Equal(t, tc.want, got)
			}
		})
	}
}

func TestStakeAggregationRejectsTotalOverflowBeforeItCanFailOpen(t *testing.T) {
	cs := newProbabilisticTestClientState()
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            make([]byte, 32),
		SlotsPerKesPeriod:     1,
		EpochStartSlot:        1,
		EpochEndSlotExclusive: 2,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:                "pool-max",
				Stake:                 maxStakeUint64,
				VrfKeyHash:            make([]byte, 32),
				FirstRegistrationSlot: 1,
			},
			{
				PoolId:                "pool-overflow",
				Stake:                 2,
				VrfKeyHash:            make([]byte, 32),
				FirstRegistrationSlot: 1,
			},
		},
	}

	err := validateEpochContext(epochContext)
	require.ErrorContains(t, err, "stake distribution total overflows uint64")

	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{
				height:     13,
				hash:       "descendant-13",
				prevHash:   "anchor-12",
				epoch:      cs.CurrentEpoch,
				slotLeader: "pool-overflow",
			},
		},
	}
	_, _, _, err = cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)
	require.ErrorContains(t, err, "stake distribution total overflows uint64")
}

func TestComputeHeaderSecurityMetricsHandlesIssue647StakeRatio(t *testing.T) {
	const (
		qualifiedStake = uint64(1_844_674_407_370_956)
		totalStake     = uint64(22_000_000_000_000_000)
	)

	cs := newProbabilisticTestClientState()
	epochContext := &EpochContext{
		Epoch: cs.CurrentEpoch,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:                "qualified-pool",
				Stake:                 qualifiedStake,
				FirstRegistrationSlot: 1,
			},
			{
				PoolId:                "other-pool",
				Stake:                 totalStake - qualifiedStake,
				FirstRegistrationSlot: 1,
			},
		},
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{
				height:     13,
				hash:       "descendant-13",
				prevHash:   "anchor-12",
				epoch:      cs.CurrentEpoch,
				slotLeader: "qualified-pool",
			},
		},
	}

	qualifiedPools, qualifiedStakeBps, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.NoError(t, err)
	require.Equal(t, uint64(1), qualifiedPools)
	require.Equal(t, uint64(838), qualifiedStakeBps)
}

func gatewayStakeBpsOracle(qualifiedStake, totalStake uint64) uint64 {
	if qualifiedStake >= totalStake {
		return 10_000
	}

	numerator := new(big.Int).SetUint64(qualifiedStake)
	numerator.Mul(numerator, big.NewInt(10_000))
	numerator.Quo(numerator, new(big.Int).SetUint64(totalStake))
	return numerator.Uint64()
}
