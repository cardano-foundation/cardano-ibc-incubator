package state

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func publishedRetentionFixture(t *testing.T) (*compactExpiryFixture, []byte, []byte, uint64) {
	t.Helper()
	f := newSnapshotExpiryFixture(t)
	f.ctx.Time = f.start.Add(13 * time.Hour)
	first := boundaryHeaderAtAnchor(t, f.evidence.Header, 966, 976)
	first.NewEpochContext = nil
	first.DescendantBlocks = first.DescendantBlocks[:24]
	prefix := f.stage(t, first, nil)
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, prefix))
	base := bytes.Clone(f.client.CheckpointReference)
	f.ctx.Time = f.start.Add(25 * time.Hour)
	header := boundaryHeaderAtAnchor(t, f.evidence.Header, 976, 1001)
	header.IsCheckpoint = false
	plan := f.stage(t, header, nil)
	session, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
	require.NoError(t, err)
	original := bytes.Clone(session.Receipt)
	receipt, err := loadVerifiedObservation(f.shared, f.client, original)
	require.NoError(t, err)
	expires := retentionDeadline(f.client, receipt.VerifiedAt)
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))
	f.ctx.Time = time.Unix(0, int64(f.client.epochChallenge(8).UsableAfterUnixNs)).Add(time.Second)
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))
	require.Equal(t, uint64(1001), f.client.LatestHeight.RevisionHeight)
	return f, original, base, expires
}

func TestRetainedReceiptAuthorizesHistoricalBase(t *testing.T) {
	f, original, base, _ := publishedRetentionFixture(t)
	checkpoint, err := loadVerificationCheckpoint(f.shared, retentionFixtureScope(t, f), base)
	require.NoError(t, err)
	f.ctx.Time = time.Unix(0, int64(retentionDeadline(f.client, checkpoint.Timestamp))).Add(time.Second)
	for i := 0; i < 64; i++ {
		require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
	}
	require.Empty(t, f.shared.Get(retentionKey(f.client, 3, binary.BigEndian.AppendUint64(nil, checkpoint.Height))))
	_, err = loadVerifiedObservation(f.shared, f.client, original)
	require.NoError(t, err, "receipt remains retained after the base index expires")
	_, err = loadVerificationCheckpoint(f.shared, checkpoint.Scope, base)
	require.NoError(t, err, "receipt ownership keeps the base bytes alive")
	request := &QueryVerificationRequest{Namespace: f.client.StorageNamespace, Generation: f.client.VerificationGeneration, Kind: 0, CheckpointReference: base, ReceiptId: original}
	raw, err := QueryVerification(f.ctx, f.cdc, request)
	require.NoError(t, err)
	var metadata verificationMetadata
	require.NoError(t, json.Unmarshal(raw, &metadata))
	require.Equal(t, base, metadata.Reference)
	for kind := uint32(1); kind <= 7; kind++ {
		request.Kind, request.Limit = kind, 128
		_, err = QueryVerification(f.ctx, f.cdc, request)
		require.NoError(t, err, "historical page kind %d", kind)
	}
	request.Kind = 0
	request.CheckpointReference = f.client.CheckpointReference
	_, err = QueryVerification(f.ctx, f.cdc, request)
	require.ErrorContains(t, err, "exact historical base")
	request.CheckpointReference = base
	request.ReceiptId = nil
	_, err = QueryVerification(f.ctx, f.cdc, request)
	require.ErrorContains(t, err, "historical checkpoint is not owned")
	request.ReceiptId = original
	request.Generation++
	_, err = QueryVerification(f.ctx, f.cdc, request)
	require.ErrorContains(t, err, "discarded verification generation")
	// Another client with the same network rules cannot use this receipt.
	other, _, err := initializeTrusted(t, f.ctx, f.cdc, dbadapter.Store{DB: dbm.NewMemDB()}, f.evidence.Client, f.evidence.Consensus)
	require.NoError(t, err)
	request.Namespace, request.Generation = other.StorageNamespace, other.VerificationGeneration
	_, err = QueryVerification(f.ctx, f.cdc, request)
	require.ErrorContains(t, err, "verified observation is missing")
}

func retentionFixtureScope(t *testing.T, f *compactExpiryFixture) [32]byte {
	t.Helper()
	scope, err := verificationScope(f.client)
	require.NoError(t, err)
	return scope
}

func TestAlternativeRetainsEvidenceAcrossCleanupAndRestart(t *testing.T) {
	f, original, base, expires := publishedRetentionFixture(t)
	f.ctx.Time = time.Unix(0, int64(expires)).Add(-time.Nanosecond)
	planner := *f.client
	planner.CheckpointReference = bytes.Clone(base)
	planner.CurrentEpoch = 7
	plan, err := BuildObservationPlan(&planner, boundaryHeaderAtAnchor(t, f.evidence.Fork, 976, 1001), original, 13, 4)
	require.NoError(t, err)
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, plan.Steps[0])
	f.ctx.Time = time.Unix(0, int64(expires)).Add(time.Nanosecond)
	for i := 0; i < 64; i++ {
		require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
	}
	session, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
	require.NoError(t, err)
	require.Less(t, uint64(f.ctx.Time.UnixNano()), session.ExpiresAt)
	require.Equal(t, original, session.OriginalReceipt)
	_, err = loadVerifiedObservation(f.shared, f.client, original)
	require.NoError(t, err, "the active alternative retains its original receipt")
	// Export/import the committed pages and reload the client, as a restarted
	// watcher must do without an in-memory event or a historical height index.
	exported, err := ExportSnapshotGenesis(f.shared)
	require.NoError(t, err)
	restored := dbadapter.Store{DB: dbm.NewMemDB()}
	require.NoError(t, ImportSnapshotGenesis(restored, exported))
	f.shared = restored
	f.ctx.Snapshots = func() (storetypes.KVStore, error) { return f.shared, nil }
	f.client, _ = GetClientState(f.private, f.cdc)
	_, err = QueryVerification(f.ctx, f.cdc, &QueryVerificationRequest{Namespace: f.client.StorageNamespace, Generation: f.client.VerificationGeneration, Kind: 0, CheckpointReference: base, ReceiptId: original})
	require.NoError(t, err)
	page, err := QueryVerification(f.ctx, f.cdc, &QueryVerificationRequest{Namespace: f.client.StorageNamespace, Generation: f.client.VerificationGeneration, Kind: 12, Limit: 128})
	require.NoError(t, err)
	var listed struct{ Records []struct{ ID []byte } }
	require.NoError(t, json.Unmarshal(page, &listed))
	found := false
	for _, record := range listed.Records {
		found = found || bytes.Equal(record.ID, original)
	}
	require.True(t, found, "restart discovers the original after its ordinary retention cutoff")
	for _, step := range plan.Steps[1:] {
		runObservationStep(t, f.ctx, f.cdc, f.private, f.client, step)
	}
	session, err = loadObservationSession(f.shared, f.client, plan.SessionID[:])
	require.NoError(t, err)
	require.True(t, session.Complete)
	alternative, err := loadVerifiedObservation(f.shared, f.client, session.Receipt)
	require.NoError(t, err)
	// Completing verification hands dependency ownership to its receipt. Even
	// cleanup of the expired session cannot race the final challenge transaction.
	f.ctx.Time = time.Unix(0, int64(session.ExpiresAt)).Add(time.Nanosecond)
	for i := 0; i < 64; i++ {
		require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
	}
	conflict, err := f.client.verifiedReceiptConflict(f.ctx, f.private, &Misbehaviour{VerifiedObservation_1: original, VerifiedObservation_2: session.Receipt})
	require.NoError(t, err)
	require.True(t, conflict)
	page, err = QueryVerification(f.ctx, f.cdc, &QueryVerificationRequest{Namespace: f.client.StorageNamespace, Generation: f.client.VerificationGeneration, Kind: 12, Limit: 128})
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(page, &listed))
	for _, record := range listed.Records {
		require.NotEqual(t, session.Receipt, record.ID, "an unaccepted fork cannot be advertised as an original observation")
	}
	f.ctx.Time = time.Unix(0, int64(retentionDeadline(f.client, alternative.VerifiedAt))).Add(time.Nanosecond)
	for i := 0; i < 256; i++ {
		require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
	}
	_, err = loadVerifiedObservation(f.shared, f.client, original)
	require.ErrorContains(t, err, "verified observation is missing")
	_, err = loadVerifiedObservation(f.shared, f.client, session.Receipt)
	require.ErrorContains(t, err, "verified observation is missing")
}
