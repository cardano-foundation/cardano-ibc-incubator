package probabilistic

import (
	"encoding/json"
	"math/rand"
	"testing"
	"time"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/cosmos/cosmos-sdk/client/flags"
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/cosmos/cosmos-sdk/server"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/cosmos/ibc-go/v10/testing/simapp"
	"github.com/stretchr/testify/require"
)

// The redundant-relay ante handler calls UpdateState for this client's
// misbehaviour after verifying it, and again on ReCheckTx without verifying it.
// A client's receipt-backed challenge must pass both admissions
// unchanged and freeze the client only when the committed block executes it.
func TestAppAdmitsSnapshotChallengeThroughCheckTx(t *testing.T) {
	const chainID = "compact-challenge-1"
	clientID := ModuleName + "-0"
	history := idleCheckpointHistory(t)
	history.Client.TrustingPeriod = 96 * time.Hour
	key := secp256k1.GenPrivKey()
	account := authtypes.NewBaseAccount(sdk.AccAddress(key.PubKey().Address()), key.PubKey(), 0, 0)

	app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir(), server.FlagInvCheckPeriod: uint(0)}, baseapp.SetChainID(chainID))
	registerCapacityClient(app)
	app.MountStores(SharedStoreKey)
	var challenge *Misbehaviour
	var staged time.Time
	app.SetInitChainer(func(ctx sdk.Context, req *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
		response, err := app.InitChainer(ctx, req)
		if err != nil {
			return response, err
		}
		params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
		params.AllowedClients = append(params.AllowedClients, ModuleName)
		app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
		challenge, staged = stageSnapshotChallenge(t, ctx, app.AppCodec(), app.IBCKeeper.ClientKeeper.ClientStore(ctx, clientID), clientID, history)
		// The first block follows the staged history without a host gap.
		seedAcceptanceHostProgress(ctx.WithBlockTime(staged.Add(time.Second)), app.GetKey(exported.StoreKey))
		return response, nil
	})
	require.NoError(t, app.LoadLatestVersion())
	t.Cleanup(func() { require.NoError(t, app.Close()) })

	privVal := cmttypes.NewMockPV()
	pubKey, err := privVal.GetPubKey()
	require.NoError(t, err)
	genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(pubKey, 1)}), []authtypes.GenesisAccount{account}, banktypes.Balance{Address: account.GetAddress().String(), Coins: sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(100_000_000_000_000)))})
	require.NoError(t, err)
	appState, err := json.Marshal(genesis)
	require.NoError(t, err)
	_, err = app.InitChain(&abci.RequestInitChain{ChainId: chainID, ConsensusParams: simtestutil.DefaultConsensusParams, AppStateBytes: appState, InitialHeight: 1, Time: time.Unix(0, int64(history.Consensus.Timestamp))})
	require.NoError(t, err)
	require.NotNil(t, challenge)

	var committed cmtproto.Header
	commit := func(height int64, txs ...[]byte) *abci.ResponseFinalizeBlock {
		committed = cmtproto.Header{ChainID: chainID, Height: height, Time: staged.Add(time.Duration(height) * time.Second)}
		result, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: height, Time: committed.Time, Txs: txs})
		require.NoError(t, err)
		_, err = app.Commit()
		require.NoError(t, err)
		return result
	}
	status := func() exported.Status {
		ctx := app.NewUncachedContext(false, committed)
		store := app.IBCKeeper.ClientKeeper.ClientStore(ctx, clientID)
		client, found := getClientState(store, app.AppCodec())
		require.True(t, found)
		return client.Status(ctx, store, app.AppCodec())
	}
	commit(1)
	require.Equal(t, exported.Active, status())

	msg, err := clienttypes.NewMsgUpdateClient(clientID, challenge, account.GetAddress().String())
	require.NoError(t, err)
	signed, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), app.TxConfig(), []sdk.Msg{msg}, sdk.NewCoins(), 50_000_000, chainID, []uint64{account.GetAccountNumber()}, []uint64{0}, key)
	require.NoError(t, err)
	tx, err := app.TxConfig().TxEncoder()(signed)
	require.NoError(t, err)

	checked, err := app.CheckTx(&abci.RequestCheckTx{Tx: tx, Type: abci.CheckTxType_New})
	require.NoError(t, err)
	require.Equal(t, uint32(0), checked.Code, checked.Log)
	// The transaction stays in the mempool across a block and is rechecked.
	commit(2)
	require.Equal(t, exported.Active, status(), "admission must not freeze the client")
	rechecked, err := app.CheckTx(&abci.RequestCheckTx{Tx: tx, Type: abci.CheckTxType_Recheck})
	require.NoError(t, err)
	require.Equal(t, uint32(0), rechecked.Code, rechecked.Log)
	require.Equal(t, exported.Active, status(), "recheck must not freeze the client")

	executed := commit(3, tx)
	require.Len(t, executed.TxResults, 1)
	require.Equal(t, uint32(0), executed.TxResults[0].Code, executed.TxResults[0].Log)
	require.Equal(t, exported.Frozen, status())
}

// stageSnapshotChallenge runs the signed idle history through a snapshot client
// in genesis and returns a receipt-backed challenge between the original epoch
// proposal and a conflicting history, with the last staged block time.
func stageSnapshotChallenge(t *testing.T, ctx sdk.Context, cdc codec.BinaryCodec, private storetypes.KVStore, clientID string, history idleCheckpointHistoryData) (*Misbehaviour, time.Time) {
	t.Helper()
	ctx = withTestHostProgress(ctx.WithBlockTime(time.Unix(0, int64(history.Consensus.Timestamp))))
	client, _, err := InitializeFromTrustedCheckpoint(ctx, cdc, private, history.Client, history.Consensus)
	require.NoError(t, err)
	ctx = ctx.WithBlockTime(ctx.BlockTime().Add(12*time.Hour + time.Second))
	reload := func() {
		var found bool
		client, found = getClientState(private, cdc)
		require.True(t, found)
	}
	session := func(id []byte) (sequence uint32, receipt []byte) {
		raw, err := state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: id})
		require.NoError(t, err)
		var value struct {
			Sequence uint32
			Receipt  []byte
		}
		require.NoError(t, json.Unmarshal(raw, &value))
		return value.Sequence, value.Receipt
	}
	apply := func(h *ProbabilisticHeader) {
		if h.ObservationChunk != nil && h.ObservationChunk.Operation == 7 {
			sequence, _ := session(h.ObservationChunk.SessionId)
			h.ObservationChunk.Sequence = sequence + 1
		}
		require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, h))
		client.UpdateState(ctx, cdc, private, h)
		reload()
	}
	stage := func(h *ProbabilisticHeader, original []byte, planner *ClientState) *ObservationChunk {
		steps, id, err := BuildObservationPlan(planner, h, original, 13, 4)
		require.NoError(t, err)
		for _, step := range steps {
			apply(step)
		}
		return &ObservationChunk{Operation: 7, SessionId: id, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}
	}

	var proposal []byte
	trusted := uint64(966)
	for _, anchor := range []uint64{976, 1001, 1063, 1094, 1110} {
		h := idleCheckpointSourceHeader(t, history, "honest", trusted, anchor, true)
		if anchor == 976 {
			h.DescendantBlocks = h.DescendantBlocks[:24]
		}
		if now := time.Unix(0, int64(h.DescendantBlocks[len(h.DescendantBlocks)-1].Timestamp)); now.After(ctx.BlockTime()) {
			ctx = ctx.WithBlockTime(now)
		}
		activation := &ProbabilisticHeader{ObservationChunk: stage(h, nil, client)}
		apply(activation)
		if h.NewEpochContext != nil {
			if anchor == 1094 {
				_, proposal = session(activation.ObservationChunk.SessionId)
			}
			var deadline uint64
			for _, pending := range client.EpochContextChallenges {
				deadline = max(deadline, pending.UsableAfterUnixNs)
			}
			ctx = ctx.WithBlockTime(time.Unix(0, int64(deadline)).Add(time.Second))
			apply(activation)
		}
		trusted = anchor
	}
	require.NotEmpty(t, proposal)

	// Stage the conflicting history from the proposal's own base checkpoint.
	raw, err := state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 9, ReceiptId: proposal})
	require.NoError(t, err)
	var receipt struct{ BaseReference []byte }
	require.NoError(t, json.Unmarshal(raw, &receipt))
	planner := *client
	planner.CheckpointReference = receipt.BaseReference
	planner.CurrentEpoch = 8
	fork := stage(idleCheckpointSourceHeader(t, history, "later", 1063, 1094, true), proposal, &planner)
	_, conflicting := session(fork.SessionId)
	require.NotEmpty(t, conflicting)
	return &Misbehaviour{ClientId: clientID, VerifiedObservation_1: proposal, VerifiedObservation_2: conflicting}, ctx.BlockTime()
}
