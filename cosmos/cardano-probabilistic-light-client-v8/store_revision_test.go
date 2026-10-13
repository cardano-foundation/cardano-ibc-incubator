package probabilistic

import (
	"bytes"
	"compress/gzip"
	storetypes "cosmossdk.io/store/types"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
	"io"
	"os"
	"testing"
	"time"

	gogotypes "github.com/cosmos/gogoproto/types"

	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	tm "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
)

// The shared vectors are generated with the runtime's ICS23MerkleTree and
// encodeConsensusStateValue. Both roots commit the same consensus value.
func TestConsensusProofsBindRevision(t *testing.T) {
	data, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/consensus_revision_proofs.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Key   string          `json:"key"`
		Root  string          `json:"root"`
		Proof json.RawMessage `json:"proof"`
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	consensus := tm.ConsensusState{
		Timestamp:          time.Unix(0, 1000),
		NextValidatorsHash: bytes.Repeat([]byte{0x11}, 32),
		Root:               commitmenttypes.MerkleRoot{Hash: bytes.Repeat([]byte{0x22}, 32)},
	}
	value, err := consensus.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	wrapped := gogotypes.Any{TypeUrl: "/ibc.lightclients.tendermint.v1.ConsensusState", Value: value}
	value, err = wrapped.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		root, err := hex.DecodeString(fixture.Root)
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{
			"clients/07-tendermint-0/consensusStates/1-100",
			"clients/07-tendermint-0/consensusStates/2-100",
			"clients/07-tendermint-0/consensusStates/0-100",
		} {
			t.Run(fixture.Key+"/requested/"+path, func(t *testing.T) {
				key, err := ibcStateKeyFromPath(commitmenttypes.NewMerklePath("ibc", path))
				if err != nil {
					t.Fatal(err)
				}
				err = VerifyIbcStateMembership(root, key, value, fixture.Proof)
				if path == fixture.Key {
					if err != nil {
						t.Fatalf("rejected matching revision proof: %v", err)
					}
				} else if err == nil {
					t.Fatal("accepted proof for a different revision or a legacy height-only key")
				}
			})
		}
	}
}

func readBoundaryGzip(t *testing.T, name string) []byte {
	t.Helper()
	file, err := os.Open("../cardano-probabilistic-light-client-core/testdata/" + name)
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()
	data, err := io.ReadAll(reader)
	require.NoError(t, err)
	return data
}

func TestAppEpochBoundaryCatchUp(t *testing.T) {
	for _, name := range []string{"size", "count", "control"} {
		t.Run(name, func(t *testing.T) {
			var fixture struct {
				Client    *ClientState
				Consensus *ConsensusState
				Header    *ProbabilisticHeader
			}
			require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "native-boundary-"+name+".json.gz"), &fixture))
			client := fixture.Client
			// Include 4,000 authenticated pool bindings to measure realistic state writes.
			for i := len(client.LatestCheckpointPoolRegistry.Pools); i < 4000; i++ {
				hash := blake2b.Sum256([]byte(fmt.Sprintf("registered-test-pool-%d", i)))
				binding := &PoolRegistrationBinding{PoolId: ledger.NewBlake2b224(hash[:28]).Bech32("pool"), VrfKeyHash: bytes.Clone(hash[:]), FirstRegistrationSlot: 1}
				client.LatestCheckpointPoolRegistry.Pools = append(client.LatestCheckpointPoolRegistry.Pools, &PoolRegistrationRecord{Registration: binding, Registered: true})
				client.LatestCheckpointPoolRegistry.Mark = append(client.LatestCheckpointPoolRegistry.Mark, binding)
				client.LatestCheckpointPoolRegistry.Effective = append(client.LatestCheckpointPoolRegistry.Effective, binding)
				client.EpochStakeDistribution = append(client.EpochStakeDistribution, &StakeDistributionEntry{PoolId: binding.PoolId, VrfKeyHash: binding.VrfKeyHash, FirstRegistrationSlot: 1, Stake: 1, RelativeStakeNumerator: 1, RelativeStakeDenominator: 10000})
			}
			// Keep the total and every observed producer's share unchanged.
			client.EpochStakeDistribution[11].Stake = 1906
			client.EpochStakeDistribution[11].RelativeStakeNumerator = 1906
			client.EpochStakeDistribution[12].Stake = 1907
			client.EpochStakeDistribution[12].RelativeStakeNumerator = 1907
			client.EpochContexts[0].StakeDistribution = client.EpochStakeDistribution
			fixture.Consensus.PoolRegistry = fromCorePoolRegistryState(toCorePoolRegistryState(client.LatestCheckpointPoolRegistry))
			now := time.Unix(0, int64(fixture.Header.DescendantBlocks[29].Timestamp))
			app, ctx, store := newBoundaryTestApp(t, now)
			cdc := app.AppCodec()
			require.NoError(t, client.Initialize(ctx, cdc, store, fixture.Consensus))
			ctx = ctx.WithBlockTime(ctx.BlockTime().Add(3 * time.Minute))
			submit := func(header *ProbabilisticHeader) error {
				msg, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", header, sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String())
				require.NoError(t, err)
				_, err = app.MsgServiceRouter().Handler(msg)(ctx, msg)
				return err
			}
			if name != "count" {
				intermediate := &ProbabilisticHeader{TrustedHeight: NewHeight(0, 966), BridgeBlocks: fixture.Header.BridgeBlocks[:9], AnchorBlock: fixture.Header.BridgeBlocks[9], DescendantBlocks: fixture.Header.BridgeBlocks[10:], IsCheckpoint: true}
				for i, block := range intermediate.DescendantBlocks {
					var fields []cbor.RawMessage
					_, err := cbor.Decode(block.BlockCbor, &fields)
					require.NoError(t, err)
					compact := cloneTestProbabilisticBlock(block)
					compact.BlockCbor = nil
					compact.HeaderCbor = bytes.Clone(fields[0])
					intermediate.DescendantBlocks[i] = compact
				}
				require.NoError(t, submit(intermediate))
			}
			wire := readBoundaryGzip(t, "gateway-boundary-"+name+".pb.gz")
			header := &ProbabilisticHeader{}
			require.NoError(t, header.Unmarshal(wire))
			require.True(t, header.IsCheckpoint)
			header.NewEpochContext.StakeDistribution = client.EpochStakeDistribution
			// Keep rootless settlement checks. A short prefix cannot advance the cursor.
			short := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(header))
			short.DescendantBlocks = short.DescendantBlocks[:23]
			before := recoveryStoreSnapshot(t, store)
			require.Error(t, submit(short))
			require.Equal(t, before, recoveryStoreSnapshot(t, store))
			// Account for the SDK's default transaction-size ante cost plus keeper gas.
			ctx = ctx.WithGasMeter(storetypes.NewGasMeter(300_000_000))
			msg, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", header, sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String())
			require.NoError(t, err)
			builder := app.TxConfig().NewTxBuilder()
			require.NoError(t, builder.SetMsgs(msg))
			tx, err := app.TxConfig().TxEncoder()(builder.GetTx())
			require.NoError(t, err)
			require.Less(t, len(tx), 12*1024*1024)
			ctx.GasMeter().ConsumeGas(uint64(len(tx))*10, "default SDK transaction-size gas")
			require.NoError(t, submit(header))
			recovered, found := getClientState(store, cdc)
			require.True(t, found)
			require.Equal(t, uint64(8), recovered.LatestCheckpointEpoch)
			require.Equal(t, header.AnchorBlock.Height, recovered.LatestCheckpointHeight)
			require.Equal(t, uint64(966), recovered.LatestHeight.RevisionHeight)
			require.Less(t, ctx.GasMeter().GasConsumed()*18/10, uint64(600_000_000))
			t.Logf("%s: %d transaction bytes, %d SDK gas with 4,000 pool registrations", name, len(tx), ctx.GasMeter().GasConsumed())
		})
	}
}
