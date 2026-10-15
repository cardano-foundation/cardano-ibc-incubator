package probabilistic

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
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

func TestSignedPartialStakeUploadCannotPoisonAnotherSubmitter(t *testing.T) {
	history := idleCheckpointHistory(t)
	history.Client.TrustingPeriod = 96 * time.Hour
	header := idleCheckpointSourceHeader(t, history, "honest", 966, 1001, true)
	testSignedStagedUpload(t, history.Client, history.Consensus, header, history.Bad.Blocks, false)
}

func TestSignedMaximumObservationPreservesActivationBudget(t *testing.T) {
	fixture := capacityEvidence(t, "limit")
	fixture.Client.TrustingPeriod = 96 * time.Hour
	require.Len(t, fixture.Client.EpochStakeDistribution, state.MaxStakeEntries)
	require.Len(t, fixture.Header.NewEpochContext.StakeDistribution, state.MaxStakeEntries)
	require.Len(t, fixture.Header.BridgeBlocks, state.MaxBridgeBlocks)
	require.Len(t, fixture.Header.DescendantBlocks, state.MaxHeaderBlocks-state.MaxBridgeBlocks-1)
	conflicting := append(append([]*ProbabilisticBlock{}, fixture.Fork.BridgeBlocks...), fixture.Fork.AnchorBlock)
	testSignedStagedUpload(t, fixture.Client, fixture.Consensus, fixture.Header, conflicting, true)
}

func testSignedStagedUpload(t *testing.T, initial *ClientState, consensus *ConsensusState, header *ProbabilisticHeader, conflicting []*ProbabilisticBlock, activate bool) {
	t.Helper()
	now := time.Unix(0, int64(header.DescendantBlocks[len(header.DescendantBlocks)-1].Timestamp))
	const chainID = "staged-safety-1"
	const clientID = ModuleName + "-0"
	keys := []*secp256k1.PrivKey{secp256k1.GenPrivKey(), secp256k1.GenPrivKey()}
	require.NotEqual(t, keys[0].PubKey().Address(), keys[1].PubKey().Address())
	app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false,
		simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir()}, baseapp.SetChainID(chainID))
	app.MountKVStores(map[string]*storetypes.KVStoreKey{ModuleName: SharedStoreKey})
	registerCapacityClient(app)
	t.Cleanup(func() { require.NoError(t, app.Close()) })
	app.SetInitChainer(func(ctx sdk.Context, request *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
		response, err := app.InitChainer(ctx, request)
		if err != nil {
			return response, err
		}
		params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
		params.AllowedClients = append(params.AllowedClients, ModuleName)
		app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
		seedAcceptanceHostProgress(ctx, app.GetKey("ibc"))
		_, _, err = initializeTrusted(t, ctx.WithBlockTime(now.Add(-13*time.Hour)), app.AppCodec(),
			app.IBCKeeper.ClientKeeper.ClientStore(ctx, clientID), initial, consensus)
		return response, err
	})
	require.NoError(t, app.LoadLatestVersion())
	validator := cmttypes.NewMockPV()
	public, err := validator.GetPubKey()
	require.NoError(t, err)
	validators := cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(public, 1)})
	var accounts []authtypes.GenesisAccount
	var balances []banktypes.Balance
	for _, key := range keys {
		address := sdk.AccAddress(key.PubKey().Address())
		accounts = append(accounts, authtypes.NewBaseAccount(address, key.PubKey(), 0, 0))
		balances = append(balances, banktypes.Balance{Address: address.String(), Coins: sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(100_000_000_000_000)))})
	}
	genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), validators, accounts, balances...)
	require.NoError(t, err)
	encoded, err := json.Marshal(genesis)
	require.NoError(t, err)
	_, err = app.InitChain(&abci.RequestInitChain{ChainId: chainID, Time: now, ConsensusParams: simtestutil.DefaultConsensusParams, AppStateBytes: encoded})
	require.NoError(t, err)
	_, err = app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: 1, Time: now, NextValidatorsHash: validators.Hash()})
	require.NoError(t, err)
	_, err = app.Commit()
	require.NoError(t, err)
	context := func() sdk.Context {
		return app.NewContextLegacy(true, cmtproto.Header{ChainID: chainID, Height: app.LastBlockHeight(), Time: now})
	}
	clientStore := func() storetypes.KVStore { return app.IBCKeeper.ClientKeeper.ClientStore(context(), clientID) }
	client, found := getClientState(clientStore(), app.AppCodec())
	require.True(t, found)
	steps, sessionID, err := BuildObservationPlan(client, header, nil, uint64(len(initial.EpochStakeDistribution)), 4)
	require.NoError(t, err)
	send := func(step *ProbabilisticHeader, signer int, wantError string) {
		t.Helper()
		key := keys[signer]
		address := sdk.AccAddress(key.PubKey().Address())
		account := app.AccountKeeper.GetAccount(context(), address)
		message, err := clienttypes.NewMsgUpdateClient(clientID, step, address.String())
		require.NoError(t, err)
		tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), app.TxConfig(), []sdk.Msg{message}, sdk.NewCoins(), state.MaxOperationGas, chainID,
			[]uint64{account.GetAccountNumber()}, []uint64{account.GetSequence()}, key)
		require.NoError(t, err)
		wire, err := app.TxConfig().TxEncoder()(tx)
		require.NoError(t, err)
		now = now.Add(state.SupportedInclusionTimePerStep)
		response, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: app.LastBlockHeight() + 1, Time: now, NextValidatorsHash: validators.Hash(), Txs: [][]byte{wire}})
		require.NoError(t, err)
		require.Len(t, response.TxResults, 1)
		if wantError == "" {
			require.Zero(t, response.TxResults[0].Code, response.TxResults[0].Log)
		} else {
			require.NotZero(t, response.TxResults[0].Code)
			require.Contains(t, response.TxResults[0].Log, wantError)
		}
		_, err = app.Commit()
		require.NoError(t, err)
	}
	send(steps[0], 0, "")
	first := steps[1].ObservationChunk
	require.Equal(t, uint32(state.ObservationAppendStake), first.Operation)
	require.Greater(t, len(first.StakeRows), 36)
	// This is a proper prefix, so the old final-table check never ran.
	var suffix [32]byte
	copy(suffix[:], first.EvidenceDigest)
	for offset := len(first.StakeRows) - 36; offset >= 36; offset -= 36 {
		suffix = sha256.Sum256(append(suffix[:], first.StakeRows[offset:offset+36]...))
	}
	partial := *first
	partial.StakeRows = bytes.Clone(first.StakeRows[:36])
	partial.EvidenceDigest = bytes.Clone(suffix[:])
	bad := partial
	bad.StakeRows = bytes.Clone(partial.StakeRows)
	binary.BigEndian.PutUint64(bad.StakeRows[28:], binary.BigEndian.Uint64(bad.StakeRows[28:])+1)
	privateBefore := recoveryStoreSnapshot(t, clientStore())
	sharedBefore := recoveryStoreSnapshot(t, context().KVStore(SharedStoreKey))
	send(&ProbabilisticHeader{ObservationChunk: &bad}, 1, "committed transcript")
	require.Equal(t, privateBefore, recoveryStoreSnapshot(t, clientStore()))
	require.Equal(t, sharedBefore, recoveryStoreSnapshot(t, context().KVStore(SharedStoreKey)))
	send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationDiscard, SessionId: sessionID, Sequence: 1}}, 1, "live observation")
	require.Equal(t, sharedBefore, recoveryStoreSnapshot(t, context().KVStore(SharedStoreKey)))
	// Even an authentic one-row prefix must not multiply the table's step count.
	send(&ProbabilisticHeader{ObservationChunk: &partial}, 1, "stake row batch must contain")
	require.Equal(t, privateBefore, recoveryStoreSnapshot(t, clientStore()))
	require.Equal(t, sharedBefore, recoveryStoreSnapshot(t, context().KVStore(SharedStoreKey)))
	send(steps[1], 1, "")
	// Block batching may still vary without exhausting the bounded workload.
	singles, sameID, err := BuildObservationPlan(client, header, nil, uint64(len(initial.EpochStakeDistribution)), 1)
	require.NoError(t, err)
	require.Equal(t, sessionID, sameID)
	blockSuffixes := map[uint64][]byte{}
	for _, step := range singles {
		if blocks := step.ObservationChunk.Blocks; len(blocks) == 1 {
			blockSuffixes[blocks[0].Height.RevisionHeight] = step.ObservationChunk.EvidenceDigest
		}
	}
	sequence := first.Sequence
	checkedFork, splitBlocks := false, false
	for _, step := range steps[2:] {
		chunk := *step.ObservationChunk
		chunk.Sequence = sequence + 1
		if !checkedFork && len(chunk.Blocks) != 0 && chunk.Blocks[0].Height.RevisionHeight <= 980 && chunk.Blocks[len(chunk.Blocks)-1].Height.RevisionHeight >= 980 {
			fork := chunk
			fork.Blocks = append([]*ProbabilisticBlock(nil), chunk.Blocks...)
			for i, block := range fork.Blocks {
				for _, alternative := range conflicting {
					if block.Height.RevisionHeight == alternative.Height.RevisionHeight {
						fork.Blocks[i] = alternative
					}
				}
			}
			privateBefore = recoveryStoreSnapshot(t, clientStore())
			sharedBefore = recoveryStoreSnapshot(t, context().KVStore(SharedStoreKey))
			send(&ProbabilisticHeader{ObservationChunk: &fork}, 1, "committed transcript")
			require.Equal(t, privateBefore, recoveryStoreSnapshot(t, clientStore()))
			require.Equal(t, sharedBefore, recoveryStoreSnapshot(t, context().KVStore(SharedStoreKey)))
			checkedFork = true
		}
		if !splitBlocks && len(chunk.Blocks) > 1 {
			prefix := chunk
			prefix.Blocks = chunk.Blocks[:1]
			prefix.EvidenceDigest = blockSuffixes[prefix.Blocks[0].Height.RevisionHeight]
			send(&ProbabilisticHeader{ObservationChunk: &prefix}, 1, "")
			sequence++
			chunk.Sequence = sequence + 1
			chunk.Blocks = chunk.Blocks[1:]
			splitBlocks = true
		}
		send(&ProbabilisticHeader{ObservationChunk: &chunk}, 0, "")
		sequence++
	}
	require.True(t, splitBlocks)
	require.True(t, checkedFork, "the second signer must also try an independently signed conflicting block prefix")
	client, found = getClientState(clientStore(), app.AppCodec())
	require.True(t, found)
	raw, err := state.QueryVerification(coreContext(context()), coreCodec{app.AppCodec()}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: sessionID})
	require.NoError(t, err)
	var session struct {
		Complete bool
		RowsRead uint32
		Receipt  []byte
		Sequence uint32
	}
	require.NoError(t, json.Unmarshal(raw, &session))
	require.True(t, session.Complete)
	require.Equal(t, steps[0].ObservationChunk.TableRows, session.RowsRead)
	require.Len(t, session.Receipt, 32)
	require.Equal(t, sequence, session.Sequence)
	querySession := func() []byte {
		t.Helper()
		raw, err := state.QueryVerification(coreContext(context()), coreCodec{app.AppCodec()}, &state.QueryVerificationRequest{Namespace: client.StorageNamespace, Generation: client.VerificationGeneration, Kind: 8, SessionId: sessionID})
		require.NoError(t, err)
		return raw
	}
	assertNoProgress := func() {
		t.Helper()
		before := querySession()
		for _, attempt := range []struct {
			operation uint32
			errorText string
		}{
			{state.ObservationComplete, "already complete"},
			{state.ObservationAdvanceCredit, "already completed"},
			{state.ObservationContinueBody, "no authenticated body"},
		} {
			for retry := 0; retry < 3; retry++ {
				send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: attempt.operation, SessionId: sessionID, Sequence: sequence + 1}}, 1, attempt.errorText)
				require.Equal(t, before, querySession())
			}
		}
	}
	// Retrying the last accepted COMPLETE stays idempotent at its old sequence.
	before := querySession()
	send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationComplete, SessionId: sessionID, Sequence: sequence}}, 1, "")
	require.Equal(t, before, querySession())
	assertNoProgress()
	if !activate {
		return
	}
	base := bytes.Clone(client.CheckpointReference)
	send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: sessionID, Sequence: sequence + 1}}, 0, "")
	sequence++
	client, found = getClientState(clientStore(), app.AppCodec())
	require.True(t, found)
	require.Equal(t, base, client.CheckpointReference)
	deadline := client.EpochContextChallenges[len(client.EpochContextChallenges)-1].UsableAfterUnixNs
	assertNoProgress()
	before = querySession()
	send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: sessionID, Sequence: sequence + 1}}, 1, "epoch context challenge window has not elapsed")
	require.Equal(t, before, querySession())
	// Commit uninterrupted empty blocks so the real host continuity gate elapses.
	for uint64(now.UnixNano()) <= deadline {
		now = now.Add(state.SupportedInclusionTimePerStep)
		_, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: app.LastBlockHeight() + 1, Time: now, NextValidatorsHash: validators.Hash()})
		require.NoError(t, err)
		_, err = app.Commit()
		require.NoError(t, err)
	}
	send(&ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: sessionID, Sequence: sequence + 1}}, 0, "")
	client, found = getClientState(clientStore(), app.AppCodec())
	require.True(t, found)
	require.Equal(t, header.AnchorBlock.Height.RevisionHeight, client.LatestCheckpointHeight.RevisionHeight)
	require.NotEqual(t, base, client.CheckpointReference)
	require.Equal(t, deadline, client.EpochContextChallenges[len(client.EpochContextChallenges)-1].UsableAfterUnixNs)
	require.Less(t, sequence+1, state.MaxObservationSteps)
}

func TestAppFailedStagedRecoveryAllowsAuthorizedRetry(t *testing.T) {
	history := idleCheckpointHistory(t)
	app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir()})
	t.Cleanup(func() { require.NoError(t, app.Close()) })
	registerCapacityClient(app)
	require.NoError(t, app.LoadLatestVersion())
	database := dbm.NewMemDB()
	ms := store.NewCommitMultiStore(database, log.NewNopLogger(), metrics.NewNoOpMetrics())
	for _, key := range app.GetStoreKeys() {
		if persistent, ok := key.(*storetypes.KVStoreKey); ok {
			ms.MountStoreWithDB(persistent, storetypes.StoreTypeIAVL, nil)
		}
	}
	ms.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
	require.NoError(t, ms.LoadLatestVersion())
	ctx := withTestHostProgress(sdk.NewContext(ms, cmtproto.Header{ChainID: "recovery-retry-1", Height: 100, Time: time.Unix(0, int64(history.Consensus.Timestamp)).Add(time.Hour)}, false, log.NewNopLogger()))
	cdc := app.AppCodec()
	app.IBCKeeper.ClientKeeper.SetParams(ctx, clienttypes.NewParams(ModuleName))
	private := func(id string) storetypes.KVStore { return app.IBCKeeper.ClientKeeper.ClientStore(ctx, id) }
	for index, height := range []uint64{10, 20, 30} {
		id := fmt.Sprintf("%s-%d", ModuleName, index)
		client := fromCoreClientState(toCoreClientState(history.Client))
		client.TrustingPeriod = 24 * time.Hour
		client.LatestHeight = NewHeight(0, history.Client.LatestHeight.RevisionHeight+height)
		setTestCheckpoint(t, client, client.LatestHeight, testBlockHash(id), client.CurrentEpoch, history.Client.LatestCheckpointSlot+height)
		client.OperationalCertificateCounterHistoryStartHeight = client.LatestHeight
		client.LatestCheckpointOperationalCertificateCounters = nil
		for row := 0; row < 33; row++ {
			value := uint64(10 + index)
			if index == 1 && row == 32 {
				value = 9
			}
			client.LatestCheckpointOperationalCertificateCounters = append(client.LatestCheckpointOperationalCertificateCounters,
				&OperationalCertificateCounter{PoolId: bytes.Repeat([]byte{byte(row + 1)}, 28), SequenceNumber: value})
		}
		consensus := fromCoreConsensusState(toCoreConsensusState(history.Consensus))
		consensus.AcceptedBlockHash = client.LatestCheckpointBlockHash
		consensus.Timestamp = client.LatestCheckpointTimestamp
		setTestPacketSnapshot(t, consensus, client.LatestHeight.RevisionHeight)
		_, _, err := initializeTrusted(t, ctx, cdc, private(id), client, consensus)
		require.NoError(t, err)
	}
	subjectID, badID, goodID := ModuleName+"-0", ModuleName+"-1", ModuleName+"-2"
	subject, _ := getClientState(private(subjectID), cdc)
	subject.UpdateStateOnMisbehaviour(ctx, cdc, private(subjectID), nil)
	recover := func(signer, substitute string) error {
		message := clienttypes.NewMsgRecoverClient(signer, subjectID, substitute)
		_, err := app.MsgServiceRouter().Handler(message)(ctx, message)
		return err
	}
	maintainer := sdk.AccAddress(bytes.Repeat([]byte{7}, 20)).String()
	server := storageServer{cdc: cdc, provider: app.IBCKeeper.ClientKeeper}
	continueRecovery := func() error {
		_, err := server.ContinueClient(sdk.WrapSDKContext(ctx), &MsgContinueClient{Signer: maintainer, ClientId: subjectID, Operation: state.ObservationContinueRecovery})
		return err
	}
	require.NoError(t, recover(app.IBCKeeper.GetAuthority(), badID))
	require.NoError(t, continueRecovery())
	require.ErrorContains(t, continueRecovery(), "rolls back")
	privateBefore := recoveryStoreSnapshot(t, private(subjectID))
	sharedBefore := recoveryStoreSnapshot(t, ctx.KVStore(SharedStoreKey))
	require.Error(t, recover(maintainer, goodID), "a continuation submitter cannot authorize a different substitute")
	require.Equal(t, privateBefore, recoveryStoreSnapshot(t, private(subjectID)))
	require.Equal(t, sharedBefore, recoveryStoreSnapshot(t, ctx.KVStore(SharedStoreKey)))
	require.NoError(t, recover(app.IBCKeeper.GetAuthority(), goodID))
	subject, _ = getClientState(private(subjectID), cdc)
	require.Equal(t, exported.Frozen, subject.Status(ctx, private(subjectID), cdc))
	require.Equal(t, uint64(1), subject.VerificationGeneration)
	require.NoError(t, continueRecovery())
	require.NoError(t, continueRecovery())
	subject, _ = getClientState(private(subjectID), cdc)
	require.Equal(t, exported.Active, subject.Status(ctx, private(subjectID), cdc))
	require.Equal(t, uint64(2), subject.VerificationGeneration)
	require.Equal(t, history.Client.LatestHeight.RevisionHeight+30, subject.LatestHeight.RevisionHeight)
}
