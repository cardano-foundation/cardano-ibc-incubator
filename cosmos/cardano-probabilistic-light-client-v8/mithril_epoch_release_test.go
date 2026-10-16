package probabilistic

import (
	"encoding/json"
	"math/rand"
	"strings"
	"testing"
	"time"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/cosmos/cosmos-sdk/client/flags"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"github.com/cosmos/ibc-go/v8/testing/simapp"
	"github.com/stretchr/testify/require"
)

// A certificate received three hours into a pending epoch must release the
// stake wait only after commitment. Contradictions still take the keeper's
// freeze path, and a host interruption cannot add a challenge wait to certified stake.
func TestAppLateMithrilCertificateReleasesPendingEpoch(t *testing.T) {
	const chainID = "mithril-release-1"
	const clientID = ModuleName + "-0"
	history := idleCheckpointHistory(t)
	history.Client.TrustingPeriod = 96 * time.Hour
	header := idleCheckpointSourceHeader(t, history, "honest", 966, 984, true)
	header.IsCheckpoint = false
	header.NewEpochContext = idleCheckpointSourceHeader(t, history, "honest", 966, 1001, true).NewEpochContext
	start := time.Unix(0, int64(header.DescendantBlocks[len(header.DescendantBlocks)-1].Timestamp))
	ms := store.NewCommitMultiStore(dbm.NewMemDB(), log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey("prepared-mithril-client")
	ms.MountStoreWithDB(key, storetypes.StoreTypeIAVL, nil)
	ms.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
	require.NoError(t, ms.LoadLatestVersion())
	ctx := withTestHostProgress(sdk.NewContext(ms, cmtproto.Header{ChainID: chainID, Height: 100, Time: start}, false, log.NewNopLogger()))
	cdc := newProbabilisticTestCodec()
	private := ctx.KVStore(key)
	client, _, err := initializeTrusted(t, ctx, cdc, private, history.Client, history.Consensus)
	require.NoError(t, err)
	ctx = ctx.WithBlockTime(start.Add(12*time.Hour + time.Second))
	steps, id, err := BuildObservationPlan(client, header, nil, uint64(len(history.Client.EpochStakeDistribution)), 4)
	require.NoError(t, err)
	for _, step := range steps {
		require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, step))
		client.UpdateState(ctx, cdc, private, step)
	}
	activation := &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: id, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}}
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, activation))
	require.Empty(t, client.UpdateState(ctx, cdc, private, activation))
	activation.ObservationChunk.Sequence++
	originalDeadline := client.epochChallenge(8).UsableAfterUnixNs
	privatePages, sharedPages := recoveryStoreSnapshot(t, private), recoveryStoreSnapshot(t, ctx.KVStore(SharedStoreKey))
	entries := make([]mithril.StakeEntry, 0, len(header.NewEpochContext.StakeDistribution))
	for _, row := range header.NewEpochContext.StakeDistribution {
		entries = append(entries, mithril.StakeEntry{PoolID: row.PoolId, Stake: row.Stake})
	}
	root, err := mithril.StakeDistributionRoot(entries)
	require.NoError(t, err)
	for _, scenario := range []string{"matching", "contradicting", "invalid signature", "host interruption", "certificate after host interruption"} {
		t.Run(scenario, func(t *testing.T) {
			now := ctx.BlockTime().Add(3 * time.Hour)
			app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir()}, baseapp.SetChainID(chainID))
			registerCapacityClient(app)
			app.MountStores(SharedStoreKey)
			t.Cleanup(func() { require.NoError(t, app.Close()) })
			app.SetInitChainer(func(current sdk.Context, request *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
				response, err := app.InitChainer(current, request)
				if err != nil {
					return response, err
				}
				params := app.IBCKeeper.ClientKeeper.GetParams(current)
				params.AllowedClients = append(params.AllowedClients, ModuleName)
				app.IBCKeeper.ClientKeeper.SetParams(current, params)
				for key, value := range privatePages {
					app.IBCKeeper.ClientKeeper.ClientStore(current, clientID).Set([]byte(key), value)
				}
				for key, value := range sharedPages {
					current.KVStore(SharedStoreKey).Set([]byte(key), value)
				}
				seedAcceptanceHostProgress(current, app.GetKey(exported.StoreKey))
				return response, nil
			})
			require.NoError(t, app.LoadLatestVersion())
			signer := secp256k1.GenPrivKey()
			address := sdk.AccAddress(signer.PubKey().Address())
			validator := cmttypes.NewMockPV()
			public, err := validator.GetPubKey()
			require.NoError(t, err)
			validators := cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(public, 1)})
			genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), validators, []authtypes.GenesisAccount{authtypes.NewBaseAccount(address, signer.PubKey(), 0, 0)}, banktypes.Balance{Address: address.String(), Coins: sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(100_000_000_000_000)))})
			require.NoError(t, err)
			encoded, err := json.Marshal(genesis)
			require.NoError(t, err)
			_, err = app.InitChain(&abci.RequestInitChain{ChainId: chainID, Time: now, ConsensusParams: simtestutil.DefaultConsensusParams, AppStateBytes: encoded})
			require.NoError(t, err)
			current := func() sdk.Context {
				return app.NewUncachedContext(false, cmtproto.Header{ChainID: chainID, Height: app.LastBlockHeight(), Time: now}).WithValue(hostProgressContextKey{}, hostProgressProvider(func(current sdk.Context) *state.HostProgress {
					return decodeHostProgress(current.KVStore(SharedStoreKey).Get(hostProgressKey))
				}))
			}
			installed := func() *ClientState {
				result, found := getClientState(app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec())
				require.True(t, found)
				return result
			}
			commit := func(gap time.Duration, txs ...[]byte) *abci.ResponseFinalizeBlock {
				now = now.Add(gap)
				response, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: app.LastBlockHeight() + 1, Time: now, NextValidatorsHash: validators.Hash(), Txs: txs})
				require.NoError(t, err)
				_, err = app.Commit()
				require.NoError(t, err)
				return response
			}
			sign := func(messages ...exported.ClientMessage) []byte {
				t.Helper()
				account := app.AccountKeeper.GetAccount(current(), address)
				var msgs []sdk.Msg
				for _, message := range messages {
					msg, err := clienttypes.NewMsgUpdateClient(clientID, message, address.String())
					require.NoError(t, err)
					msgs = append(msgs, msg)
				}
				tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), app.TxConfig(), msgs, sdk.NewCoins(), state.MaxOperationGas, chainID, []uint64{account.GetAccountNumber()}, []uint64{account.GetSequence()}, signer)
				require.NoError(t, err)
				wire, err := app.TxConfig().TxEncoder()(tx)
				require.NoError(t, err)
				return wire
			}
			commit(time.Second)
			network, stakeRoot := bootstrapNetwork, root
			if scenario == "contradicting" {
				stakeRoot = strings.Repeat("ab", 32)
			}
			if scenario == "invalid signature" {
				network, err = mithriltest.NewNetwork(100, 200, 300)
				require.NoError(t, err)
			}
			certificate, err := network.StakeCertificate(client.MithrilEpoch, network, stakeRoot)
			require.NoError(t, err)
			certificates := &MithrilStakeCertificates{Certificates: []string{certificate}}
			if scenario == "matching" {
				// A certificate and activation in the same transaction cannot use the
				// certificate before it has committed. Both message effects roll back.
				response := commit(time.Second, sign(certificates, activation))
				require.NotZero(t, response.TxResults[0].Code)
				require.Contains(t, response.TxResults[0].Log, "pending")
				require.Equal(t, originalDeadline, installed().epochChallenge(8).UsableAfterUnixNs)
				require.Equal(t, client.MithrilEpoch, installed().MithrilEpoch)
			}
			wire := sign(certificates)
			if scenario == "matching" || scenario == "contradicting" {
				checked, err := app.CheckTx(&abci.RequestCheckTx{Tx: wire, Type: abci.CheckTxType_New})
				require.NoError(t, err)
				require.Zero(t, checked.Code, checked.Log)
				require.Equal(t, originalDeadline, installed().epochChallenge(8).UsableAfterUnixNs, "admission is not commitment")
				commit(time.Second)
				checked, err = app.CheckTx(&abci.RequestCheckTx{Tx: wire, Type: abci.CheckTxType_Recheck})
				require.NoError(t, err)
				require.Zero(t, checked.Code, checked.Log)
				require.Equal(t, originalDeadline, installed().epochChallenge(8).UsableAfterUnixNs)
			}
			certificateGap := time.Second
			if scenario == "certificate after host interruption" {
				certificateGap = 10 * time.Hour
			}
			result := commit(certificateGap, wire).TxResults[0]
			if scenario == "invalid signature" {
				require.NotZero(t, result.Code)
				require.Equal(t, originalDeadline, installed().epochChallenge(8).UsableAfterUnixNs)
				require.Equal(t, exported.Active, installed().Status(current(), app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec()))
				return
			}
			require.Zero(t, result.Code, result.Log)
			if scenario == "contradicting" {
				require.Equal(t, exported.Frozen, installed().Status(current(), app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec()))
				require.Equal(t, originalDeadline, installed().epochChallenge(8).UsableAfterUnixNs)
				result = commit(time.Second, sign(activation)).TxResults[0]
				require.NotZero(t, result.Code)
				require.Contains(t, result.Log, "Frozen")
				return
			}
			certifiedAt := now
			require.Equal(t, uint64(certifiedAt.UnixNano()), installed().epochChallenge(8).UsableAfterUnixNs)
			if scenario == "certificate after host interruption" {
				require.Greater(t, uint64(now.UnixNano()), originalDeadline, "a certificate releases a paused challenge even after its original wall deadline")
			} else {
				require.Less(t, uint64(now.UnixNano()), originalDeadline)
			}
			gap := time.Second
			if scenario == "host interruption" {
				gap = state.HostBlockGapTolerance + time.Second
			}
			result = commit(gap, sign(activation)).TxResults[0]
			require.NotZero(t, result.Code)
			require.Contains(t, result.Log, "committed block")
			result = commit(time.Second, sign(activation)).TxResults[0]
			require.Zero(t, result.Code, result.Log)
			require.Equal(t, uint64(984), installed().LatestHeight.RevisionHeight)
			_, found := GetConsensusState(app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec(), NewHeight(0, 984))
			require.True(t, found)
			require.NoError(t, installed().verifyEpochUsable(current(), 8))
			// A later halt cannot re-lock either the certified allocation or
			// the retained old proof root's already trusted epoch.
			commit(time.Hour)
			require.NoError(t, installed().verifyEpochUsable(current(), 8))
			require.NoError(t, installed().verifyEpochUsable(current(), 7))
			require.Equal(t, exported.Active, installed().Status(current(), app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec()))
		})
	}
}
