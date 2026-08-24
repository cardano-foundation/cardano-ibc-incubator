package probabilistic

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEpochContextForSlotPrefersLatestMatchingEpoch(t *testing.T) {
	contexts := []*EpochContext{
		{
			Epoch:                 2,
			EpochStartSlot:        10_000,
			EpochEndSlotExclusive: 442_000,
		},
		{
			Epoch:                 3,
			EpochStartSlot:        15_000,
			EpochEndSlotExclusive: 20_000,
		},
	}

	match := epochContextForSlot(contexts, 15_348)
	if match == nil {
		t.Fatal("expected matching epoch context")
	}
	if match.Epoch != 3 {
		t.Fatalf("expected epoch 3, got %d", match.Epoch)
	}
}

func TestEpochContextsEqualIncludesExactRelativeStake(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	left := cloneEpochContext(mustCurrentTestEpochContext(t, clientState))
	right := cloneEpochContext(left)

	right.StakeDistribution[0].RelativeStakeNumerator = 2
	right.StakeDistribution[0].RelativeStakeDenominator = 2
	if epochContextsEqual(left, right) {
		t.Fatal("expected relative-stake change to conflict")
	}
}

func TestValidateEpochContextRejectsInvalidRelativeStake(t *testing.T) {
	testCases := []struct {
		name        string
		numerator   uint64
		denominator uint64
		errorText   string
	}{
		{name: "zero numerator", denominator: 1, errorText: "numerator"},
		{name: "zero denominator", numerator: 1, errorText: "denominator"},
		{name: "above one", numerator: 2, denominator: 1, errorText: "must not exceed one"},
		{name: "incomplete total", numerator: 1, denominator: 2, errorText: "must sum to one"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			clientState := newProbabilisticTestClientState()
			ctx := cloneEpochContext(mustCurrentTestEpochContext(t, clientState))
			ctx.StakeDistribution[0].RelativeStakeNumerator = testCase.numerator
			ctx.StakeDistribution[0].RelativeStakeDenominator = testCase.denominator

			err := validateEpochContext(ctx)
			require.ErrorContains(t, err, testCase.errorText)
		})
	}
}

func TestValidateEpochContextRejectsStakeWeightOverflow(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	ctx := cloneEpochContext(mustCurrentTestEpochContext(t, clientState))
	ctx.StakeDistribution[0].Stake = ^uint64(0)
	ctx.StakeDistribution[0].RelativeStakeNumerator = 1
	ctx.StakeDistribution[0].RelativeStakeDenominator = 2
	ctx.StakeDistribution = append(ctx.StakeDistribution, &StakeDistributionEntry{
		PoolId:                   "pool-b",
		Stake:                    1,
		VrfKeyHash:               bytes.Repeat([]byte{0x04}, 32),
		FirstRegistrationSlot:    1,
		RelativeStakeNumerator:   1,
		RelativeStakeDenominator: 2,
	})

	err := validateEpochContext(ctx)
	require.ErrorContains(t, err, "overflows uint64")
}

func TestEpochContextsEqualIncludesFirstRegistrationSlot(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	left := cloneEpochContext(mustCurrentTestEpochContext(t, clientState))
	right := cloneEpochContext(left)

	if !epochContextsEqual(left, right) {
		t.Fatal("expected identical epoch contexts to match")
	}

	right.StakeDistribution[0].FirstRegistrationSlot++
	if epochContextsEqual(left, right) {
		t.Fatal("expected registration-slot change to conflict")
	}
}

func TestValidateEpochContextParametersRejectsMutableKesPeriodLength(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	contexts := cloneEpochContexts(clientState.EpochContexts)
	contexts[0].SlotsPerKesPeriod++

	err := clientState.validateEpochContextParameters(contexts)
	require.ErrorContains(t, err, "must match immutable client value")
}

func TestClientStateRejectsUnsupportedKesConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*ClientState)
		want   string
	}{
		{
			name: "zero max evolutions",
			mutate: func(clientState *ClientState) {
				clientState.MaxKesEvolutions = 0
			},
			want: "max_kes_evolutions must be between",
		},
		{
			name: "too many evolutions",
			mutate: func(clientState *ClientState) {
				clientState.MaxKesEvolutions = 65
			},
			want: "max_kes_evolutions must be between",
		},
		{
			name: "zero slots per period",
			mutate: func(clientState *ClientState) {
				clientState.SlotsPerKesPeriod = 0
			},
			want: "slots_per_kes_period must be greater than zero",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			clientState := newProbabilisticTestClientState()
			tc.mutate(clientState)
			require.ErrorContains(t, clientState.Validate(), tc.want)
		})
	}
}

func TestClientStateValidateRejectsInvalidActiveSlotCoefficient(t *testing.T) {
	testCases := []struct {
		name        string
		numerator   uint64
		denominator uint64
		errorText   string
	}{
		{name: "zero numerator", denominator: 20, errorText: "numerator"},
		{name: "zero denominator", numerator: 1, errorText: "denominator"},
		{name: "above one", numerator: 21, denominator: 20, errorText: "must not exceed one"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			clientState := newProbabilisticTestClientState()
			clientState.ActiveSlotCoefficientNumerator = testCase.numerator
			clientState.ActiveSlotCoefficientDenominator = testCase.denominator

			err := clientState.Validate()
			require.ErrorContains(t, err, testCase.errorText)
		})
	}
}
