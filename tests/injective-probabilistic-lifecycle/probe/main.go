// This tool prepares trusted test genesis and messages with the target Injective
// application's codecs. State changes run through the separate injectived node.
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/codec"
	cdctypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	"github.com/cosmos/gogoproto/proto"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"golang.org/x/crypto/blake2b"

	"github.com/InjectiveLabs/injective-core/injective-chain/app"
	injcodec "github.com/InjectiveLabs/injective-core/injective-chain/codec/types"
	"github.com/InjectiveLabs/injective-core/injective-chain/crypto/ethsecp256k1"
	lc "github.com/InjectiveLabs/injective-core/injective-chain/modules/cardano-probabilistic-light-client"
	injtypes "github.com/InjectiveLabs/injective-core/injective-chain/types"
)

type fixture struct {
	Client       *lc.ClientState
	Consensus    *lc.ConsensusState
	Header, Fork *lc.ProbabilisticHeader
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func write(path string, value any) {
	raw, err := json.MarshalIndent(value, "", "  ")
	must(err)
	must(os.WriteFile(path, append(raw, '\n'), 0600))
}

func anyJSON(cdc codec.Codec, value proto.Message) json.RawMessage {
	packed, err := cdctypes.NewAnyWithValue(value)
	must(err)
	raw, err := cdc.MarshalJSON(packed)
	must(err)
	return raw
}

func load(path string) fixture {
	file, err := os.Open(path)
	must(err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	must(err)
	defer reader.Close()
	var f fixture
	must(json.NewDecoder(reader).Decode(&f))
	return f
}

func expand(f *fixture) {
	for i := len(f.Client.EpochStakeDistribution); i < 4000; i++ {
		hash := blake2b.Sum256([]byte(fmt.Sprintf("registered-test-pool-%d", i)))
		binding := &lc.PoolRegistrationBinding{PoolId: ledger.NewBlake2b224(hash[:28]).Bech32("pool"), VrfKeyHash: bytes.Clone(hash[:]), FirstRegistrationSlot: 1}
		f.Client.LatestCheckpointPoolRegistry.Pools = append(f.Client.LatestCheckpointPoolRegistry.Pools, &lc.PoolRegistrationRecord{Registration: binding, Registered: true})
		f.Client.LatestCheckpointPoolRegistry.Mark = append(f.Client.LatestCheckpointPoolRegistry.Mark, binding)
		f.Client.LatestCheckpointPoolRegistry.Effective = append(f.Client.LatestCheckpointPoolRegistry.Effective, binding)
		f.Client.EpochStakeDistribution = append(f.Client.EpochStakeDistribution, &lc.StakeDistributionEntry{PoolId: binding.PoolId, VrfKeyHash: binding.VrfKeyHash, FirstRegistrationSlot: 1, Stake: 1, RelativeStakeNumerator: 1, RelativeStakeDenominator: 10000})
	}
	f.Client.EpochStakeDistribution[11].Stake = 1906
	f.Client.EpochStakeDistribution[11].RelativeStakeNumerator = 1906
	f.Client.EpochStakeDistribution[12].Stake = 1907
	f.Client.EpochStakeDistribution[12].RelativeStakeNumerator = 1907
	f.Client.EpochContexts[0].StakeDistribution = f.Client.EpochStakeDistribution
	registryBytes, err := f.Client.LatestCheckpointPoolRegistry.Marshal()
	must(err)
	f.Consensus.PoolRegistry = &lc.PoolRegistryState{}
	must(f.Consensus.PoolRegistry.Unmarshal(registryBytes))
	for _, header := range []*lc.ProbabilisticHeader{f.Header, f.Fork} {
		header.NewEpochContext.StakeDistribution = f.Client.EpochStakeDistribution
	}
}

func shift(f *fixture) {
	newest := max(f.Header.DescendantBlocks[len(f.Header.DescendantBlocks)-1].Timestamp, f.Fork.DescendantBlocks[len(f.Fork.DescendantBlocks)-1].Timestamp)
	delta := time.Now().Add(-5*time.Minute).UnixNano() - int64(newest)
	f.Client.SystemStartUnixNs = uint64(int64(f.Client.SystemStartUnixNs) + delta)
	f.Client.LatestCheckpointTimestamp = uint64(int64(f.Client.LatestCheckpointTimestamp) + delta)
	f.Consensus.Timestamp = uint64(int64(f.Consensus.Timestamp) + delta)
	for _, header := range []*lc.ProbabilisticHeader{f.Header, f.Fork} {
		for _, block := range append(append(append([]*lc.ProbabilisticBlock{}, header.BridgeBlocks...), header.AnchorBlock), header.DescendantBlocks...) {
			block.Timestamp = uint64(int64(block.Timestamp) + delta)
		}
		for _, block := range header.DescendantBlocks {
			var fields []cbor.RawMessage
			_, err := cbor.Decode(block.BlockCbor, &fields)
			must(err)
			block.HeaderCbor = bytes.Clone(fields[0])
			block.BlockCbor = nil
		}
	}
}

func writeTx(cdc codec.Codec, directory, name string, message proto.Message) {
	write(filepath.Join(directory, name+".json"), map[string]any{"body": map[string]any{"messages": []json.RawMessage{anyJSON(cdc, message)}, "memo": "Injective local release test", "timeout_height": "0", "extension_options": []any{}, "non_critical_extension_options": []any{}}, "auth_info": map[string]any{"signer_infos": []any{}, "fee": map[string]any{"amount": []any{}, "gas_limit": "0", "payer": "", "granter": ""}}, "signatures": []any{}})
}

func lifecycle(cdc codec.Codec, directory, address string) fixture {
	readJSON := func(name string, target any) {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		must(err)
		must(json.Unmarshal(raw, target))
	}
	var f fixture
	readJSON("source-history.json", &f)
	var headers map[string]*lc.ProbabilisticHeader
	readJSON("headers.json", &headers)
	for name, clientID := range map[string]string{"baseline-subject": lc.ModuleName + "-0", "baseline-control": lc.ModuleName + "-1", "proposal": lc.ModuleName + "-0", "honest": lc.ModuleName + "-1", "replacement": lc.ModuleName + "-1", "ordinary": lc.ModuleName + "-0", "boundary": lc.ModuleName + "-0", "restart": lc.ModuleName + "-0"} {
		headerName := name
		if name == "baseline-subject" || name == "baseline-control" {
			headerName = "baseline"
		}
		message, err := clienttypes.NewMsgUpdateClient(clientID, headers[headerName], address)
		must(err)
		writeTx(cdc, directory, name, message)
	}
	challenge, err := clienttypes.NewMsgSubmitMisbehaviour(lc.ModuleName+"-0", lc.NewMisbehaviour(lc.ModuleName+"-0", headers["proposal"], headers["honest"]), address)
	must(err)
	writeTx(cdc, directory, "challenge", challenge)
	writeTx(cdc, directory, "channel-init", channeltypes.NewMsgChannelOpenInit("transfer", "ics20-1", channeltypes.UNORDERED, []string{"connection-0"}, "transfer", address))
	var channelProof struct{ Proof []byte }
	readJSON("channel-proof.json", &channelProof)
	writeTx(cdc, directory, "channel-ack", channeltypes.NewMsgChannelOpenAck("transfer", "channel-0", "channel-0", "ics20-1", channelProof.Proof, clienttypes.NewHeight(0, 966), address))
	for _, point := range []struct{ height, sequence uint64 }{{967, 1}, {1001, 2}, {1032, 2}, {1063, 2}, {1063, 3}, {1094, 4}, {1125, 5}} {
		var packet channeltypes.MsgRecvPacket
		name := fmt.Sprintf("packet-%d-%d", point.height, point.sequence)
		readJSON(name+".json", &packet)
		writeTx(cdc, directory, "recv-"+name, &packet)
	}
	writeTx(cdc, directory, "unauthorized-recovery", clienttypes.NewMsgRecoverClient(address, lc.ModuleName+"-0", lc.ModuleName+"-2"))
	recovery := clienttypes.NewMsgRecoverClient(authtypes.NewModuleAddress("gov").String(), lc.ModuleName+"-0", lc.ModuleName+"-2")
	deposit, err := sdk.ParseCoinsNormalized("500000000000000000001inj")
	must(err)
	proposal, err := govtypes.NewMsgSubmitProposal([]sdk.Msg{recovery}, deposit, address, "", "Recover test Cardano client", "Local Injective application acceptance", true)
	must(err)
	writeTx(cdc, directory, "governance-recovery", proposal)
	writeTx(cdc, directory, "vote-recovery", govtypes.NewMsgVote(sdk.MustAccAddressFromBech32(address), 1, govtypes.OptionYes, ""))
	return f
}

func main() {
	injtypes.SetBech32Prefixes(sdk.GetConfig())
	injtypes.SetBip44CoinType(sdk.GetConfig())
	encoding := injcodec.MakeEncodingConfig()
	app.ModuleBasics.RegisterInterfaces(encoding.InterfaceRegistry)
	keyBytes := sha256.Sum256([]byte("cardano-ibc/injective-release/local-test-operator"))
	key := &ethsecp256k1.PrivKey{Key: keyBytes[:]}
	address := sdk.AccAddress(key.PubKey().Address()).String()
	if os.Args[1] == "address" {
		fmt.Println(address)
		return
	}
	if os.Args[1] == "key" {
		must(os.WriteFile(os.Args[2], []byte(hex.EncodeToString(keyBytes[:])), 0600))
		return
	}
	if os.Args[1] == "decode" {
		raw, err := os.ReadFile(os.Args[2])
		must(err)
		state := clienttypes.MustUnmarshalClientState(encoding.Codec, raw)
		encoded, err := encoding.Codec.MarshalJSON(state)
		must(err)
		fmt.Println(string(encoded))
		return
	}
	if os.Args[1] == "create" {
		clientRaw, err := os.ReadFile(os.Args[2])
		must(err)
		consensusRaw, err := os.ReadFile(os.Args[3])
		must(err)
		client := clienttypes.MustUnmarshalClientState(encoding.Codec, clientRaw)
		probabilistic := client.(*lc.ClientState)
		probabilistic.OperationalCertificateCounterHistoryStartHeight = probabilistic.LatestCheckpointHeight
		consensus := clienttypes.MustUnmarshalConsensusState(encoding.Codec, consensusRaw)
		message, err := clienttypes.NewMsgCreateClient(client, consensus, address)
		must(err)
		writeTx(encoding.Codec, os.Args[4], "create-substitute", message)
		return
	}
	var f fixture
	if os.Args[1] == "lifecycle" {
		f = lifecycle(encoding.Codec, os.Args[2], address)
	} else {
		f = load(os.Args[2])
	}
	if os.Args[3] == "expanded" {
		expand(&f)
	}
	if os.Args[1] != "lifecycle" {
		shift(&f)
		must(f.Header.ValidateBasic())
		must(f.Fork.ValidateBasic())
	}
	directory := os.Args[4]
	must(os.MkdirAll(directory, 0700))
	must(f.Client.Validate())
	if os.Args[1] != "lifecycle" {
		for name, message := range map[string]proto.Message{
			"proposal": func() proto.Message {
				m, e := clienttypes.NewMsgUpdateClient(lc.ModuleName+"-0", f.Header, address)
				must(e)
				return m
			}(),
			"challenge": func() proto.Message {
				m, e := clienttypes.NewMsgSubmitMisbehaviour(lc.ModuleName+"-0", lc.NewMisbehaviour(lc.ModuleName+"-0", f.Header, f.Fork), address)
				must(e)
				return m
			}(),
		} {
			writeTx(encoding.Codec, directory, name, message)
			packed, err := cdctypes.NewAnyWithValue(message)
			must(err)
			raw, err := packed.Marshal()
			must(err)
			must(os.WriteFile(filepath.Join(directory, name+".pb"), raw, 0600))
		}
	}
	store := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := sdk.Context{}.WithBlockTime(time.Now().Add(-5 * time.Minute)).WithBlockHeight(1).WithChainID("injective-777").WithGasMeter(storetypes.NewInfiniteGasMeter()).WithEventManager(sdk.NewEventManager())
	must(f.Client.Initialize(ctx, encoding.Codec, store, f.Consensus))
	// Initialize assigns the host's challenge deadline. Genesis must use that
	// resulting state rather than overwrite it with the input checkpoint.
	f.Client = clienttypes.MustUnmarshalClientState(encoding.Codec, store.Get([]byte("clientState"))).(*lc.ClientState)
	metadata := []clienttypes.GenesisMetadata{}
	iterator := store.Iterator(nil, nil)
	for ; iterator.Valid(); iterator.Next() {
		metadata = append(metadata, clienttypes.NewGenesisMetadata(bytes.Clone(iterator.Key()), bytes.Clone(iterator.Value())))
	}
	must(iterator.Close())
	bootstrap := map[string]any{
		"client":    map[string]any{"client_id": lc.ModuleName + "-0", "client_state": anyJSON(encoding.Codec, f.Client)},
		"consensus": map[string]any{"client_id": lc.ModuleName + "-0", "consensus_states": []any{map[string]any{"height": f.Client.LatestHeight, "consensus_state": anyJSON(encoding.Codec, f.Consensus)}}},
		"metadata":  clienttypes.NewIdentifiedGenesisMetadata(lc.ModuleName+"-0", metadata),
		"operator":  address,
	}
	if os.Args[1] == "lifecycle" {
		clients, consensuses, metadatas := []any{}, []any{}, []any{}
		for i := 0; i < 2; i++ {
			id := fmt.Sprintf("%s-%d", lc.ModuleName, i)
			clients = append(clients, map[string]any{"client_id": id, "client_state": anyJSON(encoding.Codec, f.Client)})
			consensuses = append(consensuses, map[string]any{"client_id": id, "consensus_states": []any{map[string]any{"height": f.Client.LatestHeight, "consensus_state": anyJSON(encoding.Codec, f.Consensus)}}})
			metadatas = append(metadatas, clienttypes.NewIdentifiedGenesisMetadata(id, metadata))
		}
		bootstrap["clients"], bootstrap["consensuses"], bootstrap["metadatas"] = clients, consensuses, metadatas
		connection := connectiontypes.NewConnectionEnd(connectiontypes.OPEN, lc.ModuleName+"-0", connectiontypes.NewCounterparty("07-tendermint-0", "connection-0", commitmenttypes.NewMerklePrefix([]byte("ibc"))), connectiontypes.GetCompatibleVersions(), 0)
		bootstrap["connection"] = connectiontypes.NewIdentifiedConnection("connection-0", connection)
	}
	write(filepath.Join(directory, "bootstrap.json"), bootstrap)
}
