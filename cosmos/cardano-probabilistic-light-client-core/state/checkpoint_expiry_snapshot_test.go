package state

import (
	"bytes"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

type compactExpiryFixture struct {
	ctx             Context
	cdc             StateCodec
	private, shared storetypes.KVStore
	client          *ClientState
	evidence        nativeBoundaryFixture
	start           time.Time
}

func newSnapshotExpiryFixture(t *testing.T) *compactExpiryFixture {
	t.Helper()
	evidence := savedNativeBoundary(t, "control")
	evidence.Client.TrustingPeriod = 48 * time.Hour
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	start := time.Unix(0, int64(evidence.Consensus.Timestamp))
	ctx := Context{Time: start, Height: 100, SelfHeight: NewHostHeight(0, 100), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	client, _, err := initializeTrusted(t, ctx, cdc, private, evidence.Client, evidence.Consensus)
	require.NoError(t, err)
	ctx.HostProgress = testHostProgress
	return &compactExpiryFixture{ctx, cdc, private, shared, client, evidence, start}
}

func (f *compactExpiryFixture) stage(t *testing.T, header *ProbabilisticHeader, original []byte) *ObservationPlan {
	t.Helper()
	planner := *f.client
	if len(original) > 0 {
		receipt, err := loadVerifiedObservation(f.shared, f.client, original)
		require.NoError(t, err)
		base, err := loadVerificationCheckpoint(f.shared, receipt.Scope, receipt.BaseReference)
		require.NoError(t, err)
		planner.CheckpointReference = bytes.Clone(receipt.BaseReference)
		planner.CurrentEpoch = base.Epoch
	}
	plan, err := BuildObservationPlan(&planner, header, original, 13, 4)
	require.NoError(t, err)
	before := f.client.LatestCheckpointTimestamp
	for _, step := range plan.Steps {
		runObservationStep(t, f.ctx, f.cdc, f.private, f.client, step)
		require.Equal(t, before, f.client.LatestCheckpointTimestamp, "uploads and temporary descendants do not renew trust")
	}
	return plan
}

func (f *compactExpiryFixture) activation(t *testing.T, plan *ObservationPlan) *ProbabilisticHeader {
	t.Helper()
	session, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
	require.NoError(t, err)
	return &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationActivate, SessionId: plan.SessionID[:], Sequence: session.Sequence + 1}}
}

func TestSnapshotCheckpointProgressAndHistoricalChallengeAfterOldRootExpiry(t *testing.T) {
	f := newSnapshotExpiryFixture(t)
	root, found := GetConsensusState(f.private, f.cdc, f.client.LatestHeight)
	require.True(t, found)
	oldHeight := f.client.LatestHeight
	oldTime, found := GetProcessedTime(f.private, oldHeight)
	require.True(t, found)
	f.ctx.Time = f.start.Add(13 * time.Hour)
	first := boundaryHeaderAtAnchor(t, f.evidence.Header, 966, 976)
	first.NewEpochContext = nil
	first.DescendantBlocks = first.DescendantBlocks[:24]
	plan := f.stage(t, first, nil)
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))

	f.ctx.Time = f.start.Add(25 * time.Hour)
	next := boundaryHeaderAtAnchor(t, f.evidence.Header, 976, 1001)
	plan = f.stage(t, next, nil)
	before := f.client.LatestCheckpointTimestamp
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))
	require.Equal(t, before, f.client.LatestCheckpointTimestamp, "an epoch proposal does not renew trust")
	session, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
	require.NoError(t, err)
	original := bytes.Clone(session.Receipt)
	// The checkpoint from epoch 7 is still fresh after the proof root expires.
	f.ctx.Time = f.start.Add(48*time.Hour + time.Second)
	require.True(t, f.client.IsExpired(root.Timestamp, f.ctx.Time))
	require.Equal(t, Active, f.client.Status(f.ctx, f.private, f.cdc))
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))
	require.Equal(t, uint64(8), f.client.CurrentEpoch)
	continued := boundaryHeaderAtAnchor(t, f.evidence.Header, 1001, 1007)
	continued.NewEpochContext = nil
	plan = f.stage(t, continued, nil)
	runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))
	require.Equal(t, Active, f.client.Status(f.ctx, f.private, f.cdc))
	retained, found := GetConsensusState(f.private, f.cdc, oldHeight)
	require.True(t, found)
	require.Equal(t, root, retained)
	processed, found := GetProcessedTime(f.private, oldHeight)
	require.True(t, found)
	require.Equal(t, oldTime, processed)
	_, found = GetConsensusState(f.private, f.cdc, f.client.LatestCheckpointHeight)
	require.False(t, found)
	_, err = f.client.GetTimestampAtHeight(f.ctx, f.private, f.cdc, f.client.LatestCheckpointHeight)
	require.ErrorIs(t, err, ErrIBCConsensusStateNotFound)

	fork := boundaryHeaderAtAnchor(t, f.evidence.Fork, 976, 1001)
	otherPlan := f.stage(t, fork, original)
	other, err := loadObservationSession(f.shared, f.client, otherPlan.SessionID[:])
	require.NoError(t, err)
	challenge := &Misbehaviour{VerifiedObservation_1: original, VerifiedObservation_2: other.Receipt}
	require.NoError(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, challenge))
	require.True(t, f.client.CheckForMisbehaviour(f.ctx, f.cdc, f.private, challenge))
	f.client.UpdateStateOnMisbehaviour(f.ctx, f.cdc, f.private, challenge)
	f.client, found = GetClientState(f.private, f.cdc)
	require.True(t, found)
	require.Equal(t, Frozen, f.client.Status(f.ctx, f.private, f.cdc))
	require.ErrorIs(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, f.activation(t, plan)), ErrIBCClientFrozen)
}

func TestSnapshotStagingCannotReservePermissionPastCheckpointExpiry(t *testing.T) {
	f := newSnapshotExpiryFixture(t)
	f.ctx.Time = f.start.Add(47 * time.Hour)
	header := boundaryHeaderAtAnchor(t, f.evidence.Header, 966, 976)
	header.NewEpochContext = nil
	header.DescendantBlocks = header.DescendantBlocks[:24]
	plan := f.stage(t, header, nil)
	activate := f.activation(t, plan)
	f.ctx.Time = f.start.Add(48 * time.Hour)
	require.Equal(t, Expired, f.client.Status(f.ctx, f.private, f.cdc))
	require.ErrorIs(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, activate), ErrTrustingPeriodExpired)
	require.Equal(t, uint64(966), f.client.LatestCheckpointHeight.RevisionHeight)
}

func TestSnapshotProposalResponseWindowMustFitRemainingCheckpointLifetime(t *testing.T) {
	f := newSnapshotExpiryFixture(t)
	f.ctx.Time = f.start.Add(37 * time.Hour)
	plan := f.stage(t, f.evidence.Header, nil)
	require.Equal(t, Active, f.client.Status(f.ctx, f.private, f.cdc))
	before := f.client.LatestCheckpointTimestamp
	err := f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, f.activation(t, plan))
	require.ErrorContains(t, err, "entire response window")
	require.Equal(t, before, f.client.LatestCheckpointTimestamp)
}
