package probabilistic

import (
	"encoding/json"
	"math/rand"
	"testing"
	"time"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
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
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/cosmos/ibc-go/v10/testing/simapp"
	"github.com/stretchr/testify/require"
)

func TestAppFollowingEpochActivationRequiresCommittedCutoffBlock(t *testing.T) {
	const chainID = "following-epoch-1"
	const clientID = ModuleName + "-0"
	history := idleCheckpointHistory(t)
	history.Client.TrustingPeriod = 96 * time.Hour

	// Prepare native receipts once. Every scenario imports the same pending
	// proposal, then executes signed transactions with the real host hooks.
	ms := store.NewCommitMultiStore(dbm.NewMemDB(), log.NewNopLogger(), metrics.NewNoOpMetrics())
	privateKey := storetypes.NewKVStoreKey("following-epoch-client")
	ms.MountStoreWithDB(privateKey, storetypes.StoreTypeIAVL, nil)
	ms.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
	require.NoError(t, ms.LoadLatestVersion())
	honest := idleCheckpointSourceHeader(t, history, "honest", 966, 984, true)
	bad := idleCheckpointSourceHeader(t, history, "bad", 966, 984, true)
	start := time.Unix(0, int64(max(honest.DescendantBlocks[len(honest.DescendantBlocks)-1].Timestamp, bad.DescendantBlocks[len(bad.DescendantBlocks)-1].Timestamp)))
	ctx := withTestHostProgress(sdk.NewContext(ms, cmtproto.Header{ChainID: chainID, Height: 100, Time: start}, false, log.NewNopLogger()))
	cdc := newProbabilisticTestCodec()
	private := ctx.KVStore(privateKey)
	client, _, err := EnableSharedSnapshots(ctx, cdc, private, history.Client, history.Consensus)
	require.NoError(t, err)
	ctx = ctx.WithBlockTime(start.Add(12*time.Hour + time.Second))
	base := append([]byte(nil), client.CheckpointReference...)
	stage := func(branch string, original []byte) ([]byte, *ProbabilisticHeader) {
		t.Helper()
		header := idleCheckpointSourceHeader(t, history, branch, 966, 984, true)
		// The anchor stays in epoch 7. Its settlement tail requires epoch 8.
		header.IsCheckpoint = false
		header.NewEpochContext = idleCheckpointSourceHeader(t, history, branch, 966, 1001, true).NewEpochContext
		require.Equal(t, uint64(7), header.AnchorBlock.Epoch)
		require.Equal(t, uint64(8), header.DescendantBlocks[len(header.DescendantBlocks)-1].Epoch)
		steps, id, err := BuildObservationPlan(client, header, original, 13, 4)
		require.NoError(t, err)
		for _, step := range steps {
			require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, step))
			client.UpdateState(ctx, cdc, private, step)
		}
		raw, err := state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: id})
		require.NoError(t, err)
		var session struct {
			Sequence uint32
			Receipt  []byte
		}
		require.NoError(t, json.Unmarshal(raw, &session))
		return session.Receipt, &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: id, Sequence: session.Sequence + 1}}
	}
	receipt, activation := stage("honest", nil)
	// Installing the proposal must remain possible before its own deadline.
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, activation))
	require.Empty(t, client.UpdateState(ctx, cdc, private, activation))
	require.Equal(t, base, client.CheckpointReference)
	deadline := client.epochChallenge(8).UsableAfterUnixNs
	require.Greater(t, deadline, uint64(ctx.BlockTime().UnixNano()))
	activation.ObservationChunk.Sequence++
	conflicting, _ := stage("bad", receipt)
	challenge := &Misbehaviour{ClientId: clientID, VerifiedObservation_1: receipt, VerifiedObservation_2: conflicting}
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, challenge))
	privatePages := recoveryStoreSnapshot(t, private)
	sharedPages := recoveryStoreSnapshot(t, ctx.KVStore(SharedStoreKey))

	for _, scenario := range []struct {
		name        string
		previous    time.Duration
		now         time.Duration
		wantPending bool
	}{
		{"at deadline", -time.Nanosecond, 0, true},
		{"first post-deadline block", 0, time.Nanosecond, true},
		{"completed post-deadline block", time.Nanosecond, 2 * time.Nanosecond, false},
		{"host interruption", time.Nanosecond, 11*time.Second + time.Nanosecond, true},
	} {
		for _, order := range []string{"no challenge", "activation first", "challenge first"} {
			t.Run(scenario.name+"/"+order, func(t *testing.T) {
				app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir()}, baseapp.SetChainID(chainID))
				registerCapacityClient(app)
				app.MountStores(SharedStoreKey)
				t.Cleanup(func() { require.NoError(t, app.Close()) })
				previous := time.Unix(0, int64(deadline)).Add(scenario.previous)
				now := time.Unix(0, int64(deadline)).Add(scenario.now)
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
					seedAcceptanceHostProgress(current.WithBlockTime(previous), app.GetKey(exported.StoreKey))
					return response, nil
				})
				require.NoError(t, app.LoadLatestVersion())
				keys := []*secp256k1.PrivKey{secp256k1.GenPrivKey(), secp256k1.GenPrivKey()}
				var accounts []authtypes.GenesisAccount
				var balances []banktypes.Balance
				for _, key := range keys {
					address := sdk.AccAddress(key.PubKey().Address())
					accounts = append(accounts, authtypes.NewBaseAccount(address, key.PubKey(), 0, 0))
					balances = append(balances, banktypes.Balance{Address: address.String(), Coins: sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(100_000_000_000_000)))})
				}
				validator := cmttypes.NewMockPV()
				public, err := validator.GetPubKey()
				require.NoError(t, err)
				validators := cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(public, 1)})
				genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), validators, accounts, balances...)
				require.NoError(t, err)
				encoded, err := json.Marshal(genesis)
				require.NoError(t, err)
				_, err = app.InitChain(&abci.RequestInitChain{ChainId: chainID, Time: previous, ConsensusParams: simtestutil.DefaultConsensusParams, AppStateBytes: encoded})
				require.NoError(t, err)
				commit := func(height int64, at time.Time, txs ...[]byte) *abci.ResponseFinalizeBlock {
					response, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: height, Time: at, NextValidatorsHash: validators.Hash(), Txs: txs})
					require.NoError(t, err)
					_, err = app.Commit()
					require.NoError(t, err)
					return response
				}
				commit(1, previous)
				sign := func(message exported.ClientMessage, signer int) []byte {
					t.Helper()
					address := sdk.AccAddress(keys[signer].PubKey().Address())
					current := app.NewUncachedContext(false, cmtproto.Header{ChainID: chainID, Height: 1, Time: previous})
					account := app.AccountKeeper.GetAccount(current, address)
					msg, err := clienttypes.NewMsgUpdateClient(clientID, message, address.String())
					require.NoError(t, err)
					tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), app.TxConfig(), []sdk.Msg{msg}, sdk.NewCoins(), state.MaxOperationGas, chainID, []uint64{account.GetAccountNumber()}, []uint64{account.GetSequence()}, keys[signer])
					require.NoError(t, err)
					wire, err := app.TxConfig().TxEncoder()(tx)
					require.NoError(t, err)
					return wire
				}
				txs := [][]byte{sign(activation, 0)}
				activationIndex := 0
				if order == "activation first" {
					txs = append(txs, sign(challenge, 1))
				} else if order == "challenge first" {
					txs = append([][]byte{sign(challenge, 1)}, txs...)
					activationIndex = 1
				}
				response := commit(2, now, txs...)
				require.Len(t, response.TxResults, len(txs))
				result := response.TxResults[activationIndex]
				if order == "challenge first" || scenario.wantPending {
					require.NotZero(t, result.Code, result.Log)
					if order == "challenge first" {
						require.Contains(t, result.Log, "status Frozen")
					} else {
						require.Contains(t, result.Log, "pending")
					}
				} else {
					require.Zero(t, result.Code, result.Log)
				}
				current := app.NewUncachedContext(false, cmtproto.Header{ChainID: chainID, Height: 2, Time: now})
				progress := decodeHostProgress(current.KVStore(app.GetKey(exported.StoreKey)).Get(hostProgressKey))
				require.NotNil(t, progress)
				if scenario.name == "host interruption" {
					require.Equal(t, uint64(now.Add(3*time.Minute).UnixNano()), progress.ResumeUsableAfterUnixNs)
				} else {
					require.Equal(t, uint64(1), progress.ResumeUsableAfterUnixNs)
				}
				clientStore := app.IBCKeeper.ClientKeeper.ClientStore(current, clientID)
				updated, found := getClientState(clientStore, app.AppCodec())
				require.True(t, found)
				if result.Code != 0 {
					require.Equal(t, base, updated.CheckpointReference)
					_, found := GetConsensusState(clientStore, app.AppCodec(), NewHeight(0, 984))
					require.False(t, found, "failed activation cannot publish a proof root")
				} else {
					require.Equal(t, uint64(984), updated.LatestHeight.RevisionHeight)
					consensus, found := GetConsensusState(clientStore, app.AppCodec(), updated.LatestHeight)
					require.True(t, found)
					require.Equal(t, uint64(7), consensus.AcceptedEpoch, "the proof epoch cannot recover the following-epoch dependency")
				}
				require.Equal(t, deadline, updated.epochChallenge(8).UsableAfterUnixNs)
				if order != "no challenge" {
					challengeIndex := 1 - activationIndex
					require.Zero(t, response.TxResults[challengeIndex].Code, response.TxResults[challengeIndex].Log)
					require.Equal(t, exported.Frozen, updated.Status(current, clientStore, app.AppCodec()))
				} else if result.Code != 0 {
					require.Equal(t, privatePages, recoveryStoreSnapshot(t, clientStore))
					require.Equal(t, sharedPages, recoveryStoreSnapshot(t, current.KVStore(SharedStoreKey)))
				}
			})
		}
	}
}
