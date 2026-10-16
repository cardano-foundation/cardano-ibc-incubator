package state

import (
	"math"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func TestObservationExpiryPausesAndRemainsBounded(t *testing.T) {
	for _, discard := range []bool{false, true} {
		name := "cleanup"
		if discard {
			name = "discard"
		}
		t.Run(name, func(t *testing.T) {
			f := newSnapshotExpiryFixture(t)
			progress, err := AdvanceHostProgress(f.ctx, nil)
			require.NoError(t, err)
			f.ctx.HostProgress = func(Context) *HostProgress { return progress }
			plan, err := BuildObservationPlan(f.client, f.evidence.Header, nil, 13, 4)
			require.NoError(t, err)
			for _, step := range plan.Steps[:2] {
				runObservationStep(t, f.ctx, f.cdc, f.private, f.client, step)
			}
			session, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
			require.NoError(t, err)
			require.Equal(t, uint64(observationSessionLifetime), session.ExpiresAtObservationTime)
			advance := func(gap time.Duration) {
				f.ctx.Height++
				f.ctx.Time = f.ctx.Time.Add(gap)
				progress, err = AdvanceHostProgress(f.ctx, progress)
				require.NoError(t, err)
			}
			advance(25 * time.Hour)
			require.Greater(t, uint64(f.ctx.Time.UnixNano()), session.ExpiresAt)
			// The fixed budget and snapshot owners survive export and import.
			exported, err := ExportSnapshotGenesis(f.shared)
			require.NoError(t, err)
			f.shared = dbadapter.Store{DB: dbm.NewMemDB()}
			require.NoError(t, ImportSnapshotGenesis(f.shared, exported))
			f.ctx.Snapshots = func() (storetypes.KVStore, error) { return f.shared, nil }
			runObservationStep(t, f.ctx, f.cdc, f.private, f.client, plan.Steps[0])
			runObservationStep(t, f.ctx, f.cdc, f.private, f.client, plan.Steps[1])
			retried, err := loadObservationSession(f.shared, f.client, plan.SessionID[:])
			require.NoError(t, err)
			require.Equal(t, session, retried, "retries cannot renew a session's lifetime")
			for i := 0; i < 8; i++ {
				require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
			}
			_, err = loadObservationSession(f.shared, f.client, plan.SessionID[:])
			require.NoError(t, err, "wall-clock cleanup must preserve the session")
			// Once 24 hours of credited progress elapse, both deletion paths work.
			for i := time.Duration(0); i < observationSessionLifetime; i += HostBlockGapTolerance {
				advance(HostBlockGapTolerance)
			}
			require.ErrorContains(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, plan.Steps[2]), "session has expired")
			if discard {
				runObservationStep(t, f.ctx, f.cdc, f.private, f.client, &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationDiscard, SessionId: plan.SessionID[:], Sequence: session.Sequence + 1}})
			} else {
				for i := 0; i < 8; i++ {
					require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
				}
			}
			require.False(t, f.shared.Has(observationSessionKey(f.client.StorageNamespace, f.client.VerificationGeneration, plan.SessionID[:])))
			require.False(t, f.shared.Has(retentionKey(f.client, RetainSession, plan.SessionID[:])))
		})
	}
}

func TestObservationExpiryRejectsLostClockAndDiscardedGeneration(t *testing.T) {
	for _, change := range []string{"missing clock", "replacement clock", "discarded generation"} {
		t.Run(change, func(t *testing.T) {
			f := newSnapshotExpiryFixture(t)
			plan, err := BuildObservationPlan(f.client, f.evidence.Header, nil, 13, 4)
			require.NoError(t, err)
			runObservationStep(t, f.ctx, f.cdc, f.private, f.client, plan.Steps[0])
			sessionKey := observationSessionKey(f.client.StorageNamespace, f.client.VerificationGeneration, plan.SessionID[:])
			f.ctx.HostProgress = nil
			switch change {
			case "missing clock":
				before := observationStoreContents(t, f.shared)
				require.ErrorContains(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, plan.Steps[1]), "continuity tracking is missing")
				require.ErrorContains(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup), "continuity tracking is missing")
				require.Equal(t, before, observationStoreContents(t, f.shared))
				return
			case "replacement clock":
				f.ctx.HostProgress = func(ctx Context) *HostProgress {
					p := testHostProgress(ctx)
					p.ClockID++
					return p
				}
				require.ErrorContains(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, plan.Steps[1]), "session has expired")
			case "discarded generation":
				f.client.VerificationGeneration++
				require.ErrorContains(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, plan.Steps[1]), "session is missing")
			}
			for i := 0; i < 8; i++ {
				require.NoError(t, f.client.ContinueMaintenance(f.ctx, f.cdc, f.private, ObservationCleanup))
			}
			require.False(t, f.shared.Has(sessionKey))
		})
	}
}

func TestObservationExpiryChecksClockOverflow(t *testing.T) {
	f := newSnapshotExpiryFixture(t)
	f.ctx.HostProgress = func(ctx Context) *HostProgress {
		p := testHostProgress(ctx)
		p.ObservationTime = math.MaxUint64 - uint64(observationSessionLifetime) + 1
		return p
	}
	plan, err := BuildObservationPlan(f.client, f.evidence.Header, nil, 13, 4)
	require.NoError(t, err)
	before := observationStoreContents(t, f.shared)
	require.ErrorContains(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, plan.Steps[0]), "expiry overflows")
	require.Equal(t, before, observationStoreContents(t, f.shared))
}
