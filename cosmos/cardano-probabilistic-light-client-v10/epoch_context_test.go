package probabilistic

import (
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
