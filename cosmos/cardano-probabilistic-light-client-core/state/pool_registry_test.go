package state

import (
	"bytes"
	"testing"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"github.com/stretchr/testify/require"
)

// Only test fixtures create bootstrap registrations from fixture table rows.
// Production requires a separate authenticated or explicitly trusted checkpoint.
func testPoolRegistry(epoch uint64, entries []*StakeDistributionEntry) *PoolRegistryState {
	registry := &PoolRegistryState{Epoch: epoch}
	for _, entry := range entries {
		binding := &PoolRegistrationBinding{PoolId: entry.PoolId, VrfKeyHash: bytes.Clone(entry.VrfKeyHash), FirstRegistrationSlot: entry.FirstRegistrationSlot}
		registry.Pools = append(registry.Pools, &PoolRegistrationRecord{Registration: clonePoolBinding(binding), Registered: true})
		registry.Mark = append(registry.Mark, clonePoolBinding(binding))
		registry.Effective = append(registry.Effective, clonePoolBinding(binding))
	}
	return registry
}

func testPoolRegistryTracker(t testing.TB, block *ProbabilisticBlock, contexts []*EpochContext) *poolRegistryTracker {
	t.Helper()
	context := epochContextByEpoch(contexts, block.Epoch)
	if context == nil {
		context = contexts[0]
	}
	tracker, err := newPoolRegistryTracker(testPoolRegistry(context.Epoch, context.StakeDistribution), context.Epoch, ^uint64(0))
	require.NoError(t, err)
	return tracker
}

func testPoolRegistryAtEpoch(t testing.TB, registry *PoolRegistryState, epoch uint64) *PoolRegistryState {
	t.Helper()
	tracker, err := newPoolRegistryTracker(registry, registry.Epoch, ^uint64(0))
	require.NoError(t, err)
	require.NoError(t, tracker.tick(epoch))
	return clonePoolRegistry(tracker.state)
}

func TestPoolRegistryNativeSnapshotOrder(t *testing.T) {
	baseline := testPoolRegistry(7, newProbabilisticTestClientState().EpochContexts[0].StakeDistribution)
	tracker, err := newPoolRegistryTracker(baseline, 7, 100)
	require.NoError(t, err)
	newKey, replacement := bytes.Repeat([]byte{0x11}, 32), bytes.Repeat([]byte{0x22}, 32)
	require.NoError(t, tracker.apply(101, []core.PoolCertificate{{PoolID: "pool-new", VRFKeyHash: newKey}, {PoolID: "pool-a", VRFKeyHash: replacement}}))
	for _, epoch := range []uint64{8, 9, 10} {
		require.NoError(t, tracker.tick(epoch))
		bindings, err := poolBindingMap(tracker.state.Effective)
		require.NoError(t, err)
		if epoch == 8 {
			require.Nil(t, bindings["pool-new"])
		} else {
			require.Equal(t, newKey, bindings["pool-new"].VrfKeyHash)
		}
		if epoch < 10 {
			require.Equal(t, baseline.Effective[0].VrfKeyHash, bindings["pool-a"].VrfKeyHash)
		} else {
			require.Equal(t, replacement, bindings["pool-a"].VrfKeyHash)
		}
	}
	require.Equal(t, uint64(0), tracker.byPool["pool-a"].Registration.FirstRegistrationSlot)
	require.Equal(t, uint64(7), baseline.Epoch)
	require.Empty(t, baseline.Pools[0].PendingVrfKeyHash)
}

func TestPoolRegistryRetirementAndCancellation(t *testing.T) {
	registry := testPoolRegistry(7, newProbabilisticTestClientState().EpochContexts[0].StakeDistribution)
	tracker, err := newPoolRegistryTracker(registry, 7, 100)
	require.NoError(t, err)
	require.NoError(t, tracker.apply(101, []core.PoolCertificate{{PoolID: "pool-a", Retirement: true, RetirementEpoch: 8}}))
	for _, epoch := range []uint64{8, 9} {
		require.NoError(t, tracker.tick(epoch))
		require.Len(t, tracker.state.Effective, 1)
		require.False(t, tracker.byPool["pool-a"].Registered)
	}
	require.NoError(t, tracker.tick(10))
	require.Empty(t, tracker.state.Effective)
	require.NoError(t, tracker.apply(201, []core.PoolCertificate{{PoolID: "pool-a", VRFKeyHash: bytes.Repeat([]byte{0x33}, 32)}}))
	require.Equal(t, uint64(0), tracker.byPool["pool-a"].Registration.FirstRegistrationSlot)
	require.NoError(t, tracker.apply(202, []core.PoolCertificate{{PoolID: "pool-a", Retirement: true, RetirementEpoch: 11}, {PoolID: "pool-a", VRFKeyHash: bytes.Repeat([]byte{0x44}, 32)}}))
	require.Zero(t, tracker.byPool["pool-a"].RetirementEpoch)
	require.NoError(t, tracker.tick(11))
	require.True(t, tracker.byPool["pool-a"].Registered)
}

func TestPoolRegistryBootstrapCannotBeInferredFromTable(t *testing.T) {
	client := newProbabilisticTestClientState()
	client.LatestCheckpointPoolRegistry = nil
	require.ErrorContains(t, validateBootstrapInput(*client), "pool registry is missing")
}

func TestAuthenticatedGenesisPoolAgeCanBeZero(t *testing.T) {
	eligible, err := poolRegisteredBeforeCutoff(10, &PoolRegistrationBinding{PoolId: "genesis-pool", FirstRegistrationSlot: 0})
	require.NoError(t, err)
	require.True(t, eligible)
}
