package probabilistic

import (
	"bytes"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/client/flags"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/cosmos/ibc-go/v10/testing/simapp"
	"github.com/stretchr/testify/require"
)

func TestAppStagedRecoveryRechecksSubstituteInvalidation(t *testing.T) {
	for _, change := range []string{"valid challenge", "forward progress"} {
		t.Run(change, func(t *testing.T) {
			history := idleCheckpointHistory(t)
			history.Client.TrustingPeriod = 96 * time.Hour
			// These retained historical counters force three recovery batches.
			seedCounters := func(client *ClientState, value uint64) {
				for row := 0; row < 65; row++ {
					client.LatestCheckpointOperationalCertificateCounters = append(client.LatestCheckpointOperationalCertificateCounters,
						&OperationalCertificateCounter{PoolId: bytes.Repeat([]byte{byte(row + 1)}, 28), SequenceNumber: value})
				}
			}
			subject := fromCoreClientState(toCoreClientState(history.Client))
			subject.TrustingPeriod = 24 * time.Hour
			seedCounters(subject, 10)
			seedCounters(history.Client, 11)
			app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir()})
			t.Cleanup(func() { require.NoError(t, app.Close()) })
			registerCapacityClient(app)
			require.NoError(t, app.LoadLatestVersion())
			ms := store.NewCommitMultiStore(dbm.NewMemDB(), log.NewNopLogger(), metrics.NewNoOpMetrics())
			for _, key := range app.GetStoreKeys() {
				if persistent, ok := key.(*storetypes.KVStoreKey); ok {
					ms.MountStoreWithDB(persistent, storetypes.StoreTypeIAVL, nil)
				}
			}
			ms.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
			require.NoError(t, ms.LoadLatestVersion())
			ctx := withTestHostProgress(sdk.NewContext(ms, cmtproto.Header{ChainID: "recovery-invalidation-1", Height: 100, Time: time.Unix(0, int64(history.Consensus.Timestamp))}, false, log.NewNopLogger()))
			cdc := app.AppCodec()
			app.IBCKeeper.ClientKeeper.SetParams(ctx, clienttypes.NewParams(ModuleName))
			subjectID, substituteID := ModuleName+"-0", ModuleName+"-1"
			private := func(id string) storetypes.KVStore { return app.IBCKeeper.ClientKeeper.ClientStore(ctx, id) }
			client := func(id string) *ClientState {
				cs, found := getClientState(private(id), cdc)
				require.True(t, found)
				return cs
			}
			_, _, err := InitializeFromTrustedCheckpoint(ctx, cdc, private(subjectID), subject, history.Consensus)
			require.NoError(t, err)
			// This helper authenticates signed canonical and conflicting histories.
			// The challenge disputes B's committed epoch-9 ancestry, not its table.
			challenge, staged := stageSnapshotChallenge(t, ctx, cdc, private(substituteID), substituteID, history)
			ctx = ctx.WithBlockTime(staged)
			payer := sdk.AccAddress(bytes.Repeat([]byte{7}, 20)).String()
			execute := func(message sdk.Msg) error {
				cached, commit := ctx.CacheContext()
				cached = cached.WithGasMeter(storetypes.NewGasMeter(state.MaxOperationGas))
				handler := app.MsgServiceRouter().Handler(message)
				require.NotNil(t, handler)
				_, err := handler(cached, message)
				if err == nil {
					require.Less(t, cached.GasMeter().GasConsumed(), state.MaxOperationGas)
					commit()
				}
				return err
			}
			update := func(message exported.ClientMessage) error {
				msg, err := clienttypes.NewMsgUpdateClient(substituteID, message, payer)
				require.NoError(t, err)
				return execute(msg)
			}
			advance := func(header *ProbabilisticHeader) {
				if timestamp := time.Unix(0, int64(header.DescendantBlocks[len(header.DescendantBlocks)-1].Timestamp)); timestamp.After(ctx.BlockTime()) {
					ctx = ctx.WithBlockTime(timestamp)
				}
				steps, id, err := BuildObservationPlan(client(substituteID), header, nil, 13, 4)
				require.NoError(t, err)
				for _, step := range steps {
					require.NoError(t, update(step))
				}
				require.NoError(t, update(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: id, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}}))
			}
			// Publish a proof-bearing root beyond A's height using the actual
			// signed HostState transaction, then pin that disputed snapshot.
			advance(idleCheckpointHeader(t, history, "honest", 1110, 1125))
			pinned := bytes.Clone(client(substituteID).CheckpointReference)
			require.Equal(t, exported.Expired, client(subjectID).Status(ctx, private(subjectID), cdc))
			require.Equal(t, exported.Active, client(substituteID).Status(ctx, private(substituteID), cdc))
			require.NoError(t, execute(clienttypes.NewMsgRecoverClient(app.IBCKeeper.GetAuthority(), subjectID, substituteID)))
			server := storageServer{cdc: cdc, provider: app.IBCKeeper.ClientKeeper}
			continueRecovery := func() error {
				cached, commit := ctx.CacheContext()
				cached = cached.WithGasMeter(storetypes.NewGasMeter(state.MaxOperationGas))
				_, err := server.ContinueClient(sdk.WrapSDKContext(cached), &MsgContinueClient{Signer: payer, ClientId: subjectID, Operation: state.ObservationContinueRecovery})
				if err == nil {
					commit()
				}
				return err
			}
			for i := 0; i < 2; i++ {
				require.NoError(t, continueRecovery())
				ms.Commit()
			}
			require.Equal(t, exported.Frozen, client(subjectID).Status(ctx, private(subjectID), cdc))
			require.Equal(t, uint64(1), client(subjectID).VerificationGeneration)
			if change == "valid challenge" {
				require.True(t, client(substituteID).CheckForMisbehaviour(ctx, cdc, private(substituteID), challenge))
				require.NoError(t, update(challenge))
				require.Equal(t, exported.Frozen, client(substituteID).Status(ctx, private(substituteID), cdc))
				ms.Commit()
				before := recoveryStoreSnapshot(t, private(subjectID))
				sharedBefore := recoveryStoreSnapshot(t, ctx.KVStore(SharedStoreKey))
				require.ErrorContains(t, continueRecovery(), "substitute is frozen")
				require.Equal(t, before, recoveryStoreSnapshot(t, private(subjectID)))
				require.Equal(t, sharedBefore, recoveryStoreSnapshot(t, ctx.KVStore(SharedStoreKey)))
				require.Equal(t, exported.Frozen, client(subjectID).Status(ctx, private(subjectID), cdc))
				require.Equal(t, uint64(1), client(subjectID).VerificationGeneration)
			} else {
				advance(idleCheckpointSourceHeader(t, history, "honest", 1125, 1126, true))
				require.NotEqual(t, pinned, client(substituteID).CheckpointReference)
				require.Equal(t, uint64(1), client(substituteID).VerificationGeneration)
				require.NoError(t, continueRecovery())
				require.Equal(t, exported.Active, client(subjectID).Status(ctx, private(subjectID), cdc))
				require.Equal(t, uint64(2), client(subjectID).VerificationGeneration)
				require.Equal(t, pinned, client(subjectID).CheckpointReference, "forward progress must not replace the pinned recovery target")
			}
		})
	}
}
