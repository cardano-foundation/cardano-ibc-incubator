package probabilistic

import (
	"encoding/json"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	sdk "github.com/cosmos/cosmos-sdk/types"
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/stretchr/testify/require"
)

// The same signed idle history exercises both storage modes through the SDK
// adapter. Worker scheduling and native application execution have separate drivers.
func TestSignedIdleCheckpointLifecycle(t *testing.T) {
	for _, compact := range []bool{false, true} {
		name := "legacy"
		if compact {
			name = "compact"
		}
		t.Run(name, func(t *testing.T) {
			history := idleCheckpointHistory(t)
			history.Client.TrustingPeriod = 96 * time.Hour
			db := dbm.NewMemDB()
			privateKey := storetypes.NewKVStoreKey("idle-client")
			mount := func() storetypes.CommitMultiStore {
				ms := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
				ms.MountStoreWithDB(privateKey, storetypes.StoreTypeIAVL, nil)
				ms.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
				require.NoError(t, ms.LoadLatestVersion())
				return ms
			}
			ms := mount()
			ctx := withTestHostProgress(sdk.NewContext(ms, cmtproto.Header{ChainID: "idle-1", Height: 100, Time: time.Unix(0, int64(history.Consensus.Timestamp))}, false, log.NewNopLogger()))
			private, cdc := ctx.KVStore(privateKey), newProbabilisticTestCodec()
			client := history.Client
			if compact {
				var err error
				client, _, err = EnableSharedSnapshots(ctx, cdc, private, client, history.Consensus)
				require.NoError(t, err)
			} else {
				require.NoError(t, client.Initialize(ctx, cdc, private, history.Consensus))
			}
			ctx = ctx.WithBlockTime(ctx.BlockTime().Add(12*time.Hour + time.Second))
			rootHeight := client.LatestHeight
			rootBefore, found := GetConsensusState(private, cdc, rootHeight)
			require.True(t, found)
			processedBefore, found := GetProcessedTime(private, rootHeight)
			require.True(t, found)
			processedHeightBefore, found := GetProcessedHeight(private, rootHeight)
			require.True(t, found)
			reload := func() {
				var found bool
				client, found = getClientState(private, cdc)
				require.True(t, found)
			}
			apply := func(h *ProbabilisticHeader) {
				if h.ObservationChunk != nil && h.ObservationChunk.Operation == 7 {
					raw, err := state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: h.ObservationChunk.SessionId})
					require.NoError(t, err)
					var session struct{ Sequence uint32 }
					require.NoError(t, json.Unmarshal(raw, &session))
					h.ObservationChunk.Sequence = session.Sequence + 1
				}
				require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, h))
				require.False(t, client.CheckForMisbehaviour(ctx, cdc, private, h))
				client.UpdateState(ctx, cdc, private, h)
				reload()
			}
			var proposal, fork *ProbabilisticHeader
			var originalReceipt []byte
			trusted := uint64(966)
			for _, anchor := range []uint64{976, 1001, 1063, 1094, 1110} {
				h := idleCheckpointSourceHeader(t, history, "honest", trusted, anchor, true)
				if anchor == 976 {
					h.DescendantBlocks = h.DescendantBlocks[:24]
				}
				now := time.Unix(0, int64(h.DescendantBlocks[len(h.DescendantBlocks)-1].Timestamp))
				if now.After(ctx.BlockTime()) {
					ctx = ctx.WithBlockTime(now)
				}
				require.Equal(t, exported.Active, client.Status(ctx, private, cdc))
				before := client.LatestCheckpointTimestamp
				activation := h
				if compact {
					steps, session, err := BuildObservationPlan(client, h, nil, 13, 4)
					require.NoError(t, err)
					for _, step := range steps {
						apply(step)
						require.Equal(t, before, client.LatestCheckpointTimestamp)
					}
					activation = &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: 7, SessionId: session, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}}
				}
				apply(activation)
				if h.NewEpochContext != nil {
					if compact {
						require.Equal(t, before, client.LatestCheckpointTimestamp, "proposal-only processing cannot renew trust")
					}
					var deadline uint64
					for _, challenge := range client.EpochContextChallenges {
						deadline = max(deadline, challenge.UsableAfterUnixNs)
					}
					if anchor == 1094 {
						proposal = h
						fork = idleCheckpointSourceHeader(t, history, "later", trusted, anchor, true)
						if compact {
							raw, err := state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: activation.ObservationChunk.SessionId})
							require.NoError(t, err)
							var session struct{ Receipt []byte }
							require.NoError(t, json.Unmarshal(raw, &session))
							originalReceipt = session.Receipt
						}
					}
					ctx = ctx.WithBlockTime(time.Unix(0, int64(deadline)).Add(time.Second))
					if compact {
						apply(activation)
					}
				}
				require.Equal(t, h.AnchorBlock.Timestamp, client.LatestCheckpointTimestamp)
				require.Equal(t, rootHeight, client.LatestHeight)
				trusted = anchor
			}
			require.Greater(t, ctx.BlockTime().Sub(time.Unix(0, int64(rootBefore.Timestamp))), client.TrustingPeriod)
			require.Equal(t, exported.Active, client.Status(ctx, private, cdc))
			retained, found := GetConsensusState(private, cdc, rootHeight)
			require.True(t, found)
			require.Equal(t, rootBefore, retained)
			timestamp, err := client.GetTimestampAtHeight(ctx, private, cdc, rootHeight)
			require.NoError(t, err)
			require.Equal(t, rootBefore.Timestamp, timestamp)
			processed, _ := GetProcessedTime(private, rootHeight)
			require.Equal(t, processedBefore, processed)
			processedHeight, _ := GetProcessedHeight(private, rootHeight)
			require.Equal(t, processedHeightBefore, processedHeight)
			proof, _ := idleCheckpointProof(t, idleCheckpointLaneValues(t, 1), idleCheckpointCommitmentKey(1))
			key := []byte(idleCheckpointCommitmentKey(1))
			path := commitmenttypes.NewMerklePath([]byte("ibc"), key)
			require.NoError(t, client.VerifyMembership(ctx, private, cdc, rootHeight, 0, 0, proof, path, idleCheckpointLaneValues(t, 1)[idleCheckpointCommitmentKey(1)]))

			// Commit and reopen the IAVL stores before exporting all client metadata.
			ms.Commit()
			ms = mount()
			ctx = ctx.WithMultiStore(ms)
			private = ctx.KVStore(privateKey)
			reload()
			require.Equal(t, exported.Active, client.Status(ctx, private, cdc))
			privateExport := recoveryStoreSnapshot(t, private)
			var sharedExport []byte
			if compact {
				sharedExport, err = state.ExportSnapshotGenesis(ctx.KVStore(SharedStoreKey))
				require.NoError(t, err)
			}
			restoredDB := dbm.NewMemDB()
			restored := store.NewCommitMultiStore(restoredDB, log.NewNopLogger(), metrics.NewNoOpMetrics())
			restored.MountStoreWithDB(privateKey, storetypes.StoreTypeIAVL, nil)
			restored.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
			require.NoError(t, restored.LoadLatestVersion())
			ctx = ctx.WithMultiStore(restored)
			private = ctx.KVStore(privateKey)
			for key, value := range privateExport {
				private.Set([]byte(key), value)
			}
			if compact {
				require.NoError(t, state.ImportSnapshotGenesis(ctx.KVStore(SharedStoreKey), sharedExport))
			}
			reload()
			require.Equal(t, exported.Active, client.Status(ctx, private, cdc))
			require.NoError(t, client.VerifyMembership(ctx, private, cdc, rootHeight, 0, 0, proof, path, idleCheckpointLaneValues(t, 1)[idleCheckpointCommitmentKey(1)]))
			require.Equal(t, privateExport, recoveryStoreSnapshot(t, private))

			// A genuine HostState transaction creates a new proof-bearing height.
			next := idleCheckpointHeader(t, history, "honest", trusted, 1125)
			// Gateway supplies full bodies without an optional transaction hint.
			next.HostStateTxHash = ""
			if timestamp := time.Unix(0, int64(next.DescendantBlocks[len(next.DescendantBlocks)-1].Timestamp)); timestamp.After(ctx.BlockTime()) {
				ctx = ctx.WithBlockTime(timestamp)
			}
			if compact {
				steps, session, err := BuildObservationPlan(client, next, nil, 13, 4)
				require.NoError(t, err)
				for _, step := range steps {
					apply(step)
				}
				apply(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: 7, SessionId: session, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}})
			} else {
				apply(next)
			}
			require.Equal(t, NewHeight(0, 1125), client.LatestHeight)
			proof, _ = idleCheckpointProof(t, idleCheckpointLaneValues(t, 2), idleCheckpointCommitmentKey(2))
			key = []byte(idleCheckpointCommitmentKey(2))
			path = commitmenttypes.NewMerklePath([]byte("ibc"), key)
			require.NoError(t, client.VerifyMembership(ctx, private, cdc, client.LatestHeight, 0, 0, proof, path, idleCheckpointLaneValues(t, 2)[idleCheckpointCommitmentKey(2)]))

			nextCheckpoint := idleCheckpointSourceHeader(t, history, "honest", 1125, 1126, true)
			ordinaryUpdate := nextCheckpoint
			if compact {
				require.Error(t, client.VerifyClientMessage(ctx, cdc, private, nextCheckpoint))
				steps, _, err := BuildObservationPlan(client, nextCheckpoint, nil, 13, 4)
				require.NoError(t, err)
				ordinaryUpdate = steps[0]
			}
			expires := time.Unix(0, int64(client.LatestCheckpointTimestamp)).Add(client.TrustingPeriod)
			require.Equal(t, exported.Active, client.Status(ctx.WithBlockTime(expires.Add(-time.Nanosecond)), private, cdc))
			expiredCtx := ctx.WithBlockTime(expires)
			require.Equal(t, exported.Expired, client.Status(expiredCtx, private, cdc))
			require.ErrorIs(t, client.VerifyClientMessage(expiredCtx, cdc, private, ordinaryUpdate), ErrTrustingPeriodExpired)

			// A valid conflicting history freezes after the original root's lifetime.
			challenge := NewMisbehaviour(ModuleName+"-0", proposal, fork)
			if compact {
				raw, err := state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 9, ReceiptId: originalReceipt})
				require.NoError(t, err)
				var receipt struct{ BaseReference []byte }
				require.NoError(t, json.Unmarshal(raw, &receipt))
				planner := *client
				planner.CheckpointReference = receipt.BaseReference
				planner.CurrentEpoch = 8
				steps, session, err := BuildObservationPlan(&planner, fork, originalReceipt, 13, 4)
				require.NoError(t, err)
				for _, step := range steps {
					apply(step)
				}
				raw, err = state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: session})
				require.NoError(t, err)
				var staged struct{ Receipt []byte }
				require.NoError(t, json.Unmarshal(raw, &staged))
				challenge = &Misbehaviour{ClientId: ModuleName + "-0", VerifiedObservation_1: originalReceipt, VerifiedObservation_2: staged.Receipt}
			}
			require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, challenge))
			require.True(t, client.CheckForMisbehaviour(ctx, cdc, private, challenge))
			client.UpdateStateOnMisbehaviour(ctx, cdc, private, challenge)
			reload()
			require.Equal(t, exported.Frozen, client.Status(ctx, private, cdc))
			before := recoveryStoreSnapshot(t, private)
			require.Error(t, client.VerifyClientMessage(ctx, cdc, private, nextCheckpoint))
			require.Equal(t, before, recoveryStoreSnapshot(t, private))

		})
	}
}
