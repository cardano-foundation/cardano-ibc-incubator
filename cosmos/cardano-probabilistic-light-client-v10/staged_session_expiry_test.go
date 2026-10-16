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
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
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
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types/v2"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/cosmos/ibc-go/v10/testing/simapp"
	"github.com/stretchr/testify/require"
)

func TestAppUnfinishedChallengeSurvivesPausedStakeWindow(t *testing.T) {
	const chainID = "paused-challenge-1"
	const clientID = ModuleName + "-0"
	fixture := capacityEvidence(t, "control")
	fixture.Client.TrustingPeriod = 48 * time.Hour
	root, proof, key, value := challengeTestProof(t, true)
	fixture.Consensus.IbcStateRoot = root
	packet, err := probabilisticcore.DecodePacketStateSnapshot(fixture.Consensus.PacketStateSnapshot)
	require.NoError(t, err)
	packet.HostRoot = root
	fixture.Consensus.PacketStateSnapshot, err = probabilisticcore.EncodePacketStateSnapshot(packet)
	require.NoError(t, err)
	proposal := boundaryCheckpointAt(t, fixture.Header, 976, 984)
	proposal.DescendantBlocks = proposal.DescendantBlocks[:24]
	start := time.Unix(0, int64(proposal.DescendantBlocks[len(proposal.DescendantBlocks)-1].Timestamp))
	ms := store.NewCommitMultiStore(dbm.NewMemDB(), log.NewNopLogger(), metrics.NewNoOpMetrics())
	privateKey := storetypes.NewKVStoreKey("prepared-paused-challenge")
	ms.MountStoreWithDB(privateKey, storetypes.StoreTypeIAVL, nil)
	ms.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
	require.NoError(t, ms.LoadLatestVersion())
	ctx := withTestHostProgress(sdk.NewContext(ms, cmtproto.Header{ChainID: chainID, Height: 1, Time: start}, false, log.NewNopLogger()))
	cdc := newProbabilisticTestCodec()
	private := ctx.KVStore(privateKey)
	client, _, err := initializeTrusted(t, ctx.WithBlockTime(start.Add(-7*time.Hour)), cdc, private, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	apply := func(step *ProbabilisticHeader) {
		t.Helper()
		require.NoError(t, client.VerifyClientMessage(ctx, cdc, private, step))
		client.UpdateState(ctx, cdc, private, step)
	}
	var session struct {
		Sequence  uint32
		Receipt   []byte
		ExpiresAt uint64
		RowsRead  uint32
	}
	readSession := func(current sdk.Context, id []byte) {
		t.Helper()
		raw, err := state.QueryVerification(coreContext(current), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: id})
		require.NoError(t, err)
		require.NoError(t, json.Unmarshal(raw, &session))
	}
	stage := func(header *ProbabilisticHeader) *ProbabilisticHeader {
		t.Helper()
		steps, id, err := BuildObservationPlan(client, header, nil, uint64(state.MaxStakeEntries), 4)
		require.NoError(t, err)
		for _, step := range steps {
			apply(step)
		}
		readSession(ctx, id)
		return &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: id, Sequence: session.Sequence + 1}}
	}
	// Retain a fresh epoch-7 proof root before proposing the epoch-8 allocation.
	prefix := boundaryCheckpointAt(t, fixture.Header, 966, 976)
	prefix.NewEpochContext = nil
	prefix.DescendantBlocks = prefix.DescendantBlocks[:24]
	prefix.IsCheckpoint, prefix.HostStateTxHash = false, ""
	apply(stage(prefix))
	usableHeight := client.LatestHeight
	usableRoot, found := GetConsensusState(private, cdc, usableHeight)
	require.True(t, found)
	activation := stage(proposal)
	original := append([]byte(nil), session.Receipt...)
	apply(activation)
	activation.ObservationChunk.Sequence++
	deadline := client.epochChallenge(8).UsableAfterUnixNs
	checkpointTime := client.LatestCheckpointTimestamp

	// Prepare a real signed Cardano alternative with two 4,000-row tables.
	// Snapshot the unfinished upload as it would persist before a host restart.
	ctx = ctx.WithBlockTime(start.Add(30 * time.Minute))
	alternative := boundaryCheckpointAt(t, fixture.Fork, 976, 984)
	alternative.DescendantBlocks = alternative.DescendantBlocks[:24]
	steps, id, err := BuildObservationPlan(client, alternative, original, uint64(state.MaxStakeEntries), 4)
	require.NoError(t, err)
	require.Greater(t, len(steps), 64)
	for _, step := range steps[:5] {
		apply(step)
	}
	readSession(ctx, id)
	savedSequence, savedRows, wallExpiry := session.Sequence, session.RowsRead, session.ExpiresAt
	require.Equal(t, uint32(512), savedRows)
	privatePages, sharedPages := recoveryStoreSnapshot(t, private), recoveryStoreSnapshot(t, ctx.KVStore(SharedStoreKey))
	var windowKey string
	for key := range sharedPages {
		if strings.HasPrefix(key, "snapshots/v2/stakeWindows/") {
			windowKey = key
		}
	}
	require.NotEmpty(t, windowKey)

	now := start.Add(5*time.Hour + 30*time.Minute)
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
	_, err = app.InitChain(&abci.RequestInitChain{ChainId: chainID, Time: now, ConsensusParams: simtestutil.DefaultConsensusParams, AppStateBytes: encoded})
	require.NoError(t, err)
	current := func() sdk.Context {
		return app.NewUncachedContext(false, cmtproto.Header{ChainID: chainID, Height: app.LastBlockHeight(), Time: now})
	}
	installed := func() *ClientState {
		result, found := getClientState(app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec())
		require.True(t, found)
		return result
	}
	commit := func(gap time.Duration, txs ...[]byte) *abci.ResponseFinalizeBlock {
		t.Helper()
		now = now.Add(gap)
		response, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: app.LastBlockHeight() + 1, Time: now, NextValidatorsHash: validators.Hash(), Txs: txs})
		require.NoError(t, err)
		_, err = app.Commit()
		require.NoError(t, err)
		return response
	}
	send := func(message exported.ClientMessage, signer int, wantError string) {
		t.Helper()
		address := sdk.AccAddress(keys[signer].PubKey().Address())
		account := app.AccountKeeper.GetAccount(current(), address)
		msg, err := clienttypes.NewMsgUpdateClient(clientID, message, address.String())
		require.NoError(t, err)
		tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), app.TxConfig(), []sdk.Msg{msg}, sdk.NewCoins(), state.MaxOperationGas, chainID, []uint64{account.GetAccountNumber()}, []uint64{account.GetSequence()}, keys[signer])
		require.NoError(t, err)
		wire, err := app.TxConfig().TxEncoder()(tx)
		require.NoError(t, err)
		response := commit(state.SupportedInclusionTimePerStep, wire)
		require.Len(t, response.TxResults, 1)
		if wantError == "" {
			require.Zero(t, response.TxResults[0].Code, response.TxResults[0].Log)
		} else {
			require.NotZero(t, response.TxResults[0].Code)
			require.Contains(t, response.TxResults[0].Log, wantError)
		}
	}
	commit(0)
	beforeHalt := decodeHostProgress(current().KVStore(SharedStoreKey).Get(hostProgressKey))
	commit(25 * time.Hour)
	require.Greater(t, uint64(now.UnixNano()), wallExpiry)
	require.Equal(t, beforeHalt.ObservationTime, decodeHostProgress(current().KVStore(SharedStoreKey).Get(hostProgressKey)).ObservationTime)
	require.Equal(t, exported.Active, installed().Status(current(), app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec()))
	// Another account cannot discard the saved work after the wall-clock cutoff.
	send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationDiscard, SessionId: id, Sequence: savedSequence + 1}}, 1, "live observation")
	for i := 0; i < 8; i++ {
		send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationCleanup}}, 1, "")
	}
	readSession(current(), id)
	require.Equal(t, savedSequence, session.Sequence)
	require.Equal(t, savedRows, session.RowsRead)
	usable := installed()
	require.NoError(t, usable.verifyEpochUsable(current(), 7))
	retainedRoot, found := GetConsensusState(app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec(), usableHeight)
	require.True(t, found)
	require.Equal(t, usableRoot, retainedRoot)
	path := commitmenttypes.NewMerklePath([]byte("ibc"), key)
	require.NoError(t, usable.VerifyMembership(current(), app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec(), usableHeight, 0, 0, proof, path, value))
	require.ErrorContains(t, usable.verifyEpochUsable(current(), 8), "pending")
	send(activation, 1, "pending")
	// New sessions cannot restart or extend the allocation's own response window.
	arbitrary := *steps[0].ObservationChunk
	arbitrary.IsCheckpoint = !arbitrary.IsCheckpoint
	send(&ProbabilisticHeader{ObservationChunk: &arbitrary}, 1, "")
	for _, step := range steps[5:] {
		send(step, 0, "")
	}
	readSession(current(), id)
	require.Equal(t, deadline, installed().epochChallenge(8).UsableAfterUnixNs)
	require.Equal(t, sharedPages[windowKey], current().KVStore(SharedStoreKey).Get([]byte(windowKey)))
	require.Equal(t, checkpointTime, installed().LatestCheckpointTimestamp)
	progress := decodeHostProgress(current().KVStore(SharedStoreKey).Get(hostProgressKey))
	require.Less(t, progress.ObservationTime, uint64(start.Add(EpochContextChallengePeriod).UnixNano()))
	send(&Misbehaviour{ClientId: clientID, VerifiedObservation_1: original, VerifiedObservation_2: session.Receipt}, 0, "")
	progress = decodeHostProgress(current().KVStore(SharedStoreKey).Get(hostProgressKey))
	require.Less(t, progress.ObservationTime, uint64(start.Add(EpochContextChallengePeriod).UnixNano()), "the freeze must commit before the allocation finishes its response window")
	require.Equal(t, exported.Frozen, installed().Status(current(), app.IBCKeeper.ClientKeeper.ClientStore(current(), clientID), app.AppCodec()))
}
