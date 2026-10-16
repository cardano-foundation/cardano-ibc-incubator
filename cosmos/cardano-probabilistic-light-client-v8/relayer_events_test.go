package probabilistic

import (
	"encoding/hex"
	"encoding/json"
	"math/rand"
	"os"
	"testing"
	"time"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	"cosmossdk.io/store/dbadapter"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
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

// Export committed keeper events for Hermes's production event collector. The
// cross-language CI check regenerates these from signed SDK transactions.
func TestRelayerOperationEvents(t *testing.T) {
	const chainID = "relayer-events-1"
	const clientID = ModuleName + "-0"
	history := idleCheckpointHistory(t)
	history.Client.TrustingPeriod = 96 * time.Hour
	now := time.Unix(0, int64(history.Honest.Blocks[999-967].Timestamp)).Add(time.Second)
	certificate := certifyBootstrap(t, history.Client)
	initial, consensus, bootstrap, err := BuildBootstrap(dbadapter.Store{DB: dbm.NewMemDB()}, history.Client, history.Consensus, certificate)
	require.NoError(t, err)

	key := secp256k1.GenPrivKeyFromSecret([]byte("relayer-operation-events"))
	address := sdk.AccAddress(key.PubKey().Address())
	app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir()}, baseapp.SetChainID(chainID))
	registerCapacityClient(app)
	app.MountStores(SharedStoreKey)
	t.Cleanup(func() { require.NoError(t, app.Close()) })
	app.SetInitChainer(func(ctx sdk.Context, request *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
		response, err := app.InitChainer(ctx, request)
		if err != nil {
			return response, err
		}
		params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
		params.AllowedClients = append(params.AllowedClients, ModuleName)
		app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
		seedAcceptanceHostProgress(ctx, app.GetKey(exported.StoreKey))
		return response, nil
	})
	require.NoError(t, app.LoadLatestVersion())
	validator := cmttypes.NewMockPV()
	public, err := validator.GetPubKey()
	require.NoError(t, err)
	validators := cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(public, 1)})
	genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), validators, []authtypes.GenesisAccount{authtypes.NewBaseAccount(address, key.PubKey(), 0, 0)}, banktypes.Balance{Address: address.String(), Coins: sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(100_000_000_000_000)))})
	require.NoError(t, err)
	encoded, err := json.Marshal(genesis)
	require.NoError(t, err)
	_, err = app.InitChain(&abci.RequestInitChain{ChainId: chainID, Time: now, ConsensusParams: simtestutil.DefaultConsensusParams, AppStateBytes: encoded})
	require.NoError(t, err)
	commit := func(txs ...[]byte) *abci.ResponseFinalizeBlock {
		now = now.Add(time.Second)
		response, err := app.FinalizeBlock(&abci.RequestFinalizeBlock{Height: app.LastBlockHeight() + 1, Time: now, NextValidatorsHash: validators.Hash(), Txs: txs})
		require.NoError(t, err)
		_, err = app.Commit()
		require.NoError(t, err)
		return response
	}
	commit()
	context := func() sdk.Context {
		return app.NewUncachedContext(false, cmtproto.Header{ChainID: chainID, Height: app.LastBlockHeight(), Time: now})
	}
	installed := func() *ClientState {
		client, found := getClientState(app.IBCKeeper.ClientKeeper.ClientStore(context(), clientID), app.AppCodec())
		require.True(t, found)
		return client
	}
	type record struct {
		Name             string       `json:"name"`
		Tx               string       `json:"tx"`
		Height           int64        `json:"height"`
		Events           []abci.Event `json:"events"`
		ConsensusHeights []string     `json:"consensus_heights"`
	}
	var records []record
	send := func(name string, heights []string, messages ...sdk.Msg) {
		t.Helper()
		account := app.AccountKeeper.GetAccount(context(), address)
		tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), app.TxConfig(), messages, sdk.NewCoins(), 50_000_000, chainID, []uint64{account.GetAccountNumber()}, []uint64{account.GetSequence()}, key)
		require.NoError(t, err)
		wire, err := app.TxConfig().TxEncoder()(tx)
		require.NoError(t, err)
		response := commit(wire)
		require.Len(t, response.TxResults, 1)
		result := response.TxResults[0]
		require.Zero(t, result.Code, result.Log)
		if name != "" {
			records = append(records, record{Name: name, Tx: hex.EncodeToString(wire), Height: app.LastBlockHeight(), Events: result.Events, ConsensusHeights: heights})
		}
	}
	update := func(message exported.ClientMessage) sdk.Msg {
		msg, err := clienttypes.NewMsgUpdateClient(clientID, message, address.String())
		require.NoError(t, err)
		return msg
	}
	create, err := clienttypes.NewMsgCreateClient(initial, consensus, address.String())
	require.NoError(t, err)
	send("create", nil, create)
	for index, step := range bootstrap {
		name := ""
		if index == 0 {
			name = "bootstrap-import"
		}
		if index == len(bootstrap)-1 {
			name = "bootstrap-complete"
		}
		send(name, nil, update(step))
	}
	require.False(t, installed().BootstrapPending)
	stage := func(trusted, anchor uint64, checkpoint bool) *ProbabilisticHeader {
		t.Helper()
		header := idleCheckpointSourceHeader(t, history, "honest", trusted, anchor, true)
		header.IsCheckpoint = checkpoint
		steps, id, err := BuildObservationPlan(installed(), header, nil, uint64(len(history.Client.EpochStakeDistribution)), 4)
		require.NoError(t, err)
		for _, step := range steps {
			send("", nil, update(step))
		}
		return &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: id, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}}
	}
	root := stage(966, 967, false)
	send("root-activation", []string{"0-967"}, update(root))
	require.Equal(t, uint64(967), installed().LatestHeight.RevisionHeight)
	send("activation-retry", nil, update(root))
	rootless := stage(967, 968, true)
	send("rootless-activation", nil, update(rootless))
	require.Equal(t, uint64(968), installed().LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, uint64(967), installed().LatestHeight.RevisionHeight)
	entries, err := state.BootstrapStakeTable(toCoreClientState(history.Client))
	require.NoError(t, err)
	stakeRoot, err := mithril.StakeDistributionRoot(entries)
	require.NoError(t, err)
	cert, err := bootstrapNetwork.StakeCertificate(installed().MithrilEpoch, bootstrapNetwork, stakeRoot)
	require.NoError(t, err)
	send("certificate", nil, update(&MithrilStakeCertificates{Certificates: []string{cert}}))
	mixed := stage(968, 969, false)
	cert, err = bootstrapNetwork.StakeCertificate(installed().MithrilEpoch, bootstrapNetwork, stakeRoot)
	require.NoError(t, err)
	send("mixed", []string{"0-969"},
		&banktypes.MsgSend{FromAddress: address.String(), ToAddress: address.String(), Amount: sdk.NewCoins(sdk.NewInt64Coin(sdk.DefaultBondDenom, 1))},
		update(&MithrilStakeCertificates{Certificates: []string{cert}}), update(mixed), update(mixed))
	require.Equal(t, uint64(969), installed().LatestHeight.RevisionHeight)
	if path := os.Getenv("RELAYER_OPERATION_EVENTS"); path != "" {
		raw, err := json.MarshalIndent(records, "", "  ")
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(path, append(raw, '\n'), 0600))
	}
}
