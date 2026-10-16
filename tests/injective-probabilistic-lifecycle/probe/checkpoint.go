package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/InjectiveLabs/injective-core/injective-chain/crypto/ethsecp256k1"
	"os"
	"path/filepath"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	injcodec "github.com/InjectiveLabs/injective-core/injective-chain/codec/types"
	lc "github.com/InjectiveLabs/injective-core/injective-chain/modules/cardano-probabilistic-light-client"
	dbm "github.com/cosmos/cosmos-db"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
)

func checkpointPrepare(encoding injcodec.EncodingConfig, address string) {
	dir := os.Args[2]
	keyBytes := sha256.Sum256([]byte("cardano-ibc/injective-release/local-test-operator"))
	key := &ethsecp256k1.PrivKey{Key: keyBytes[:]}
	var account [20]byte
	copy(account[:], key.PubKey().Address())
	write(filepath.Join(dir, "hermes-key.json"), map[string]any{"private_key": hex.EncodeToString(keyBytes[:]), "public_key": hex.EncodeToString(key.PubKey().Bytes()), "address": account, "address_type": "Ethermint", "account": address})
	var f fixture
	raw, err := os.ReadFile(filepath.Join(dir, "source-history.json"))
	must(err)
	must(json.Unmarshal(raw, &f))
	f.Client.TrustingPeriod = 96 * time.Hour
	database := dbm.NewMemDB()
	ms := store.NewCommitMultiStore(database, log.NewNopLogger(), metrics.NewNoOpMetrics())
	ms.MountStoreWithDB(lc.SharedStoreKey, storetypes.StoreTypeIAVL, database)
	keys := []*storetypes.KVStoreKey{storetypes.NewKVStoreKey("subject"), storetypes.NewKVStoreKey("control")}
	for _, key := range keys {
		ms.MountStoreWithDB(key, storetypes.StoreTypeIAVL, database)
	}
	must(ms.LoadLatestVersion())
	ctx := sdk.Context{}.WithMultiStore(ms).WithBlockTime(time.Unix(0, int64(f.Consensus.Timestamp))).WithBlockHeight(1).WithChainID("injective-777").WithGasMeter(storetypes.NewInfiniteGasMeter()).WithEventManager(sdk.NewEventManager())
	clients, consensuses, metadatas := []any{}, []any{}, []any{}
	for i, key := range keys {
		var cs *lc.ClientState
		var consensus *lc.ConsensusState
		if os.Args[3] == "compact" {
			cs, consensus, err = lc.EnableSharedSnapshots(ctx, encoding.Codec, ctx.KVStore(key), f.Client, f.Consensus)
			must(err)
		} else {
			cs, consensus = f.Client, f.Consensus
			must(cs.Initialize(ctx, encoding.Codec, ctx.KVStore(key), consensus))
			cs = clienttypes.MustUnmarshalClientState(encoding.Codec, ctx.KVStore(key).Get([]byte("clientState"))).(*lc.ClientState)
		}
		id := lc.ModuleName + "-" + string(rune('0'+i))
		clients = append(clients, map[string]any{"client_id": id, "client_state": anyJSON(encoding.Codec, cs)})
		consensuses = append(consensuses, map[string]any{"client_id": id, "consensus_states": []any{map[string]any{"height": cs.LatestHeight, "consensus_state": anyJSON(encoding.Codec, consensus)}}})
		metadata := []clienttypes.GenesisMetadata{}
		it := ctx.KVStore(key).Iterator(nil, nil)
		for ; it.Valid(); it.Next() {
			metadata = append(metadata, clienttypes.NewGenesisMetadata(append([]byte(nil), it.Key()...), append([]byte(nil), it.Value()...)))
		}
		must(it.Close())
		metadatas = append(metadatas, clienttypes.NewIdentifiedGenesisMetadata(id, metadata))
	}
	shared := lc.NewAppModule().ExportGenesis(ctx, encoding.Codec)
	connection := connectiontypes.NewConnectionEnd(connectiontypes.OPEN, lc.ModuleName+"-0", connectiontypes.NewCounterparty("07-tendermint-0", "connection-0", commitmenttypes.NewMerklePrefix([]byte("ibc"))), connectiontypes.GetCompatibleVersions(), 0)
	var channelProof struct{ Proof []byte }
	raw, err = os.ReadFile(filepath.Join(dir, "channel-proof.json"))
	must(err)
	must(json.Unmarshal(raw, &channelProof))
	writeTx(encoding.Codec, dir, "channel-init", channeltypes.NewMsgChannelOpenInit("transfer", "ics20-1", channeltypes.UNORDERED, []string{"connection-0"}, "transfer", address))
	writeTx(encoding.Codec, dir, "channel-ack", channeltypes.NewMsgChannelOpenAck("transfer", "channel-0", "channel-0", "ics20-1", channelProof.Proof, clienttypes.NewHeight(0, 966), address))
	for _, name := range []string{"packet-966-1", "packet-1125-2"} {
		var packet channeltypes.MsgRecvPacket
		raw, err = os.ReadFile(filepath.Join(dir, name+".json"))
		must(err)
		must(json.Unmarshal(raw, &packet))
		writeTx(encoding.Codec, dir, "recv-"+name, &packet)
	}
	for i, name := range []string{"control", "subject"} {
		subject, substitute := lc.ModuleName+"-1", lc.ModuleName+"-2"
		if i == 1 {
			subject, substitute = lc.ModuleName+"-0", lc.ModuleName+"-2"
		}
		writeTx(encoding.Codec, dir, "unauthorized-recovery-"+name, clienttypes.NewMsgRecoverClient(address, subject, substitute))
		recovery := clienttypes.NewMsgRecoverClient(authtypes.NewModuleAddress("gov").String(), subject, substitute)
		deposit, err := sdk.ParseCoinsNormalized("500000000000000000001inj")
		must(err)
		proposal, err := govtypes.NewMsgSubmitProposal([]sdk.Msg{recovery}, deposit, address, "", "Recover idle Cardano client", "Disposable native checkpoint lifecycle", true)
		must(err)
		writeTx(encoding.Codec, dir, "recover-"+name, proposal)
		writeTx(encoding.Codec, dir, "vote-"+name, govtypes.NewMsgVote(sdk.MustAccAddressFromBech32(address), uint64(i+1), govtypes.OptionYes, ""))
	}
	write(filepath.Join(dir, "bootstrap.json"), map[string]any{"connection": connectiontypes.NewIdentifiedConnection("connection-0", connection), "clients": clients, "consensuses": consensuses, "metadatas": metadatas, "operator": address, "shared_objects": json.RawMessage(shared)})
}

func checkpointMessages(encoding injcodec.EncodingConfig, address string) {
	dir := os.Args[2]
	for _, height := range []string{"966", "1125"} {
		var message channeltypes.MsgTimeout
		raw, err := os.ReadFile(filepath.Join(dir, "timeout-"+height+".json"))
		must(err)
		must(json.Unmarshal(raw, &message))
		writeTx(encoding.Codec, dir, "timeout-old-root-"+height, &message)
	}
	for name, id := range map[string]string{"expired-update": lc.ModuleName + "-1", "frozen-checkpoint": lc.ModuleName + "-0"} {
		var header lc.ProbabilisticHeader
		raw, err := os.ReadFile(filepath.Join(dir, name+"-header.json"))
		must(err)
		must(json.Unmarshal(raw, &header))
		message, err := clienttypes.NewMsgUpdateClient(id, &header, address)
		must(err)
		writeTx(encoding.Codec, dir, name, message)
	}
}
func checkpointPlan(encoding injcodec.EncodingConfig, address string) {
	raw, err := os.ReadFile(os.Args[2])
	must(err)
	client := clienttypes.MustUnmarshalClientState(encoding.Codec, raw).(*lc.ClientState)
	var header lc.ProbabilisticHeader
	raw, err = os.ReadFile(os.Args[3])
	must(err)
	must(json.Unmarshal(raw, &header))
	steps, session, err := lc.BuildObservationPlan(client, &header, nil, 13, 1)
	must(err)
	dir := os.Args[4]
	must(os.MkdirAll(dir, 0700))
	files := []string{}
	for i, step := range steps {
		message, err := clienttypes.NewMsgUpdateClient(lc.ModuleName+"-0", step, address)
		must(err)
		name := fmt.Sprintf("stage-%04d", i)
		writeTx(encoding.Codec, dir, name, message)
		files = append(files, name+".json")
	}
	activation := &lc.ProbabilisticHeader{ObservationChunk: &lc.ObservationChunk{Operation: 7, SessionId: session, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}}
	message, err := clienttypes.NewMsgUpdateClient(lc.ModuleName+"-0", activation, address)
	must(err)
	writeTx(encoding.Codec, dir, "activate", message)
	write(filepath.Join(dir, "plan.json"), map[string]any{"files": files, "session": session, "checkpoint_timestamp": client.LatestCheckpointTimestamp})
}

func checkpointAddMaintainer(encoding injcodec.EncodingConfig, address string) {
	dir := os.Args[2]
	var f fixture
	raw, err := os.ReadFile(filepath.Join(dir, "source-history.json"))
	must(err)
	must(json.Unmarshal(raw, &f))
	f.Client.TrustingPeriod = 96 * time.Hour
	client, consensus := f.Client, f.Consensus
	var steps []*lc.ProbabilisticHeader
	if os.Args[3] == "compact" {
		client, consensus, steps, err = lc.BuildCompactBootstrap(dbadapter.Store{DB: dbm.NewMemDB()}, client, consensus)
		must(err)
	}
	message, err := clienttypes.NewMsgCreateClient(client, consensus, address)
	must(err)
	writeTx(encoding.Codec, dir, "create-maintainer", message)
	files := []string{"create-maintainer.json"}
	for i, step := range steps {
		message, err := clienttypes.NewMsgUpdateClient(lc.ModuleName+"-2", step, address)
		must(err)
		name := fmt.Sprintf("maintainer-bootstrap-%04d", i)
		writeTx(encoding.Codec, dir, name, message)
		files = append(files, name+".json")
	}
	write(filepath.Join(dir, "maintainer-plan.json"), map[string]any{"files": files})
}
