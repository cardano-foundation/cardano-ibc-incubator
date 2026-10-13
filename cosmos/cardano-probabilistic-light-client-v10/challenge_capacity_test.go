package probabilistic

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
	"time"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	corestate "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	cmtdb "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtcfg "github.com/cometbft/cometbft/config"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmtlog "github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/proxy"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	cmttypes "github.com/cometbft/cometbft/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/client/flags"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/cosmos/cosmos-sdk/server"
	servercfg "github.com/cosmos/cosmos-sdk/server/config"
	servergrpc "github.com/cosmos/cosmos-sdk/server/grpc"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	slashingtypes "github.com/cosmos/cosmos-sdk/x/slashing/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/cosmos/ibc-go/v10/testing/simapp"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type capacityFixture struct {
	Client       *ClientState
	Consensus    *ConsensusState
	Header, Fork *ProbabilisticHeader
}

func capacityEvidence(t *testing.T, name string) capacityFixture {
	t.Helper()
	var f capacityFixture
	require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "native-boundary-"+name+".json.gz"), &f))
	// Keep observed producers' shares at 2% with a full 4,000-pool registry.
	for i := len(f.Client.EpochStakeDistribution); i < corestate.MaxStakeEntries; i++ {
		hash := blake2b.Sum256([]byte(fmt.Sprintf("registered-test-pool-%d", i)))
		binding := &PoolRegistrationBinding{PoolId: ledger.NewBlake2b224(hash[:28]).Bech32("pool"), VrfKeyHash: bytes.Clone(hash[:]), FirstRegistrationSlot: 1}
		f.Client.LatestCheckpointPoolRegistry.Pools = append(f.Client.LatestCheckpointPoolRegistry.Pools, &PoolRegistrationRecord{Registration: binding, Registered: true})
		f.Client.LatestCheckpointPoolRegistry.Mark = append(f.Client.LatestCheckpointPoolRegistry.Mark, binding)
		f.Client.LatestCheckpointPoolRegistry.Effective = append(f.Client.LatestCheckpointPoolRegistry.Effective, binding)
		f.Client.EpochStakeDistribution = append(f.Client.EpochStakeDistribution, &StakeDistributionEntry{PoolId: binding.PoolId, VrfKeyHash: binding.VrfKeyHash, FirstRegistrationSlot: 1, Stake: 1, RelativeStakeNumerator: 1, RelativeStakeDenominator: 10000})
	}
	f.Client.EpochStakeDistribution[11].Stake = 1906
	f.Client.EpochStakeDistribution[11].RelativeStakeNumerator = 1906
	f.Client.EpochStakeDistribution[12].Stake = 1907
	f.Client.EpochStakeDistribution[12].RelativeStakeNumerator = 1907
	f.Client.EpochContexts[0].StakeDistribution = f.Client.EpochStakeDistribution
	f.Consensus.PoolRegistry = fromCorePoolRegistryState(toCorePoolRegistryState(f.Client.LatestCheckpointPoolRegistry))
	// Align timestamps with this isolated host's real clock. Signed slots and
	// block bodies remain unchanged. Both histories use the same system start.
	newest := max(f.Header.DescendantBlocks[len(f.Header.DescendantBlocks)-1].Timestamp, f.Fork.DescendantBlocks[len(f.Fork.DescendantBlocks)-1].Timestamp)
	delta := time.Now().Add(-10*time.Second).UnixNano() - int64(newest)
	f.Client.SystemStartUnixNs = uint64(int64(f.Client.SystemStartUnixNs) + delta)
	f.Client.LatestCheckpointTimestamp = uint64(int64(f.Client.LatestCheckpointTimestamp) + delta)
	f.Consensus.Timestamp = uint64(int64(f.Consensus.Timestamp) + delta)
	for _, h := range []*ProbabilisticHeader{f.Header, f.Fork} {
		h.NewEpochContext.StakeDistribution = f.Client.EpochStakeDistribution
		blocks := append(append([]*ProbabilisticBlock{}, h.BridgeBlocks...), h.AnchorBlock)
		blocks = append(blocks, h.DescendantBlocks...)
		for _, b := range blocks {
			b.Timestamp = uint64(int64(b.Timestamp) + delta)
		}
		// Descendants need signed headers only. Bridge and anchor bodies remain
		// complete because registration and packet tracking authenticate them.
		for _, b := range h.DescendantBlocks {
			var fields []cbor.RawMessage
			_, err := cbor.Decode(b.BlockCbor, &fields)
			require.NoError(t, err)
			b.HeaderCbor = bytes.Clone(fields[0])
			b.BlockCbor = nil
		}
		if name != "combined" {
			require.NoError(t, h.ValidateBasic())
		}
	}
	if name == "combined" {
		f.Header = boundaryCheckpointAt(t, f.Header, 966, 984)
		f.Fork = boundaryCheckpointAt(t, f.Fork, 966, 984)
		require.NoError(t, f.Header.ValidateBasic())
		require.NoError(t, f.Fork.ValidateBasic())
	}
	return f
}

func profileInteger(t *testing.T, source, name string) int64 {
	t.Helper()
	match := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(name) + `=(\d+)$`).FindStringSubmatch(source)
	require.Len(t, match, 2, "missing profile setting %s", name)
	value, err := strconv.ParseInt(match[1], 10, 64)
	require.NoError(t, err)
	return value
}

func spareAddress(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	address := l.Addr().String()
	require.NoError(t, l.Close())
	return address
}

// Run actual signed challenge transactions through a CometBFT validator and
// the SDK gRPC service. The limits come from the destination setup script.
func TestDestinationChallengeCapacity(t *testing.T) {
	for _, name := range []string{"size", "count", "control", "limit", "combined"} {
		t.Run(name, func(t *testing.T) {
			f := capacityEvidence(t, name)
			if name == "combined" {
				// Simulate an omitted future pool set. The independently
				// authenticated challenger carries the complete 4,000 rows.
				f.Header.NewEpochContext.StakeDistribution = fromCoreEpochContext(toCoreEpochContext(f.Header.NewEpochContext)).StakeDistribution[:13]
				var total uint64
				for _, entry := range f.Header.NewEpochContext.StakeDistribution {
					total += entry.Stake
				}
				for _, entry := range f.Header.NewEpochContext.StakeDistribution {
					entry.RelativeStakeNumerator, entry.RelativeStakeDenominator = entry.Stake, total
				}
			}
			profile, err := os.ReadFile("../../chains/cosmos/scripts/setup_profile.sh")
			require.NoError(t, err)
			maxTx := profileInteger(t, string(profile), "MAX_TX_BYTES")
			maxGas := profileInteger(t, string(profile), "BLOCK_MAX_GAS")
			relayerLimits, err := os.ReadFile("../../caribic/src/chains/network_limits.rs")
			require.NoError(t, err)
			require.Contains(t, string(relayerLimits), "LOCAL_MAX_TX_SIZE: u64 = 8 * 1_048_576")
			require.Contains(t, string(relayerLimits), "LOCAL_MAX_TX_GAS: u64 = 600_000_000")
			relayerProfile, err := os.ReadFile("../../caribic/src/chains/cosmos_profiles/hermes.rs")
			require.NoError(t, err)
			require.Contains(t, string(relayerProfile), `gas_multiplier: "1.8"`)
			require.Contains(t, string(relayerProfile), `rpc_timeout: "10s"`)
			maxRelayerTx := 8 * 1024 * 1024
			require.LessOrEqual(t, corestate.MaxChallengeTxBytes, maxRelayerTx)
			require.LessOrEqual(t, (corestate.MaxChallengeTxGas*18+9)/10, uint64(maxGas))
			root := t.TempDir()
			require.NoError(t, os.MkdirAll(filepath.Join(root, "data"), 0700))
			cfg := cmtcfg.DefaultConfig().SetRoot(root)
			cfg.RPC.ListenAddress = "tcp://" + spareAddress(t)
			cfg.P2P.ListenAddress = "tcp://" + spareAddress(t)
			cfg.P2P.PexReactor = false
			cfg.Mempool.MaxTxBytes = int(maxTx)
			cfg.RPC.MaxBodyBytes = profileInteger(t, string(profile), "RPC_MAX_BODY_BYTES")
			cfg.Consensus.TimeoutCommit = 200 * time.Millisecond
			cfg.Consensus.CreateEmptyBlocks = false
			cfg.Consensus.TimeoutPropose = time.Second
			privVal := cmttypes.NewMockPV()
			pubKey, err := privVal.GetPubKey()
			require.NoError(t, err)
			key := secp256k1.GenPrivKey()
			account := authtypes.NewBaseAccount(sdk.AccAddress(key.PubKey().Address()), key.PubKey(), 0, 0)
			app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: root, server.FlagInvCheckPeriod: uint(0)}, baseapp.SetChainID("challenge-capacity-1"))
			registerCapacityClient(app)
			app.SetInitChainer(func(ctx sdk.Context, req *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
				response, err := app.InitChainer(ctx, req)
				if err != nil {
					return response, err
				}
				params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
				params.AllowedClients = append(params.AllowedClients, ModuleName)
				app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
				store := app.IBCKeeper.ClientKeeper.ClientStore(ctx, ModuleName+"-0")
				// Genesis installs an explicitly trusted checkpoint with an elapsed
				// initial response window. The tested update opens its own new window.
				return response, f.Client.Initialize(ctx.WithBlockTime(ctx.BlockTime().Add(-3*time.Minute)), app.AppCodec(), store, f.Consensus)
			})
			require.NoError(t, app.LoadLatestVersion())
			t.Cleanup(func() { require.NoError(t, app.Close()) })
			genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(pubKey, 1)}), []authtypes.GenesisAccount{account}, banktypes.Balance{Address: account.GetAddress().String(), Coins: sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(100_000_000_000_000)))})
			require.NoError(t, err)
			slashing := slashingtypes.DefaultGenesisState()
			consAddress := sdk.ConsAddress(pubKey.Address())
			slashing.SigningInfos = []slashingtypes.SigningInfo{{Address: consAddress.String(), ValidatorSigningInfo: slashingtypes.NewValidatorSigningInfo(consAddress, 0, 0, time.Unix(0, 0), false, 0)}}
			genesis[slashingtypes.ModuleName] = app.AppCodec().MustMarshalJSON(slashing)
			appState, err := json.Marshal(genesis)
			require.NoError(t, err)
			params := cmttypes.DefaultConsensusParams()
			params.Block.MaxBytes = profileInteger(t, string(profile), "BLOCK_MAX_BYTES")
			params.Block.MaxGas = maxGas
			doc := &cmttypes.GenesisDoc{GenesisTime: time.Now(), ChainID: "challenge-capacity-1", ConsensusParams: params, AppState: appState, Validators: []cmttypes.GenesisValidator{{PubKey: pubKey, Power: 1}}}
			n, err := node.NewNode(cfg, privVal, &p2p.NodeKey{PrivKey: cmted25519.GenPrivKey()}, proxy.NewLocalClientCreator(server.NewCometABCIWrapper(app)), func() (*cmttypes.GenesisDoc, error) { return doc, nil }, func(*cmtcfg.DBContext) (cmtdb.DB, error) { return cmtdb.NewMemDB(), nil }, node.DefaultMetricsProvider(cfg.Instrumentation), cmtlog.NewNopLogger())
			require.NoError(t, err)
			require.NoError(t, n.Start())
			t.Cleanup(func() { require.NoError(t, n.Stop()); n.Wait() })
			rpc, err := rpchttp.NewWithTimeout("http://"+cfg.RPC.ListenAddress[len("tcp://"):], "/websocket", 10)
			require.NoError(t, err)
			clientCtx := client.Context{}.WithCodec(app.AppCodec()).WithInterfaceRegistry(app.InterfaceRegistry()).WithTxConfig(app.TxConfig()).WithClient(rpc).WithChainID(doc.ChainID)
			app.RegisterTxService(clientCtx)
			grpcCfg := servercfg.DefaultConfig().GRPC
			grpcCfg.MaxRecvMsgSize = 16 * 1024 * 1024
			require.Contains(t, string(profile), "max-recv-msg-size = 16777216")
			grpcServer, err := servergrpc.NewGRPCServer(clientCtx, app, grpcCfg)
			require.NoError(t, err)
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			require.NoError(t, err)
			go func() { _ = grpcServer.Serve(listener) }()
			t.Cleanup(grpcServer.Stop)
			conn, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(16*1024*1024)))
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, conn.Close()) })
			txClient := txtypes.NewServiceClient(conn)
			query := clienttypes.NewQueryClient(conn)
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			require.Eventually(t, func() bool { r, e := rpc.Status(ctx); return e == nil && r.SyncInfo.LatestBlockHeight > 0 }, 10*time.Second, 50*time.Millisecond)
			sequence := uint64(0)
			encode := func(msg sdk.Msg, gas uint64) []byte {
				tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), app.TxConfig(), []sdk.Msg{msg}, sdk.NewCoins(sdk.NewInt64Coin(sdk.DefaultBondDenom, 1_500_000)), gas, doc.ChainID, []uint64{account.AccountNumber}, []uint64{sequence}, key)
				require.NoError(t, err)
				wire, err := app.TxConfig().TxEncoder()(tx)
				require.NoError(t, err)
				require.LessOrEqual(t, len(wire), int(maxTx))
				require.LessOrEqual(t, len(wire), maxRelayerTx)
				return wire
			}
			submit := func(msg sdk.Msg, viaGRPC bool) ([]byte, uint64, time.Duration) {
				wire := encode(msg, uint64(maxGas))
				started := time.Now()
				simulation, err := txClient.Simulate(ctx, &txtypes.SimulateRequest{TxBytes: wire})
				require.NoError(t, err)
				simulationTime := time.Since(started)
				gas := (simulation.GasInfo.GasUsed*18 + 9) / 10
				require.LessOrEqual(t, gas, uint64(maxGas), "Hermes gas multiplier exceeds the profile cap")
				wire = encode(msg, gas)
				hash := cmttypes.Tx(wire).Hash()
				started = time.Now()
				if probe := os.Getenv("CHALLENGE_RELAYER_PROBE"); viaGRPC && probe != "" {
					anyMsg, err := codectypes.NewAnyWithValue(msg)
					require.NoError(t, err)
					encoded, err := anyMsg.Marshal()
					require.NoError(t, err)
					messageFile := filepath.Join(root, "challenge-message.pb")
					wireFile := filepath.Join(root, "hermes-tx.pb")
					require.NoError(t, os.WriteFile(messageFile, encoded, 0600))
					address := make([]int, len(key.PubKey().Address()))
					for i, b := range key.PubKey().Address() {
						address[i] = int(b)
					}
					input, err := json.Marshal(map[string]any{
						"key":    map[string]any{"private_key": hex.EncodeToString(key.Bytes()), "public_key": hex.EncodeToString(key.PubKey().Bytes()), "address": address, "address_type": "Cosmos", "account": account.GetAddress().String()},
						"signer": account.GetAddress().String(), "account_number": account.AccountNumber, "sequence": sequence,
						"chain_id": doc.ChainID, "max_gas": maxGas, "max_tx_bytes": maxRelayerTx,
						"rpc": "http://" + cfg.RPC.ListenAddress[len("tcp://"):], "grpc": "http://" + listener.Addr().String(),
						"message_file": messageFile, "wire_file": wireFile,
					})
					require.NoError(t, err)
					inputFile := filepath.Join(root, "hermes-input.json")
					require.NoError(t, os.WriteFile(inputFile, input, 0600))
					output, err := exec.CommandContext(ctx, probe, inputFile).CombinedOutput()
					require.NoError(t, err, string(output))
					var metrics struct {
						GasWanted uint64 `json:"gas_wanted"`
					}
					require.NoError(t, json.Unmarshal(output, &metrics))
					gas = metrics.GasWanted
					require.LessOrEqual(t, gas, uint64(maxGas))
					wire, err = os.ReadFile(wireFile)
					require.NoError(t, err)
					hash = cmttypes.Tx(wire).Hash()
				} else if viaGRPC {
					r, err := txClient.BroadcastTx(ctx, &txtypes.BroadcastTxRequest{TxBytes: wire, Mode: txtypes.BroadcastMode_BROADCAST_MODE_SYNC})
					require.NoError(t, err)
					require.Zero(t, r.TxResponse.Code, r.TxResponse.RawLog)
				} else {
					r, err := rpc.BroadcastTxSync(ctx, wire)
					require.NoError(t, err)
					require.Zero(t, r.Code, r.Log)
				}
				var consumed uint64
				require.Eventually(t, func() bool {
					r, err := rpc.Tx(ctx, hash, false)
					if err != nil {
						return false
					}
					require.Zero(t, r.TxResult.Code, r.TxResult.Log)
					consumed = uint64(r.TxResult.GasUsed)
					return true
				}, 10*time.Second, 50*time.Millisecond)
				elapsed := time.Since(started)
				require.Less(t, simulationTime, 10*time.Second, "Hermes RPC timeout")
				require.Less(t, elapsed, 10*time.Second, "Hermes RPC timeout")
				require.LessOrEqual(t, consumed, gas)
				sequence++
				return wire, consumed, elapsed
			}

			oversized := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(f.Header))
			oversized.AnchorBlock.BlockCbor = bytes.Repeat([]byte{0x82}, corestate.MaxHeaderBytes)
			refused, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", oversized, account.GetAddress().String())
			require.NoError(t, err)
			rejection, err := rpc.BroadcastTxSync(ctx, encode(refused, uint64(maxGas)))
			require.NoError(t, err)
			require.NotZero(t, rejection.Code)
			require.Contains(t, rejection.Log, "challenge capacity")
			if name == "size" || name == "control" {
				intermediate := &ProbabilisticHeader{TrustedHeight: NewHeight(0, 966), BridgeBlocks: f.Header.BridgeBlocks[:9], AnchorBlock: f.Header.BridgeBlocks[9], IsCheckpoint: true}
				for _, b := range f.Header.BridgeBlocks[10:] {
					compact := cloneTestProbabilisticBlock(b)
					var fields []cbor.RawMessage
					_, err := cbor.Decode(compact.BlockCbor, &fields)
					require.NoError(t, err)
					compact.BlockCbor = nil
					compact.HeaderCbor = bytes.Clone(fields[0])
					intermediate.DescendantBlocks = append(intermediate.DescendantBlocks, compact)
				}
				checkpoint, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", intermediate, account.GetAddress().String())
				require.NoError(t, err)
				submit(checkpoint, false)
				for _, h := range []*ProbabilisticHeader{f.Header, f.Fork} {
					h.TrustedHeight = NewHeight(0, 976)
					h.BridgeBlocks = h.BridgeBlocks[10:]
				}
			}
			update, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", f.Header, account.GetAddress().String())
			require.NoError(t, err)
			_, _, _ = submit(update, false)
			if name == "combined" {
				response, err := query.ClientState(ctx, &clienttypes.QueryClientStateRequest{ClientId: ModuleName + "-0"})
				require.NoError(t, err)
				proposed := &ClientState{}
				require.NoError(t, proposed.Unmarshal(response.ClientState.Value))
				require.Equal(t, uint64(966), proposed.LatestCheckpointHeight.RevisionHeight)
				require.Len(t, proposed.EpochContextChallenges, 2)
				require.Equal(t, uint64(8), proposed.EpochContextChallenges[1].Epoch)
			}
			evidence := NewMisbehaviour(ModuleName+"-0", f.Header, f.Fork)
			challenge, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", evidence, account.GetAddress().String())
			require.NoError(t, err)
			// Mutated signed evidence must fail simulation and leave the client active.
			invalid := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(f.Fork))
			invalid.AnchorBlock.Hash = fmt.Sprintf("%064x", 1)
			bad, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", NewMisbehaviour(ModuleName+"-0", f.Header, invalid), account.GetAddress().String())
			require.NoError(t, err)
			_, err = txClient.Simulate(ctx, &txtypes.SimulateRequest{TxBytes: encode(bad, uint64(maxGas))})
			require.Error(t, err)
			stateBefore, err := query.ClientState(ctx, &clienttypes.QueryClientStateRequest{ClientId: ModuleName + "-0"})
			require.NoError(t, err)
			var active exported.ClientState
			require.NoError(t, app.AppCodec().UnpackAny(stateBefore.ClientState, &active))
			require.True(t, active.(*ClientState).FrozenHeight.IsZero())
			wire, gas, elapsed := submit(challenge, true)
			result, err := query.ClientState(ctx, &clienttypes.QueryClientStateRequest{ClientId: ModuleName + "-0"})
			require.NoError(t, err)
			var frozen exported.ClientState
			require.NoError(t, app.AppCodec().UnpackAny(result.ClientState, &frozen))
			require.Equal(t, FrozenHeight, frozen.(*ClientState).FrozenHeight)
			require.Equal(t, active.(*ClientState).LatestCheckpointHeight, frozen.(*ClientState).LatestCheckpointHeight)
			t.Logf("%s: header=%d + fork=%d challenge=%d signed_tx=%d gas=%d relay_duration=%s", name, f.Header.Size(), f.Fork.Size(), evidence.Size(), len(wire), gas, elapsed)
		})
	}
}
