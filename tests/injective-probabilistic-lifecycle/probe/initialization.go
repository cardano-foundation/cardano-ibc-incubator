package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	injcodec "github.com/InjectiveLabs/injective-core/injective-chain/codec/types"
	"github.com/InjectiveLabs/injective-core/injective-chain/crypto/ethsecp256k1"
	lc "github.com/InjectiveLabs/injective-core/injective-chain/modules/cardano-probabilistic-light-client"
	abcicli "github.com/cometbft/cometbft/abci/client"
	abci "github.com/cometbft/cometbft/abci/types"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	genutiltypes "github.com/cosmos/cosmos-sdk/x/genutil/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"google.golang.org/protobuf/encoding/protowire"
)

// Read the actual protobuf QueryNewClient replies exported by the Gateway test.
// The native application does not construct a second initialization plan.
func initializationResponses(path string) []map[protowire.Number]*codectypes.Any {
	raw, err := os.ReadFile(path)
	must(err)
	var encoded [][]byte
	must(json.Unmarshal(raw, &encoded))
	if len(encoded) < 2 {
		panic("expected creation and bounded import responses")
	}
	responses := make([]map[protowire.Number]*codectypes.Any, len(encoded))
	for index, raw := range encoded {
		values := map[protowire.Number]*codectypes.Any{}
		for len(raw) > 0 {
			number, kind, n := protowire.ConsumeTag(raw)
			if n < 1 || kind != protowire.BytesType {
				panic("invalid Gateway response tag")
			}
			value, size := protowire.ConsumeBytes(raw[n:])
			if size < 1 {
				panic("invalid Gateway response field")
			}
			var envelope codectypes.Any
			must(envelope.Unmarshal(value))
			values[number] = &envelope
			raw = raw[n+size:]
		}
		responses[index] = values
	}
	return responses
}

func initializationRun(encoding injcodec.EncodingConfig, key *ethsecp256k1.PrivKey, address string) {
	dir := os.Args[2]
	responses := initializationResponses(filepath.Join(dir, "gateway-responses.json"))
	initial := &lc.ClientState{}
	consensus := &lc.ConsensusState{}
	must(initial.Unmarshal(responses[0][1].Value))
	must(consensus.Unmarshal(responses[0][2].Value))
	if os.Args[1] == "initialization-info" {
		write(filepath.Join(dir, "initialization-info.json"), map[string]any{
			"checkpoint_unix_ns": initial.LatestCheckpointTimestamp,
			"client_bytes":       len(responses[0][1].Value), "consensus_bytes": len(responses[0][2].Value),
			"imports": len(responses) - 1,
		})
		return
	}
	genesis, err := genutiltypes.AppGenesisFromFile(filepath.Join(dir, "testnet/config/genesis.json"))
	must(err)
	must(genesis.ValidateAndComplete())
	client := abcicli.NewSocketClient("tcp://127.0.0.1:26658", true)
	must(client.Start())
	defer client.Stop()
	d := boundedDriver{client: client, encoding: encoding, key: key, address: address, fullAdmission: true, now: genesis.GenesisTime, output: filepath.Join(dir, "initialization-transactions.json")}
	info, err := client.Info(context.Background(), &abci.InfoRequest{})
	must(err)
	if info.LastBlockHeight == 0 {
		params := genesis.Consensus.Params.ToProto()
		response, err := client.InitChain(context.Background(), &abci.InitChainRequest{Time: genesis.GenesisTime, ChainId: genesis.ChainID, InitialHeight: genesis.InitialHeight, ConsensusParams: &params, AppStateBytes: genesis.AppState})
		must(err)
		d.validators = response.Validators
		write(filepath.Join(dir, "validators.json"), d.validators)
	} else {
		d.height = info.LastBlockHeight
		saved, err := client.Query(context.Background(), &abci.QueryRequest{Path: "/store/ibc/key", Data: []byte("probabilisticHost/continuity")})
		must(err)
		if len(saved.Value) == 32 {
			d.now = time.Unix(0, int64(binary.BigEndian.Uint64(saved.Value[8:16])))
		} else {
			// Pending initialization has no completed checkpoint continuity yet.
			d.now = genesis.GenesisTime.Add(time.Duration(d.height) * 10 * time.Second)
		}
		raw, err := os.ReadFile(filepath.Join(dir, "validators.json"))
		must(err)
		must(json.Unmarshal(raw, &d.validators))
		raw, err = os.ReadFile(d.output)
		must(err)
		must(json.Unmarshal(raw, &d.evidence))
	}
	d.block()
	id := lc.ModuleName + "-0"
	if info.LastBlockHeight == 0 {
		message, err := clienttypes.NewMsgCreateClient(initial, consensus, address)
		must(err)
		d.send("create-client", message)
	}
	limit := len(responses)
	if len(os.Args) > 3 {
		limit, err = strconv.Atoi(os.Args[3])
		must(err)
	}
	for index := 1; index < len(responses) && index <= limit; index++ {
		state := d.state(id)
		if !bytes.Equal(state.CheckpointReference, initial.CheckpointReference) {
			panic("destination checkpoint differs from Gateway creation response")
		}
		if !state.BootstrapPending {
			break
		}
		progress := d.verification(state, 11, nil)
		var sequence uint32
		must(json.Unmarshal(progress["Sequence"], &sequence))
		if uint32(index) <= sequence {
			continue
		}
		header := &lc.ProbabilisticHeader{}
		must(header.Unmarshal(responses[index][3].Value))
		if header.ObservationChunk.Sequence != sequence+1 {
			panic("Gateway import does not follow the committed cursor")
		}
		message, err := clienttypes.NewMsgUpdateClient(id, header, address)
		must(err)
		d.send(fmt.Sprintf("initialization-%04d", index), message)
	}
	state := d.state(id)
	if state.BootstrapPending && limit >= len(responses)-1 {
		panic("all imports committed but initialization is still pending")
	}
	status := &clienttypes.QueryClientStatusResponse{}
	d.query("/ibc.core.client.v1.Query/ClientStatus", &clienttypes.QueryClientStatusRequest{ClientId: id}, status)
	if !state.BootstrapPending && status.Status != "Active" {
		panic("completed initialization did not produce an active client: " + status.Status)
	}
	write(filepath.Join(dir, "initialization-state.json"), state)
	write(filepath.Join(dir, "initialization-result.json"), map[string]any{
		"client_id": id, "bootstrap_pending": state.BootstrapPending, "status": status.Status,
		"client_bytes": state.Size(), "imports": len(responses) - 1,
		"committed_transactions": len(d.evidence), "host_height": d.height,
		"checkpoint_matches_gateway": bytes.Equal(state.CheckpointReference, initial.CheckpointReference),
		"application_restarted":      info.LastBlockHeight > 0,
	})
}
