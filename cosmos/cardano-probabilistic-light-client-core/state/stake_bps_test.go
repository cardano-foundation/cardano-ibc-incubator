package state

import (
	"testing"

	"github.com/stretchr/testify/require"
)

const maxStakeUint64 = ^uint64(0)

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
				PoolId:                   "pool-max",
				Stake:                    maxStakeUint64,
				VrfKeyHash:               make([]byte, 32),
				FirstRegistrationSlot:    1,
				RelativeStakeNumerator:   1,
				RelativeStakeDenominator: 2,
			},
			{
				PoolId:                   "pool-overflow",
				Stake:                    2,
				VrfKeyHash:               make([]byte, 32),
				FirstRegistrationSlot:    1,
				RelativeStakeNumerator:   1,
				RelativeStakeDenominator: 2,
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
	authenticatedHeader.anchorPoolRegistry = testPoolRegistry(epochContext.Epoch, epochContext.StakeDistribution)
	_, _, err = cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)
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
				VrfKeyHash:            make([]byte, 32),
				Stake:                 qualifiedStake,
				FirstRegistrationSlot: 1,
			},
			{
				PoolId:                "other-pool",
				VrfKeyHash:            make([]byte, 32),
				Stake:                 totalStake - qualifiedStake,
				FirstRegistrationSlot: 1,
			},
		},
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			slot:   testMaturePoolSlot,
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

	authenticatedHeader.anchorPoolRegistry = testPoolRegistry(epochContext.Epoch, epochContext.StakeDistribution)
	authenticatedHeader.anchorSettlementCredit = mustTestSettlementCredit(epochContext)
	authenticatedHeader.anchorPoolProduction = testPoolProduction(epochContext)
	qualifiedPools, qualifiedStakeBps, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.NoError(t, err)
	require.Equal(t, uint64(1), qualifiedPools)
	require.Equal(t, uint64(838), qualifiedStakeBps)
}
