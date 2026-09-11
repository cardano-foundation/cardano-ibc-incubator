package probabilistic

import (
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPoolRegistrationCutoffUsesOnlyPostCutoffExactDevnetIdentity(t *testing.T) {
	const slotLength = uint64(time.Second)
	for _, tc := range []struct {
		name        string
		chainID     string
		systemStart uint64
		want        uint64
	}{
		{"fresh devnet", "cardano-devnet", poolRegistrationCutoffUnixNs + uint64(24*time.Hour), 2},
		{"boundary devnet genesis", "cardano-devnet", poolRegistrationCutoffUnixNs, 2},
		{"old devnet", "cardano-devnet", poolRegistrationCutoffUnixNs - 10*slotLength, 10},
		{"old devnet rounds up", "cardano-devnet", poolRegistrationCutoffUnixNs - 10*slotLength - 1, 11},
		{"old mainnet", "cardano-mainnet", poolRegistrationCutoffUnixNs - 10*slotLength, 10},
		{"old preprod", "cardano-preprod", poolRegistrationCutoffUnixNs - 10*slotLength, 10},
		{"old preview", "cardano-preview", poolRegistrationCutoffUnixNs - 10*slotLength, 10},
		{"fresh public", "cardano-mainnet", poolRegistrationCutoffUnixNs + slotLength, 0},
		{"fresh preprod", "cardano-preprod", poolRegistrationCutoffUnixNs + slotLength, 0},
		{"fresh preview", "cardano-preview", poolRegistrationCutoffUnixNs + slotLength, 0},
		{"public boundary", "cardano-mainnet", poolRegistrationCutoffUnixNs, 0},
		{"similar ID", "cardano-devnet-1", poolRegistrationCutoffUnixNs + slotLength, 0},
		{"whitespace ID", " cardano-devnet ", poolRegistrationCutoffUnixNs + slotLength, 0},
		{"case variant", "CARDANO-DEVNET", poolRegistrationCutoffUnixNs + slotLength, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs := newProbabilisticTestClientState()
			cs.ChainId = tc.chainID
			cs.SystemStartUnixNs = tc.systemStart
			cs.SlotLengthNs = slotLength
			got, err := cs.poolRegistrationCutoffSlotExclusive()
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}
}

func TestDevnetPoolRegistrationCutoffStillFailsClosed(t *testing.T) {
	t.Setenv("CARDANO_STABILITY_POOL_REGISTRATION_CUTOFF_SLOT", "999999")
	cs := newProbabilisticTestClientState()
	cs.ChainId = "cardano-devnet"
	cs.SystemStartUnixNs = poolRegistrationCutoffUnixNs + uint64(24*time.Hour)
	cutoff, err := cs.poolRegistrationCutoffSlotExclusive()
	require.NoError(t, err)
	require.Equal(t, uint64(2), cutoff)
	for _, slot := range []uint64{0, 1, 2, 3, math.MaxUint64} {
		eligible, err := poolRegisteredBeforeCutoff(cutoff, &StakeDistributionEntry{
			PoolId: "devnet-pool", FirstRegistrationSlot: slot,
		})
		if slot == 0 {
			require.ErrorContains(t, err, "first registration slot missing")
			require.False(t, eligible)
		} else {
			require.NoError(t, err)
			require.Equal(t, slot == 1, eligible)
		}
	}

	var missing *ClientState
	_, err = missing.poolRegistrationCutoffSlotExclusive()
	require.ErrorContains(t, err, "client state missing")
	cs.SystemStartUnixNs = 0
	_, err = cs.poolRegistrationCutoffSlotExclusive()
	require.ErrorContains(t, err, "system_start_unix_ns")
	cs.SystemStartUnixNs = poolRegistrationCutoffUnixNs
	cs.SlotLengthNs = 0
	_, err = cs.poolRegistrationCutoffSlotExclusive()
	require.ErrorContains(t, err, "slot_length_ns")
	cs.ChainId = "cardano-mainnet"
	cs.SystemStartUnixNs = 1
	cs.SlotLengthNs = math.MaxUint64
	_, err = cs.poolRegistrationCutoffSlotExclusive()
	require.ErrorContains(t, err, "overflows uint64")
}

func TestDevnetSecurityMetricsCountOnlyGenesisRegisteredPools(t *testing.T) {
	cs := newProbabilisticTestClientState()
	cs.ChainId = "cardano-devnet"
	cs.SystemStartUnixNs = poolRegistrationCutoffUnixNs + uint64(24*time.Hour)
	epoch := cloneEpochContext(cs.EpochContexts[0])
	genesis := cloneStakeDistributionEntries(epoch.StakeDistribution)[0]
	genesis.Stake = 500
	later := cloneStakeDistributionEntries(epoch.StakeDistribution)[0]
	later.PoolId = "later-pool"
	later.Stake = 500
	later.FirstRegistrationSlot = 2
	epoch.StakeDistribution = []*StakeDistributionEntry{genesis, later}
	header := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{height: 12, hash: "anchor", epoch: cs.CurrentEpoch},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor", epoch: cs.CurrentEpoch, slotLeader: genesis.PoolId},
			{height: 14, hash: "descendant-14", prevHash: "descendant-13", epoch: cs.CurrentEpoch, slotLeader: later.PoolId},
		},
	}
	pools, stake, _, err := cs.computeHeaderSecurityMetrics(header, epoch)
	require.NoError(t, err)
	require.Equal(t, uint64(1), pools)
	require.Equal(t, uint64(5000), stake)
}

func TestRecoveryPreservesPoolRegistrationPolicyClass(t *testing.T) {
	for _, tc := range []struct {
		name         string
		subjectID    string
		substituteID string
		systemStart  uint64
		matches      bool
	}{
		{"public to fresh devnet", "cardano-mainnet", "cardano-devnet", poolRegistrationCutoffUnixNs, false},
		{"fresh devnet to public", "cardano-devnet", "cardano-mainnet", poolRegistrationCutoffUnixNs, false},
		{"same fresh devnet", "cardano-devnet", "cardano-devnet", poolRegistrationCutoffUnixNs, true},
		{"pre-cutoff label change", "cardano-mainnet", "cardano-devnet", poolRegistrationCutoffUnixNs - 1, true},
		{"public label change", "cardano-old", "cardano-new", poolRegistrationCutoffUnixNs, true},
		{"similar devnet label", "cardano-devnet", "cardano-devnet-1", poolRegistrationCutoffUnixNs, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			subject := newProbabilisticTestClientState()
			substitute := newProbabilisticTestClientState()
			subject.ChainId, substitute.ChainId = tc.subjectID, tc.substituteID
			subject.SystemStartUnixNs, substitute.SystemStartUnixNs = tc.systemStart, tc.systemStart
			require.Equal(t, tc.matches, IsMatchingClientState(*subject, *substitute))
			if !tc.matches {
				cdc := newProbabilisticTestCodec()
				ctx, subjectStore := newProbabilisticTestClientStore(t, "policy-subject")
				_, substituteStore := newProbabilisticTestClientStore(t, "policy-substitute")
				err := subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute)
				require.ErrorContains(t, err, "subject client state does not match substitute client state")
			}
		})
	}
}
