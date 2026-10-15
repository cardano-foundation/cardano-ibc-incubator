package state

import (
	"bytes"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestIsMatchingClientStateIgnoresEpochVerificationState(t *testing.T) {
	subject := newProbabilisticTestClientState()
	subject.LatestHeight = NewHeight(0, 10)
	subject.FrozenHeight = NewHeight(0, 9)
	subject.CurrentEpoch = 7
	subject.CurrentEpochEndSlotExclusive = 100
	subject.TrustingPeriod = 24 * time.Hour
	subject.ChainId = "cardano-old"
	subject.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(7, 0, 100, 0x07),
	}

	substitute := newProbabilisticTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	substitute.FrozenHeight = ZeroHeight()
	substitute.CurrentEpoch = 9
	substitute.TrustingPeriod = 48 * time.Hour
	substitute.ChainId = "cardano-new"
	substitute.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(8, 100, 200, 0x08),
		makeRecoveryEpochContext(9, 200, 300, 0x09),
	}
	substitute.EpochStakeDistribution = []*StakeDistributionEntry{
		{
			PoolId:     "pool-z",
			Stake:      50_000,
			VrfKeyHash: bytes.Repeat([]byte{0x1a}, 32),
		},
	}
	substitute.EpochNonce = bytes.Repeat([]byte{0x1b}, 32)
	substitute.CurrentEpochStartSlot = 200
	substitute.CurrentEpochEndSlotExclusive = 300

	require.True(t, IsMatchingClientState(*subject, *substitute))
}

func TestIsMatchingClientStateRejectsStaticParameterMismatch(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*ClientState)
	}{
		{
			name: "upgrade path",
			mutate: func(substitute *ClientState) {
				substitute.UpgradePath = []string{"upgrade", "upgradedIBCState"}
			},
		},
		{
			name: "host state policy",
			mutate: func(substitute *ClientState) {
				substitute.HostStateNftPolicyId = bytes.Repeat([]byte{0x09}, 28)
			},
		},
		{
			name: "host state token",
			mutate: func(substitute *ClientState) {
				substitute.HostStateNftTokenName = []byte("different-host-state")
			},
		},
		{
			name: "system start",
			mutate: func(substitute *ClientState) {
				substitute.SystemStartUnixNs++
			},
		},
		{
			name: "slot length",
			mutate: func(substitute *ClientState) {
				substitute.SlotLengthNs++
			},
		},
		{
			name: "slots per KES period",
			mutate: func(substitute *ClientState) {
				substitute.SlotsPerKesPeriod++
				for _, context := range substitute.EpochContexts {
					context.SlotsPerKesPeriod++
				}
			},
		},
		{
			name: "max KES evolutions",
			mutate: func(substitute *ClientState) {
				substitute.MaxKesEvolutions--
			},
		},
		{
			name: "active slot coefficient numerator",
			mutate: func(substitute *ClientState) {
				substitute.ActiveSlotCoefficientNumerator++
			},
		},
		{
			name: "active slot coefficient denominator",
			mutate: func(substitute *ClientState) {
				substitute.ActiveSlotCoefficientDenominator++
			},
		},
		{
			name: "max clock drift",
			mutate: func(substitute *ClientState) {
				substitute.MaxClockDrift++
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			subject := newProbabilisticTestClientState()
			substitute := newProbabilisticTestClientState()
			tc.mutate(substitute)

			require.False(t, IsMatchingClientState(*subject, *substitute))
		})
	}
}

func makeRecoveryEpochContext(epoch, startSlot, endSlot uint64, seed byte) *EpochContext {
	return &EpochContext{
		Epoch:                 epoch,
		EpochStartSlot:        startSlot,
		EpochEndSlotExclusive: endSlot,
		EpochNonce:            bytes.Repeat([]byte{seed}, 32),
		SlotsPerKesPeriod:     129600,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:                   "pool-a",
				Stake:                    10_000,
				VrfKeyHash:               bytes.Repeat([]byte{seed + 1}, 32),
				RelativeStakeNumerator:   1,
				RelativeStakeDenominator: 1,
			},
		},
	}
}
