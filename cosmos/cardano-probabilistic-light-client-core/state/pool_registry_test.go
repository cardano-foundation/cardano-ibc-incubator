package state

import (
	"bytes"
	"testing"
	"time"

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

func TestStakeTableCannotSupplyPoolIdentityKeyOrAge(t *testing.T) {
	for _, field := range []string{"identity", "VRF", "age"} {
		t.Run(field, func(t *testing.T) {
			client := newProbabilisticTestClientState()
			context := cloneEpochContext(client.EpochContexts[0])
			switch field {
			case "identity":
				context.StakeDistribution[0].PoolId = "invented-pool"
			case "VRF":
				context.StakeDistribution[0].VrfKeyHash = bytes.Repeat([]byte{0xff}, 32)
			case "age":
				context.StakeDistribution[0].FirstRegistrationSlot++
			}
			require.NoError(t, validateEpochContext(context))
			require.Error(t, verifyStakeTablePoolBindings(context, client.LatestCheckpointPoolRegistry))
			header := newVerifiedTestHeader(t)
			header.NewEpochContext = context
			ctx, store := newProbabilisticTestClientStore(t, "registry-"+field)
			cdc := newProbabilisticTestCodec()
			require.NoError(t, client.Initialize(ctx, cdc, store, newProbabilisticTestConsensusState(testBlockHash("trusted-hash"))))
			before, found := GetClientState(store, cdc)
			require.True(t, found)
			require.Error(t, client.VerifyClientMessage(ctx, cdc, store, header))
			after, found := GetClientState(store, cdc)
			require.True(t, found)
			require.Equal(t, before, after)
		})
	}
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
	require.ErrorContains(t, client.Validate(), "pool registry is missing")
}

func TestAuthenticatedGenesisPoolAgeCanBeZero(t *testing.T) {
	eligible, err := poolRegisteredBeforeCutoff(10, &PoolRegistrationBinding{PoolId: "genesis-pool", FirstRegistrationSlot: 0})
	require.NoError(t, err)
	require.True(t, eligible)
}

func TestPoolRegistryMismatchDoesNotBecomeTrustedAfterChallenge(t *testing.T) {
	base := newTemporalVerifierEpochContext(7, 0, 1_000, 7)
	ctx, cdc, store, client := initializeTemporalVerifierClient(t, "registry-expired-challenge", 100, base)
	ctx = ctx.WithBlockTime(ctx.BlockTime().Add(4 * time.Minute))
	header := newTemporalVerifierHeader(t, client, "next", 11, 101, 7, true)
	header.TrustedHeight = client.LatestCheckpointHeight
	header.NewEpochContext = cloneEpochContext(base)
	header.NewEpochContext.StakeDistribution[0].VrfKeyHash = bytes.Repeat([]byte{0xff}, 32)
	authenticated := newTemporalVerifierAuthenticatedHeader(t, client, client.LatestCheckpointBlockHash, header.AnchorBlock.Hash, 11, 101, 7)
	authenticated.anchorNonceState = clonePraosNonceState(client.LatestCheckpointNonceState)
	authenticated.anchorPoolRegistry = clonePoolRegistry(client.LatestCheckpointPoolRegistry)
	before, _ := GetClientState(store, cdc)
	err := client.verifyHeaderWithAuthenticator(ctx, store, cdc, header,
		func(*ProbabilisticHeader, []*EpochContext, map[string]uint64, *trustedBlockState) (*authenticatedProbabilisticHeader, error) {
			return authenticated, nil
		})
	require.ErrorContains(t, err, "disagrees with authenticated epoch history")
	require.False(t, client.CheckForMisbehaviour(ctx, cdc, store, header))
	after, _ := GetClientState(store, cdc)
	require.Equal(t, before, after)
}

func TestPoolRegistryCheckpointRestoresPendingChangesAtHistoricalHeight(t *testing.T) {
	client := newProbabilisticTestClientState()
	ctx, store := newProbabilisticTestClientStore(t, "registry-rollback")
	cdc := newProbabilisticTestCodec()
	initial := newProbabilisticTestConsensusState(testBlockHash("registry-initial"))
	require.NoError(t, client.Initialize(ctx, cdc, store, initial))
	baseline := clonePoolRegistry(client.LatestCheckpointPoolRegistry)
	tracker, err := newPoolRegistryTracker(baseline, 7, 0)
	require.NoError(t, err)
	require.NoError(t, tracker.apply(1, []core.PoolCertificate{{PoolID: "pool-a", VRFKeyHash: bytes.Repeat([]byte{0x99}, 32)}}))
	header := &authenticatedProbabilisticHeader{anchorBlock: &authenticatedProbabilisticBlock{
		height: 11, slot: 1, epoch: 7, hash: testBlockHash("registry-checkpoint"), timestamp: client.SystemStartUnixNs + client.SlotLengthNs},
		anchorNonceState: clonePraosNonceState(client.LatestCheckpointNonceState), anchorPoolRegistry: clonePoolRegistry(tracker.state),
		anchorSettlementCredit: cloneSettlementCredit(client.LatestCheckpointSettlementCredit),
		anchorPoolProduction:   clonePoolProduction(client.LatestCheckpointPoolProduction)}
	require.NoError(t, client.persistCheckpoint(store, cdc, client.EpochContexts, header))
	stored, _ := GetClientState(store, cdc)
	latest, err := stored.trustedBlockStateAtHeight(store, cdc, NewHeight(0, 11))
	require.NoError(t, err)
	require.True(t, poolRegistriesEqual(tracker.state, latest.poolRegistry))
	old, err := stored.trustedBlockStateAtHeight(store, cdc, NewHeight(0, 10))
	require.NoError(t, err)
	require.True(t, poolRegistriesEqual(baseline, old.poolRegistry))
	require.Empty(t, old.poolRegistry.Pools[0].PendingVrfKeyHash)
	require.NotEmpty(t, latest.poolRegistry.Pools[0].PendingVrfKeyHash)
}
