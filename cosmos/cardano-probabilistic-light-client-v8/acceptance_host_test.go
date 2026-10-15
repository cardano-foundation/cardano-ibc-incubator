package probabilistic

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	storetypes "cosmossdk.io/store/types"
	cmtdb "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtcfg "github.com/cometbft/cometbft/config"
	cmtlog "github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/cometbft/cometbft/proxy"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	cmttypes "github.com/cometbft/cometbft/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/client/flags"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/cosmos/cosmos-sdk/server"
	servercfg "github.com/cosmos/cosmos-sdk/server/config"
	servergrpc "github.com/cosmos/cosmos-sdk/server/grpc"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	slashingtypes "github.com/cosmos/cosmos-sdk/x/slashing/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"

	"github.com/cosmos/ibc-go/v8/testing/simapp"
	"github.com/stretchr/testify/require"
)

const acceptanceChainID = "caribic-v8-1"
const acceptanceSubject = ModuleName + "-0"
const acceptanceControl = ModuleName + "-1"
const acceptanceSubstitute = ModuleName + "-2"

// Public, deterministic local test keys. Never use them on another network.
func acceptanceKey(seed string) *secp256k1.PrivKey {
	return secp256k1.GenPrivKeyFromSecret([]byte("caribic-v8-acceptance/" + seed))
}
func acceptanceAddress(seed string) sdk.AccAddress {
	return sdk.AccAddress(acceptanceKey(seed).PubKey().Address())
}

type acceptanceHostConfig struct{ Root, RPC, P2P, GRPC, History, ConsensusControl string }
type acceptanceHistory struct {
	Client                   *ClientState
	Consensus                *ConsensusState
	Honest, Bad, Tail, Later struct {
		Blocks   []*ProbabilisticBlock
		Contexts []*EpochContext
	}
}

// A separate OS process owns the real v8 application, disk databases, RPC,
// validator key and signing state. Restarting it cannot retain keeper objects.
func TestCaribicAcceptanceHost(t *testing.T) {
	configFile := os.Getenv("CARIBIC_ACCEPTANCE_HOST")
	if configFile == "" {
		t.Skip("launched by Caribic acceptance driver")
	}
	var config acceptanceHostConfig
	acceptanceReadJSON(t, configFile, &config)
	var history acceptanceHistory
	acceptanceReadJSON(t, config.History, &history)
	cfg := cmtcfg.DefaultConfig().SetRoot(config.Root)
	cmtcfg.EnsureRoot(config.Root)
	cfg.RPC.ListenAddress = "tcp://" + config.RPC
	cfg.P2P.ListenAddress = "tcp://" + config.P2P
	cfg.P2P.PexReactor = false
	cfg.Consensus.TimeoutCommit = 200 * time.Millisecond
	cfg.Consensus.TimeoutPropose = time.Second
	if config.ConsensusControl != "" {
		cfg.Consensus.TimeoutPropose = 10 * time.Minute
	}
	cfg.Consensus.CreateEmptyBlocks = true
	profile, err := os.ReadFile("../../chains/cosmos/scripts/setup_profile.sh")
	require.NoError(t, err)
	cfg.Mempool.MaxTxBytes = int(profileInteger(t, string(profile), "MAX_TX_BYTES"))
	cfg.RPC.MaxBodyBytes = profileInteger(t, string(profile), "RPC_MAX_BODY_BYTES")
	appDB, err := dbm.NewGoLevelDB("application", filepath.Join(config.Root, "data"), nil)
	require.NoError(t, err)
	app := simapp.NewSimApp(log.NewNopLogger(), appDB, nil, false, simtestutil.AppOptionsMap{flags.FlagHome: config.Root, server.FlagInvCheckPeriod: uint(0)}, baseapp.SetChainID(acceptanceChainID))
	registerCapacityClient(app)
	app.SetInitChainer(func(ctx sdk.Context, req *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
		response, err := app.InitChainer(ctx, req)
		if err != nil {
			return response, err
		}
		params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
		params.AllowedClients = append(params.AllowedClients, ModuleName)
		app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
		seedAcceptanceHostProgress(ctx, app.GetKey("ibc"))
		// Only the initial checkpoint and connection are trusted test genesis.
		// Channels, packets, later clients, proposals, challenges and recovery all
		// use signed transactions. The historical genesis checkpoint starts with an elapsed response window.
		for _, id := range []string{acceptanceSubject, acceptanceControl} {
			state := fromCoreClientState(toCoreClientState(history.Client))
			store := app.IBCKeeper.ClientKeeper.ClientStore(ctx, id)
			if err := state.Initialize(ctx.WithBlockTime(ctx.BlockTime().Add(-4*time.Minute)), app.AppCodec(), store, history.Consensus); err != nil {
				return response, err
			}

		}
		app.IBCKeeper.ClientKeeper.SetNextClientSequence(ctx, 2)
		app.IBCKeeper.ConnectionKeeper.SetConnection(ctx, "connection-0", connectiontypes.ConnectionEnd{
			ClientId: acceptanceSubject, State: connectiontypes.OPEN, Versions: connectiontypes.GetCompatibleVersions(),
			Counterparty: connectiontypes.Counterparty{ClientId: "07-tendermint-0", ConnectionId: "connection-0", Prefix: commitmenttypes.NewMerklePrefix([]byte("ibc"))},
		})
		// SimApp mounts unused module stores. cosmos-db's LevelDB Get returns
		// nil for an existing empty value, so IAVL cannot reload their empty
		// roots through gRPC. Give empty fixture stores a namespaced genesis
		// marker. No client or application protocol key is changed by this.
		for _, key := range app.GetStoreKeys() {
			if _, ok := key.(*storetypes.KVStoreKey); !ok {
				continue
			}
			store := ctx.KVStore(key)
			iterator := store.Iterator(nil, nil)
			empty := !iterator.Valid()
			if err := iterator.Close(); err != nil {
				return response, err
			}
			if empty {
				store.Set([]byte("caribic/fixture"), []byte{1})
				t.Logf("initialized empty fixture store %s", key.Name())
			}
		}
		app.IBCKeeper.ConnectionKeeper.SetNextConnectionSequence(ctx, 1)
		app.IBCKeeper.ConnectionKeeper.SetClientConnectionPaths(ctx, acceptanceSubject, []string{"connection-0"})
		return response, nil
	})
	configureAcceptanceUpgrade(t, app, config.Root)
	require.NoError(t, app.LoadLatestVersion())
	loadedHeight := app.LastBlockHeight()
	defer func() { require.NoError(t, app.Close()) }()
	if _, err := os.Stat(cfg.GenesisFile()); os.IsNotExist(err) {
		validator := privval.GenFilePV(cfg.PrivValidatorKeyFile(), cfg.PrivValidatorStateFile())
		validator.Save()
		pub, err := validator.GetPubKey()
		require.NoError(t, err)
		accounts := []authtypes.GenesisAccount{}
		balances := []banktypes.Balance{}
		for i, seed := range []string{"operator", "watcher"} {
			key := acceptanceKey(seed)
			accounts = append(accounts, authtypes.NewBaseAccount(acceptanceAddress(seed), key.PubKey(), uint64(i), 0))
			balances = append(balances, banktypes.Balance{Address: acceptanceAddress(seed).String(), Coins: sdk.NewCoins(sdk.NewInt64Coin("stake", 100_000_000_000_000), sdk.NewInt64Coin("utest", 1_000))})
		}
		genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(pub, 1)}), accounts, balances...)
		require.NoError(t, err)
		slashing := slashingtypes.DefaultGenesisState()
		consAddress := sdk.ConsAddress(pub.Address())
		slashing.SigningInfos = []slashingtypes.SigningInfo{{Address: consAddress.String(), ValidatorSigningInfo: slashingtypes.NewValidatorSigningInfo(consAddress, 0, 0, time.Unix(0, 0), false, 0)}}
		genesis[slashingtypes.ModuleName] = app.AppCodec().MustMarshalJSON(slashing)
		governance := govtypes.DefaultGenesisState()
		period := 3 * time.Second
		governance.Params.VotingPeriod = &period
		expeditedPeriod := time.Second
		governance.Params.ExpeditedVotingPeriod = &expeditedPeriod
		governance.Params.MinDeposit = sdk.NewCoins(sdk.NewCoin("stake", sdkmath.NewInt(1)))
		genesis["gov"] = app.AppCodec().MustMarshalJSON(governance)
		appState, err := json.Marshal(genesis)
		require.NoError(t, err)
		params := cmttypes.DefaultConsensusParams()
		params.Block.MaxBytes = profileInteger(t, string(profile), "BLOCK_MAX_BYTES")
		params.Block.MaxGas = profileInteger(t, string(profile), "BLOCK_MAX_GAS")
		doc := &cmttypes.GenesisDoc{GenesisTime: time.Now(), ChainID: acceptanceChainID, ConsensusParams: params, AppState: appState, Validators: []cmttypes.GenesisValidator{{PubKey: pub, Power: 1}}}
		require.NoError(t, doc.SaveAs(cfg.GenesisFile()))
	}
	var validator cmttypes.PrivValidator = privval.LoadFilePV(cfg.PrivValidatorKeyFile(), cfg.PrivValidatorStateFile())
	consensusStop := make(chan struct{})
	if config.ConsensusControl != "" {
		validator = &acceptanceConsensusValidator{PrivValidator: validator, control: config.ConsensusControl, stopped: consensusStop}
	}
	nodeKey, err := p2p.LoadOrGenNodeKey(cfg.NodeKeyFile())
	require.NoError(t, err)
	n, err := node.NewNode(cfg, validator, nodeKey, proxy.NewLocalClientCreator(server.NewCometABCIWrapper(app)), node.DefaultGenesisDocProviderFunc(cfg), func(c *cmtcfg.DBContext) (cmtdb.DB, error) { return cmtdb.NewGoLevelDB(c.ID, c.Config.DBDir()) }, node.DefaultMetricsProvider(cfg.Instrumentation), cmtlog.NewFilter(cmtlog.NewTMLogger(cmtlog.NewSyncWriter(os.Stdout)), cmtlog.AllowInfo()))
	require.NoError(t, err)
	startHeight := app.LastBlockHeight()
	acceptanceWriteJSON(t, filepath.Join(config.Root, "startup.json"), map[string]int64{"loaded_height": loadedHeight})
	require.NoError(t, n.Start())
	defer func() { require.NoError(t, n.Stop()); n.Wait() }()
	rpc, err := rpchttp.New("http://"+config.RPC, "/websocket")
	require.NoError(t, err)
	clientCtx := client.Context{}.WithCodec(app.AppCodec()).WithInterfaceRegistry(app.InterfaceRegistry()).WithTxConfig(app.TxConfig()).WithClient(rpc).WithChainID(acceptanceChainID)
	app.RegisterTxService(clientCtx)
	grpcCfg := servercfg.DefaultConfig().GRPC
	grpcCfg.MaxRecvMsgSize = 16 * 1024 * 1024
	grpcServer, err := servergrpc.NewGRPCServer(clientCtx, app, grpcCfg)
	require.NoError(t, err)
	listener, err := net.Listen("tcp", config.GRPC)
	require.NoError(t, err)
	go func() { _ = grpcServer.Serve(listener) }()
	defer grpcServer.Stop()
	require.Eventually(t, func() bool {
		r, e := rpc.Status(context.Background())
		return e == nil && r.SyncInfo.LatestBlockHeight > startHeight+1 && r.SyncInfo.LatestBlockTime.After(time.Now().Add(-time.Second))
	}, 15*time.Second, 50*time.Millisecond)
	require.NoError(t, os.WriteFile(filepath.Join(config.Root, "ready"), []byte("ready"), 0600))
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGTERM, os.Interrupt)
	<-stopped
	close(consensusStop)
	signal.Stop(stopped)
}

func acceptanceReadJSON(t *testing.T, path string, target any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, target))
}
func acceptanceWriteJSON(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.MarshalIndent(value, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, raw, 0600))
}
