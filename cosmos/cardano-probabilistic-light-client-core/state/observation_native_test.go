package state

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"

	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/gaskv"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func runObservationStep(t *testing.T, ctx Context, cdc StateCodec, private storetypes.KVStore, client *ClientState, header *ProbabilisticHeader) {
	t.Helper()
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, header), "operation %d sequence %d", header.ObservationChunk.Operation, header.ObservationChunk.Sequence)
	require.False(t, client.CheckForMisbehaviour(ctx, cdc, private, header))
	client.UpdateState(ctx, cdc, private, header)
}
func TestStagedNativeBoundaryDifferential(t *testing.T) {
	fixture := makeNativeBoundaryFixture(t, false, 80*1024)
	fixture.Client.TrustingPeriod = 7 * 24 * time.Hour
	// This logical window deliberately exceeds a one-transaction header limit.
	require.Greater(t, len(fixture.Header.BridgeBlocks), 30)
	meter := storetypes.NewInfiniteGasMeter()
	shared := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	private := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	ctx := Context{Time: time.Unix(0, int64(fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp)).Add(time.Hour), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }, ConsumeGas: meter.ConsumeGas, GasConsumed: meter.GasConsumed}
	cdc := jsonTestCodec{}
	client, _, err := initializeTrusted(t, ctx, cdc, private, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	ctx.HostProgress = testHostProgress
	ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + 2*time.Second)
	base := bytes.Clone(client.CheckpointReference)
	plan, err := BuildObservationPlan(client, fixture.Header, nil, uint64(len(fixture.Client.EpochStakeDistribution)), 4)
	require.NoError(t, err)
	for _, step := range plan.Steps {
		start := meter.GasConsumed()
		runObservationStep(t, ctx, cdc, private, client, step)
		require.Less(t, meter.GasConsumed()-start, MaxOperationGas)
		require.Equal(t, base, client.CheckpointReference, "staging must not commit an anchor")
	}
	session, err := loadObservationSession(shared, client, plan.SessionID[:])
	require.NoError(t, err)
	require.True(t, session.Complete)
	receipts, err := loadVerifiedObservation(shared, client, session.Receipt)
	require.NoError(t, err)
	require.Equal(t, fixture.Header.AnchorBlock.Height.RevisionHeight, receipts.AnchorHeight)
	// First activation installs only the proposal and keeps the trusted checkpoint.
	activate := &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationActivate, SessionId: plan.SessionID[:], Sequence: session.Sequence + 1}}
	runObservationStep(t, ctx, cdc, private, client, activate)
	require.Equal(t, base, client.CheckpointReference)
	session, err = loadObservationSession(shared, client, plan.SessionID[:])
	require.NoError(t, err)
	ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + time.Second)
	activate.ObservationChunk.Sequence = session.Sequence + 1
	runObservationStep(t, ctx, cdc, private, client, activate)
	require.NotEqual(t, base, client.CheckpointReference)
	cp, _, err := currentVerificationCheckpoint(ctx, client)
	require.NoError(t, err)
	oracleStore := dbadapter.Store{DB: dbm.NewMemDB()}

	trusted, err := fixture.Client.latestTrustedBlockState(oracleStore, cdc)
	require.NoError(t, err)
	auth, err := fixture.Client.authenticateHeaderBlocksWithContexts(fixture.Header, append(fixture.Client.EpochContexts, fixture.Header.NewEpochContext), trusted.operationalCertificateCounters, trusted)
	require.NoError(t, err)
	require.NoError(t, attachSettlementCredit(auth, trusted, append(fixture.Client.EpochContexts, fixture.Header.NewEpochContext)))
	require.NoError(t, attachPoolProduction(auth, trusted))
	require.Equal(t, auth.anchorNonceState, cp.Nonce)
	require.Equal(t, auth.anchorBlock.hash, client.LatestCheckpointBlockHash)
	for _, counter := range auth.anchorOperationalCertificateCounters {
		raw, found, err := NewSnapshotMap(shared, cp.Scope, snapshotCounters).Lookup(cp.Counters, counter.PoolId)
		require.NoError(t, err)
		require.True(t, found)
		require.Equal(t, counter.SequenceNumber, binary.BigEndian.Uint64(raw))
	}
	for _, binding := range auth.anchorPoolRegistry.Effective {
		stored, found, err := lookupBinding(shared, cp.Scope, cp.Registry.Effective, mustPoolKey(t, binding.PoolId))
		require.NoError(t, err)
		require.True(t, found)
		require.Equal(t, binding, stored)
	}
	credits, err := settlementCreditMap(auth.anchorSettlementCredit.Reference)
	require.NoError(t, err)
	for name, expected := range credits {
		got, err := lookupCredit(shared, cp.Scope, cp.Credit, mustPoolKey(t, name))
		require.NoError(t, err)
		require.Zero(t, got.Cmp(expected))
	}
	for _, expected := range auth.anchorPoolProduction.Pools {
		got, err := lookupProduction(shared, cp.Scope, cp.Production, mustPoolKey(t, expected.PoolId), cp.Epoch)
		require.NoError(t, err)
		require.Equal(t, expected, got)
	}
	previous, err := core.DecodePacketStateSnapshot(fixture.Consensus.PacketStateSnapshot)
	require.NoError(t, err)
	var bodies [][]byte
	for _, block := range append(append([]*ProbabilisticBlock{}, fixture.Header.BridgeBlocks...), fixture.Header.AnchorBlock) {
		bodies = append(bodies, block.BlockCbor)
	}
	expectedPacket, err := core.AdvancePacketStateSnapshot(previous, bodies, client.PacketLanePolicyId, client.HostStateNftPolicyId, client.HostStateNftTokenName)
	require.NoError(t, err)
	packet, err := loadPacketCheckpoint(shared, cp.Scope, cp.PacketReference)
	require.NoError(t, err)
	actualPacket := packetSubset(packet)
	_, err = NewSnapshotMap(shared, cp.Scope, snapshotPacketLanes).Visit(packet.Lanes, nil, 128, func(key, value []byte) error {
		lane, err := decodePacketLane(value, packet.Height)
		if err != nil {
			return err
		}
		actualPacket.Lanes[hex.EncodeToString(key)] = lane
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, expectedPacket, actualPacket)

	// Descendants' counters and production never replace anchor state.
	production, err := lookupProduction(shared, cp.Scope, cp.Production, mustPoolKey(t, fixture.Client.EpochStakeDistribution[0].PoolId), cp.Epoch)
	require.NoError(t, err)
	require.NotNil(t, production)
	hash, found, err := NewSnapshotMap(shared, cp.Scope, snapshotSettledHistory).Lookup(cp.SettledHistory, binary.BigEndian.AppendUint64(nil, cp.Height+1))
	require.NoError(t, err)
	require.False(t, found)
	require.Empty(t, hash)
}
func mustPoolKey(t *testing.T, name string) []byte {
	t.Helper()
	key, err := poolKey(name)
	require.NoError(t, err)
	return key
}

func savedNativeBoundary(t *testing.T, name string) nativeBoundaryFixture {
	t.Helper()
	file, err := os.Open("../testdata/native-boundary-" + name + ".json.gz")
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()
	var fixture nativeBoundaryFixture
	require.NoError(t, json.NewDecoder(reader).Decode(&fixture))
	return fixture
}
func TestReceiptChallengeAndRecoveryUsePinnedHistory(t *testing.T) {
	fixture := savedNativeBoundary(t, "size")
	fixture.Client.TrustingPeriod = 7 * 24 * time.Hour
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	subjectPrivate := dbadapter.Store{DB: dbm.NewMemDB()}
	substitutePrivate := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{Time: time.Unix(0, int64(fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp)).Add(time.Hour), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	subject, _, err := initializeTrusted(t, ctx, cdc, subjectPrivate, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	substitute, _, err := initializeTrusted(t, ctx, cdc, substitutePrivate, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	ctx.HostProgress = testHostProgress
	ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + 2*time.Second)
	plan, err := BuildObservationPlan(subject, fixture.Header, nil, 13, 4)
	require.NoError(t, err)
	for _, step := range plan.Steps {
		runObservationStep(t, ctx, cdc, subjectPrivate, subject, step)
	}
	session, err := loadObservationSession(shared, subject, plan.SessionID[:])
	require.NoError(t, err)
	firstID := bytes.Clone(session.Receipt)
	runObservationStep(t, ctx, cdc, subjectPrivate, subject, &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationActivate, SessionId: plan.SessionID[:], Sequence: session.Sequence + 1}})
	// The independent challenge starts at the receipt's pre-proposal checkpoint.
	alternative, err := BuildObservationPlan(subject, fixture.Fork, firstID, 13, 1)
	require.NoError(t, err)
	for _, step := range alternative.Steps {
		runObservationStep(t, ctx, cdc, subjectPrivate, subject, step)
	}
	other, err := loadObservationSession(shared, subject, alternative.SessionID[:])
	require.NoError(t, err)
	evidence := &Misbehaviour{VerifiedObservation_1: firstID, VerifiedObservation_2: other.Receipt}
	require.NoError(t, subject.VerifyClientMessage(ctx, cdc, subjectPrivate, evidence))
	require.True(t, subject.CheckForMisbehaviour(ctx, cdc, subjectPrivate, evidence))
	subject.UpdateStateOnMisbehaviour(ctx, cdc, subjectPrivate, evidence)
	subject, _ = GetClientState(subjectPrivate, cdc)
	require.Equal(t, Frozen, subject.Status(ctx, subjectPrivate, cdc))
	// A separate client can accept the honest branch and supply recovery state.
	honest, err := BuildObservationPlan(substitute, fixture.Fork, nil, 13, 4)
	require.NoError(t, err)
	for _, step := range honest.Steps {
		runObservationStep(t, ctx, cdc, substitutePrivate, substitute, step)
	}
	stable, err := loadObservationSession(shared, substitute, honest.SessionID[:])
	require.NoError(t, err)
	activation := &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationActivate, SessionId: honest.SessionID[:], Sequence: stable.Sequence + 1}}
	runObservationStep(t, ctx, cdc, substitutePrivate, substitute, activation)
	ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + time.Second)
	activation.ObservationChunk.Sequence++
	runObservationStep(t, ctx, cdc, substitutePrivate, substitute, activation)
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectPrivate, substitutePrivate, substitute))
	subject, _ = GetClientState(subjectPrivate, cdc)
	if subject.Status(ctx, subjectPrivate, cdc) == Frozen {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, subjectPrivate, ObservationContinueRecovery))
		subject, _ = GetClientState(subjectPrivate, cdc)
	}
	require.Equal(t, uint64(2), subject.VerificationGeneration)
	require.Equal(t, substitute.CheckpointReference, subject.CheckpointReference)
	require.Error(t, subject.VerifyClientMessage(ctx, cdc, subjectPrivate, evidence), "old-generation receipts cannot freeze recovered state")
	require.False(t, subject.CheckForMisbehaviour(ctx, cdc, subjectPrivate, evidence))
	require.Error(t, subject.verifyEpochUsable(ctx, substitute.CurrentEpoch), "recovery gives replacement roots a fresh deadline")
	// Bounded cleanup must leave replacement pages owned by the subject even
	// after deleting discarded sessions and pruning the substitute's old owners.
	for i := 0; i < 20; i++ {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, subjectPrivate, ObservationCleanup))
	}
	_, _, err = currentVerificationCheckpoint(ctx, subject)
	require.NoError(t, err)
}

func TestStagingRetriesAndOrderingDoNotChangeDeadlines(t *testing.T) {
	fixture := savedNativeBoundary(t, "size")
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{Time: time.Unix(0, int64(fixture.Consensus.Timestamp)), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	client, _, err := initializeTrusted(t, ctx, cdc, private, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	plan, err := BuildObservationPlan(client, fixture.Header, nil, 13, 4)
	require.NoError(t, err)
	runObservationStep(t, ctx, cdc, private, client, plan.Steps[0])
	runObservationStep(t, ctx, cdc, private, client, plan.Steps[1])
	first, err := loadObservationSession(shared, client, plan.SessionID[:])
	require.NoError(t, err)
	ctx.Time = ctx.Time.Add(time.Minute)
	runObservationStep(t, ctx, cdc, private, client, plan.Steps[1])
	retry, err := loadObservationSession(shared, client, plan.SessionID[:])
	require.NoError(t, err)
	require.Equal(t, first, retry)
	require.Error(t, client.VerifyClientMessage(ctx, cdc, private, plan.Steps[3]))
	require.Equal(t, fixture.Client.LatestCheckpointHeight, client.LatestCheckpointHeight)
}

func TestObservationDiscardRequiresExpiry(t *testing.T) {
	for _, tc := range []struct {
		name   string
		offset time.Duration
	}{
		{"active", -time.Nanosecond},
		{"at expiry", 0},
		{"after expiry", time.Nanosecond},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newSnapshotExpiryFixture(t)
			plan, err := BuildObservationPlan(f.client, f.evidence.Header, nil, 13, 4)
			require.NoError(t, err)
			for _, step := range plan.Steps[:2] {
				runObservationStep(t, f.ctx, f.cdc, f.private, f.client, step)
			}
			session, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
			require.NoError(t, err)
			f.ctx.Time = time.Unix(0, int64(session.ExpiresAt)).Add(tc.offset)
			discard := &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationDiscard, SessionId: plan.SessionID[:], Sequence: session.Sequence + 1}}
			if tc.offset < 0 {
				before := observationStoreContents(t, f.shared)
				require.ErrorContains(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, discard), "live observation")
				require.Equal(t, before, observationStoreContents(t, f.shared), "rejected discard must preserve progress and snapshot owners")
				return
			}
			require.ErrorContains(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, plan.Steps[2]), "observation session has expired")
			runObservationStep(t, f.ctx, f.cdc, f.private, f.client, discard)
			require.False(t, f.shared.Has(observationSessionKey(f.client.StorageNamespace, f.client.VerificationGeneration, plan.SessionID[:])))
			require.False(t, f.shared.Has(retentionKey(f.client, 1, plan.SessionID[:])))
			_, _, err = currentVerificationCheckpoint(f.ctx, f.client)
			require.NoError(t, err, "discard must preserve the client's committed checkpoint")
		})
	}
}

func TestObservationCleanupPreservesActiveSessions(t *testing.T) {
	f := newSnapshotExpiryFixture(t)
	plan, err := BuildObservationPlan(f.client, f.evidence.Header, nil, 13, 4)
	require.NoError(t, err)
	for _, step := range plan.Steps[:2] {
		runObservationStep(t, f.ctx, f.cdc, f.private, f.client, step)
	}
	session, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
	require.NoError(t, err)
	f.ctx.Time = time.Unix(0, int64(session.ExpiresAt)).Add(-time.Nanosecond)
	require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
	retained, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
	require.NoError(t, err)
	require.Equal(t, session, retained)
	f.ctx.Time = f.ctx.Time.Add(time.Nanosecond)
	require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
	require.False(t, f.shared.Has(observationSessionKey(f.client.StorageNamespace, f.client.VerificationGeneration, plan.SessionID[:])))
	require.False(t, f.shared.Has(retentionKey(f.client, 1, plan.SessionID[:])))
	_, _, err = currentVerificationCheckpoint(f.ctx, f.client)
	require.NoError(t, err)
}

func observationStoreContents(t *testing.T, store storetypes.KVStore) map[string][]byte {
	t.Helper()
	values := make(map[string][]byte)
	iterator := store.Iterator(nil, nil)
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		values[string(iterator.Key())] = bytes.Clone(iterator.Value())
	}
	return values
}

func TestNativeReceiptsIgnoreDifferentTemporaryTails(t *testing.T) {
	fixture := makeNativeBoundaryFixtureAtHeightAndFork(t, false, 0, 966, 1005)
	earlier := *fixture.Header
	earlier.AnchorBlock = earlier.BridgeBlocks[len(earlier.BridgeBlocks)-1]
	earlier.BridgeBlocks = earlier.BridgeBlocks[:len(earlier.BridgeBlocks)-1]
	earlier.DescendantBlocks = append([]*ProbabilisticBlock{fixture.Header.AnchorBlock}, fixture.Header.DescendantBlocks...)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{Time: time.Unix(0, int64(fixture.Fork.DescendantBlocks[len(fixture.Fork.DescendantBlocks)-1].Timestamp)).Add(time.Hour), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	client, _, err := initializeTrusted(t, ctx, cdc, private, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	receipts := [][]byte{}
	for _, header := range []*ProbabilisticHeader{&earlier, fixture.Fork} {
		plan, err := BuildObservationPlan(client, header, nil, 13, 4)
		require.NoError(t, err)
		for _, step := range plan.Steps {
			runObservationStep(t, ctx, cdc, private, client, step)
		}
		session, err := loadObservationSession(shared, client, plan.SessionID[:])
		require.NoError(t, err)
		receipts = append(receipts, session.Receipt)
	}
	evidence := &Misbehaviour{VerifiedObservation_1: receipts[0], VerifiedObservation_2: receipts[1]}
	require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, private, evidence), ErrIBCInvalidMisbehaviour)
	require.False(t, client.CheckForMisbehaviour(ctx, cdc, private, evidence))
	require.Equal(t, fixture.Client.LatestCheckpointHeight, client.LatestCheckpointHeight)
}
