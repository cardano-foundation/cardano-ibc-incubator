package main

// The driver talks to the separately running injectived binary over ABCI. It
// supplies a controlled host clock, but all signing, admission, gas and state
// transitions use the native application's dependency graph and metered stores.
import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/InjectiveLabs/injective-core/injective-chain/app"
	"github.com/blinklabs-io/gouroboros/cbor"
	abciserver "github.com/cometbft/cometbft/abci/server"
	"github.com/cosmos/cosmos-sdk/baseapp"
	sdkserver "github.com/cosmos/cosmos-sdk/server"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/spf13/viper"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	injcodec "github.com/InjectiveLabs/injective-core/injective-chain/codec/types"
	"github.com/InjectiveLabs/injective-core/injective-chain/crypto/ethsecp256k1"
	lc "github.com/InjectiveLabs/injective-core/injective-chain/modules/cardano-probabilistic-light-client"
	abcicli "github.com/cometbft/cometbft/abci/client"
	abci "github.com/cometbft/cometbft/abci/types"
	dbm "github.com/cosmos/cosmos-db"
	clienttx "github.com/cosmos/cosmos-sdk/client/tx"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	signing "github.com/cosmos/cosmos-sdk/types/tx/signing"
	authsigning "github.com/cosmos/cosmos-sdk/x/auth/signing"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	genutiltypes "github.com/cosmos/cosmos-sdk/x/genutil/types"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

func boundedPrepare(encoding injcodec.EncodingConfig, address string) {
	var f fixture
	var headers map[string]*lc.ProbabilisticHeader
	lifecycle := strings.HasSuffix(os.Args[2], "source-history.json")
	if lifecycle {
		raw, err := os.ReadFile(os.Args[2])
		must(err)
		must(json.Unmarshal(raw, &f))
		raw, err = os.ReadFile(filepath.Join(filepath.Dir(os.Args[2]), "headers.json"))
		must(err)
		must(json.Unmarshal(raw, &headers))
		f.Header, f.Fork = headers["proposal"], headers["honest"]
	} else {
		f = load(os.Args[2])
	}
	if os.Args[3] == "expanded" {
		expand(&f)
	}
	if lifecycle {
		for _, header := range headers {
			if header.NewEpochContext != nil {
				header.NewEpochContext.StakeDistribution = f.Client.EpochStakeDistribution
			}
			for _, block := range header.DescendantBlocks {
				if len(block.BlockCbor) > 0 {
					var fields []cbor.RawMessage
					_, err := cbor.Decode(block.BlockCbor, &fields)
					must(err)
					block.HeaderCbor = fields[0]
					block.BlockCbor = nil
				}
			}
		}
	} else {
		shift(&f)
	}
	// Sparse synthetic Cardano fixtures cover more than three days of slots.
	// This source trust setting is separate from the captured destination limits.
	f.Client.TrustingPeriod = 7 * 24 * time.Hour
	if len(os.Args) > 5 && os.Args[5] == "small-proposal" {
		context := *f.Header.NewEpochContext
		context.StakeDistribution = append([]*lc.StakeDistributionEntry(nil), context.StakeDistribution[:13]...)
		f.Header.NewEpochContext = &context
	}

	dir := os.Args[4]
	must(os.MkdirAll(dir, 0700))
	database := dbm.NewMemDB()
	ms := store.NewCommitMultiStore(database, log.NewNopLogger(), metrics.NewNoOpMetrics())
	keys := []*storetypes.KVStoreKey{storetypes.NewKVStoreKey("subject"), storetypes.NewKVStoreKey("substitute")}
	ms.MountStoreWithDB(lc.SharedStoreKey, storetypes.StoreTypeIAVL, database)
	for _, key := range keys {
		ms.MountStoreWithDB(key, storetypes.StoreTypeIAVL, database)
	}
	must(ms.LoadLatestVersion())
	ctx := sdk.Context{}.WithMultiStore(ms).WithBlockTime(time.Now().Add(-5 * time.Minute)).WithBlockHeight(1).WithChainID("injective-777").WithGasMeter(storetypes.NewInfiniteGasMeter()).WithEventManager(sdk.NewEventManager())
	clients, consensuses, metadatas := []any{}, []any{}, []any{}
	for i, key := range keys {
		cs, cons, err := lc.InitializeFromTrustedCheckpoint(ctx, encoding.Codec, ctx.KVStore(key), f.Client, f.Consensus, certifyBootstrap(f.Client))
		must(err)
		id := fmt.Sprintf("%s-%d", lc.ModuleName, i)
		clients = append(clients, map[string]any{"client_id": id, "client_state": anyJSON(encoding.Codec, cs)})
		consensuses = append(consensuses, map[string]any{"client_id": id, "consensus_states": []any{map[string]any{"height": cs.LatestHeight, "consensus_state": anyJSON(encoding.Codec, cons)}}})
		metadata := []clienttypes.GenesisMetadata{}
		iter := ctx.KVStore(key).Iterator(nil, nil)
		for ; iter.Valid(); iter.Next() {
			metadata = append(metadata, clienttypes.NewGenesisMetadata(append([]byte(nil), iter.Key()...), append([]byte(nil), iter.Value()...)))
		}
		must(iter.Close())
		metadatas = append(metadatas, clienttypes.NewIdentifiedGenesisMetadata(id, metadata))
	}
	shared := lc.NewAppModule().ExportGenesis(ctx, encoding.Codec)
	bootstrap := map[string]any{"clients": clients, "consensuses": consensuses, "metadatas": metadatas, "shared_objects": json.RawMessage(shared), "operator": address}
	if lifecycle {
		connection := connectiontypes.NewConnectionEnd(connectiontypes.OPEN, lc.ModuleName+"-0", connectiontypes.NewCounterparty("07-tendermint-0", "connection-0", commitmenttypes.NewMerklePrefix([]byte("ibc"))), connectiontypes.GetCompatibleVersions(), 0)
		bootstrap["connection"] = connectiontypes.NewIdentifiedConnection("connection-0", connection)
		write(filepath.Join(dir, "headers.json"), headers)
	}
	write(filepath.Join(dir, "bootstrap.json"), bootstrap)
	write(filepath.Join(dir, "fixture.json"), f)
}

type boundedDriver struct {
	client          abcicli.Client
	encoding        injcodec.EncodingConfig
	key             *ethsecp256k1.PrivKey
	address         string
	height          int64
	now             time.Time
	validators      []abci.ValidatorUpdate
	output          string
	evidence        []map[string]any
	discardAttacker *ethsecp256k1.PrivKey
	discardAttempts uint32
	fullAdmission   bool
}

func (d *boundedDriver) as(key *ethsecp256k1.PrivKey, action func()) {
	previousKey, previousAddress := d.key, d.address
	d.key, d.address = key, sdk.AccAddress(key.PubKey().Address()).String()
	defer func() { d.key, d.address = previousKey, previousAddress }()
	action()
}

func (d *boundedDriver) query(path string, input, output interface {
	Marshal() ([]byte, error)
	Unmarshal([]byte) error
}) {
	raw, err := input.Marshal()
	must(err)
	response, err := d.client.Query(context.Background(), &abci.QueryRequest{Path: path, Data: raw})
	must(err)
	if response.Code != 0 {
		panic(fmt.Sprintf("%s: %s", path, response.Log))
	}
	must(output.Unmarshal(response.Value))
}
func (d *boundedDriver) state(id string) *lc.ClientState {
	q, err := d.client.Query(context.Background(), &abci.QueryRequest{Path: "/store/ibc/key", Data: []byte("clients/" + id + "/clientState")})
	must(err)
	if q.Code != 0 || len(q.Value) == 0 {
		panic(q.Log)
	}
	return clienttypes.MustUnmarshalClientState(d.encoding.Codec, q.Value).(*lc.ClientState)
}
func (d *boundedDriver) verification(cs *lc.ClientState, kind uint32, id []byte) map[string]json.RawMessage {
	request := &lc.QueryVerificationRequest{Namespace: cs.StorageNamespace, Generation: cs.VerificationGeneration, Kind: kind, SessionId: id}
	response := &lc.QueryVerificationResponse{}
	d.query("/ibc.lightclients.probabilistic.v1.Query/Verification", request, response)
	var value map[string]json.RawMessage
	must(json.Unmarshal(response.Data, &value))
	return value
}
func (d *boundedDriver) block(txs ...[]byte) *abci.FinalizeBlockResponse {
	d.height++
	d.now = d.now.Add(10 * time.Second)
	hash := sha256.Sum256([]byte(fmt.Sprintf("bounded-native-%d", d.height)))
	votes := []abci.VoteInfo{}
	for _, v := range d.validators {
		pub := v.PubKeyBytes
		h := sha256.Sum256(pub)
		votes = append(votes, abci.VoteInfo{Validator: abci.Validator{Address: h[:20], Power: v.Power}, BlockIdFlag: 2})
	}
	response, err := d.client.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: d.height, Time: d.now, Hash: hash[:], Txs: txs, DecidedLastCommit: abci.CommitInfo{Votes: votes}})
	must(err)
	_, err = d.client.Commit(context.Background(), &abci.CommitRequest{})
	must(err)
	if len(response.ValidatorUpdates) > 0 {
		d.validators = response.ValidatorUpdates
	}
	if d.height%500 == 0 {
		fmt.Printf("committed host height %d at %s\n", d.height, d.now.Format(time.RFC3339))
	}
	return response
}
func (d *boundedDriver) until(deadline uint64) {
	for uint64(d.now.UnixNano()) <= deadline+uint64(20*time.Second) {
		d.block()
	}
}
func (d *boundedDriver) sign(message sdk.Msg, gas uint64) []byte {
	request := &authtypes.QueryAccountRequest{Address: d.address}
	response := &authtypes.QueryAccountResponse{}
	d.query("/cosmos.auth.v1beta1.Query/Account", request, response)
	var account sdk.AccountI
	must(d.encoding.InterfaceRegistry.UnpackAny(response.Account, &account))
	builder := d.encoding.TxConfig.NewTxBuilder()
	must(builder.SetMsgs(message))
	builder.SetGasLimit(gas)
	builder.SetFeeAmount(sdk.NewCoins(sdk.NewCoin("inj", sdkmathInt(gas))))
	builder.SetMemo("Bounded Cardano verification on native Injective")
	sig := signing.SignatureV2{PubKey: d.key.PubKey(), Data: &signing.SingleSignatureData{SignMode: signing.SignMode_SIGN_MODE_DIRECT}, Sequence: account.GetSequence()}
	must(builder.SetSignatures(sig))
	signed, err := clienttx.SignWithPrivKey(context.Background(), signing.SignMode_SIGN_MODE_DIRECT, authsigning.SignerData{ChainID: "injective-777", AccountNumber: account.GetAccountNumber(), Sequence: account.GetSequence(), PubKey: d.key.PubKey()}, builder, d.key, d.encoding.TxConfig, account.GetSequence())
	must(err)
	must(builder.SetSignatures(signed))
	raw, err := d.encoding.TxConfig.TxEncoder()(builder.GetTx())
	must(err)
	return raw
}
func (d *boundedDriver) send(label string, message sdk.Msg) {
	preliminary := d.sign(message, 75000000)
	simulation := &sdk.SimulationResponse{}
	response, err := d.client.Query(context.Background(), &abci.QueryRequest{Path: "/app/simulate", Data: preliminary})
	must(err)
	if response.Code != 0 {
		panic(fmt.Sprintf("%s simulation: %s", label, response.Log))
	}
	must(d.encoding.Codec.UnmarshalJSON(response.Value, simulation))
	gas := uint64(math.Ceil(float64(simulation.GasInfo.GasUsed) * 1.8))
	if gas > 75000000 {
		panic(fmt.Sprintf("%s requires %d gas after multiplier", label, gas))
	}
	raw := d.sign(message, gas)
	if len(raw) > 900000 {
		panic(fmt.Sprintf("%s signed transaction is %d bytes", label, len(raw)))
	}
	checkType := abci.CHECK_TX_TYPE_RECHECK
	if d.fullAdmission {
		checkType = abci.CHECK_TX_TYPE_CHECK
	}
	check, err := d.client.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: raw, Type: checkType})
	must(err)
	record := map[string]any{"label": label, "signer": d.address, "signed_bytes": len(raw), "simulation_gas": simulation.GasInfo.GasUsed, "gas_wanted": gas, "check_tx": check}
	if check.Code == 0 {
		if d.fullAdmission {
			// A committed empty block resets admission state before ReCheckTx.
			d.block()
			recheck, err := d.client.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: raw, Type: abci.CHECK_TX_TYPE_RECHECK})
			must(err)
			record["recheck_tx"] = recheck
			if recheck.Code != 0 {
				panic(fmt.Sprintf("%s ReCheckTx failed: %s", label, recheck.Log))
			}
		}
		result := d.block(raw).TxResults[0]
		record["execution"] = result
		record["height"] = d.height
		record["time_unix_ns"] = d.now.UnixNano()
		d.evidence = append(d.evidence, record)
		write(d.output, d.evidence)
		if result.Code != 0 {
			panic(fmt.Sprintf("%s failed: %s", label, result.Log))
		}
		if result.GasUsed > 36000000 {
			panic(fmt.Sprintf("%s execution used %d gas", label, result.GasUsed))
		}
	} else {
		d.evidence = append(d.evidence, record)
		write(d.output, d.evidence)
		panic(fmt.Sprintf("%s CheckTx failed: %s", label, check.Log))
	}
	fmt.Printf("%s: %d signed bytes, %d simulation gas, %d requested gas\n", label, len(raw), simulation.GasInfo.GasUsed, gas)
}
func (d *boundedDriver) stage(id string, header *lc.ProbabilisticHeader, original []byte, label string) []byte {
	cs := d.state(id)
	steps, session, err := lc.BuildObservationPlan(cs, header, original, 4000, 1)
	must(err)
	for _, step := range steps {
		if step.ObservationChunk.Operation != 1 {
			progress := d.verification(d.state(id), 8, session)
			var sequence uint32
			must(json.Unmarshal(progress["Sequence"], &sequence))
			if step.ObservationChunk.Sequence <= sequence {
				continue
			}
		}
		message, err := clienttypes.NewMsgUpdateClient(id, step, d.address)
		must(err)
		if d.discardAttacker != nil && len(original) > 0 && step.ObservationChunk.Operation != 1 {
			d.rejectSessionDiscard(id, session)
		}
		d.send(fmt.Sprintf("%s-%d-%d", label, step.ObservationChunk.Operation, step.ObservationChunk.Sequence), message)
	}
	if d.discardAttacker != nil && len(original) > 0 {
		d.rejectSessionDiscard(id, session)
	}
	state := d.verification(d.state(id), 8, session)
	var receipt []byte
	must(json.Unmarshal(state["Receipt"], &receipt))
	return receipt
}
func (d *boundedDriver) activate(id string, session []byte, label string) {
	state := d.verification(d.state(id), 8, session)
	var sequence uint32
	must(json.Unmarshal(state["Sequence"], &sequence))
	message, err := clienttypes.NewMsgUpdateClient(id, &lc.ProbabilisticHeader{ObservationChunk: &lc.ObservationChunk{Operation: 7, SessionId: session, Sequence: sequence + 1}}, d.address)
	must(err)
	d.send(label, message)
}
func boundedRun(encoding injcodec.EncodingConfig, key *ethsecp256k1.PrivKey, address string) {
	dir := os.Args[2]
	genesis, err := genutiltypes.AppGenesisFromFile(filepath.Join(dir, "testnet/config/genesis.json"))
	must(err)
	must(genesis.ValidateAndComplete())
	client := abcicli.NewSocketClient("tcp://127.0.0.1:26658", true)
	must(client.Start())
	defer client.Stop()
	d := boundedDriver{client: client, encoding: encoding, key: key, address: address, now: genesis.GenesisTime, output: filepath.Join(dir, "bounded-transactions.json")}
	cp := genesis.Consensus.Params.ToProto()
	info, err := client.Info(context.Background(), &abci.InfoRequest{})
	must(err)
	if info.LastBlockHeight == 0 {
		initial, err := client.InitChain(context.Background(), &abci.InitChainRequest{Time: genesis.GenesisTime, ChainId: genesis.ChainID, InitialHeight: genesis.InitialHeight, ConsensusParams: &cp, AppStateBytes: genesis.AppState})
		must(err)
		d.validators = initial.Validators
		write(filepath.Join(dir, "validators.json"), d.validators)
		d.block()
	} else {
		d.height = info.LastBlockHeight
		progress, err := client.Query(context.Background(), &abci.QueryRequest{Path: "/store/" + lc.ModuleName + "/key", Data: []byte("snapshots/v2/host/continuity")})
		must(err)
		if len(progress.Value) == 48 {
			d.now = time.Unix(0, int64(binary.BigEndian.Uint64(progress.Value[8:16])))
		} else {
			d.now = genesis.GenesisTime.Add(time.Duration(d.height) * 10 * time.Second)
			d.block()
		}
		raw, err := os.ReadFile(filepath.Join(dir, "validators.json"))
		if err == nil {
			must(json.Unmarshal(raw, &d.validators))
		} else {
			validators := &stakingtypes.QueryValidatorsResponse{}
			d.query("/cosmos.staking.v1beta1.Query/Validators", &stakingtypes.QueryValidatorsRequest{Status: "BOND_STATUS_BONDED"}, validators)
			for _, validator := range validators.Validators {
				var key cryptotypes.PubKey
				must(d.encoding.InterfaceRegistry.UnpackAny(validator.ConsensusPubkey, &key))
				d.validators = append(d.validators, abci.ValidatorUpdate{PubKeyBytes: key.Bytes(), PubKeyType: "ed25519", Power: validator.ConsensusPower(sdk.DefaultPowerReduction)})
			}
			write(filepath.Join(dir, "validators.json"), d.validators)
		}
		if raw, err := os.ReadFile(d.output); err == nil {
			must(json.Unmarshal(raw, &d.evidence))
		}
		// Native BaseApp restores persistent stores before reconstructing the
		// current execution header. Commit one ordinary block before simulation.
		d.block()
	}
	if _, err := os.Stat(filepath.Join(dir, "bounded-lifecycle-result.json")); err == nil {
		state := d.state(lc.ModuleName + "-0")
		saved := &lc.ClientState{}
		raw, err := os.ReadFile(filepath.Join(dir, "final-state.json"))
		must(err)
		must(json.Unmarshal(raw, saved))
		current, err := state.Marshal()
		must(err)
		expected, err := saved.Marshal()
		must(err)
		if !bytesEqual(current, expected) {
			panic("restart changed client verification state")
		}
		d.checkPacketDelivery()
		write(filepath.Join(dir, "bounded-restart-result.json"), map[string]any{"persisted_client": true, "generation": state.VerificationGeneration, "packet_acknowledgements": true})
		return
	}
	if _, err := os.Stat(filepath.Join(dir, "bounded-result.json")); err == nil {
		if _, err := os.Stat(filepath.Join(dir, "headers.json")); err == nil {
			d.finishLifecycle(dir)
			return
		}
	}

	var f fixture
	raw, err := os.ReadFile(filepath.Join(dir, "fixture.json"))
	must(err)
	must(json.Unmarshal(raw, &f))
	id := lc.ModuleName + "-0"
	before := d.state(id)
	write(filepath.Join(dir, "initial-state.json"), before)
	host, err := client.Query(context.Background(), &abci.QueryRequest{Path: "/store/" + lc.ModuleName + "/key", Data: []byte("snapshots/v2/host/continuity")})
	must(err)
	if len(host.Value) != 48 {
		panic("host continuity hooks must be installed")
	}
	// Certified bootstrap has only its own commitment cutoff. A destination
	// interruption cannot introduce a separate twelve-hour host deadline.
	d.until(before.EpochContextChallenges[0].UsableAfterUnixNs)
	if raw, err := os.ReadFile(filepath.Join(dir, "headers.json")); err == nil {
		var headers map[string]*lc.ProbabilisticHeader
		must(json.Unmarshal(raw, &headers))
		d.sendPrepared(dir, "channel-init")
		d.sendPrepared(dir, "channel-ack")
		d.forward(id, headers["baseline"], "baseline-subject")
		d.forward(lc.ModuleName+"-1", headers["baseline"], "baseline-control")
		d.sendPrepared(dir, "recv-packet-967-1")
		before = d.state(id)
	}
	receipt := d.stage(id, f.Header, nil, "proposal")
	_, session, err := lc.BuildObservationPlan(d.state(id), f.Header, nil, 4000, 1)
	must(err)
	d.activate(id, session, "activate-proposal")
	proposed := d.state(id)
	write(filepath.Join(dir, "proposal-state.json"), proposed)
	if !bytesEqual(before.CheckpointReference, proposed.CheckpointReference) {
		panic("proposal advanced checkpoint before deadline")
	}
	var abandonedSession []byte
	if _, err := os.Stat(filepath.Join(dir, "test-session-discard")); err == nil {
		attackerBytes := sha256.Sum256([]byte("cardano-ibc/injective-release/session-discard-attacker"))
		d.discardAttacker = &ethsecp256k1.PrivKey{Key: attackerBytes[:]}
		attackerAddress := sdk.AccAddress(d.discardAttacker.PubKey().Address()).String()
		if attackerAddress == d.address {
			panic("session discard test requires two distinct accounts")
		}
		d.send("fund-discard-attacker", banktypes.NewMsgSend(sdk.MustAccAddressFromBech32(d.address), sdk.MustAccAddressFromBech32(attackerAddress), sdk.NewCoins(sdk.NewCoin("inj", sdkmath.NewIntWithDecimal(100, 18)))))
		control := lc.ModuleName + "-1"
		steps, session, err := lc.BuildObservationPlan(d.state(control), f.Header, nil, 4000, 1)
		must(err)
		abandonedSession = session
		for _, step := range steps[:2] {
			message, err := clienttypes.NewMsgUpdateClient(control, step, d.address)
			must(err)
			d.send("abandoned-session-start", message)
		}
		progress, err := json.Marshal(d.verification(d.state(control), 8, session))
		must(err)
		d.as(d.discardAttacker, func() {
			d.send("cleanup-preserves-active-session", &lc.MsgContinueClient{ClientId: control, Signer: d.address, Operation: 9})
		})
		retained, err := json.Marshal(d.verification(d.state(control), 8, session))
		must(err)
		if !bytesEqual(progress, retained) {
			panic("permissionless cleanup changed an active session")
		}
	}
	alternative := d.stage(id, f.Fork, receipt, "alternative")
	evidence := &lc.Misbehaviour{ClientId: id, VerifiedObservation_1: receipt, VerifiedObservation_2: alternative}
	message, err := clienttypes.NewMsgSubmitMisbehaviour(id, evidence, address)
	must(err)
	d.send("freeze", message)
	frozen := d.state(id)
	write(filepath.Join(dir, "frozen-state.json"), frozen)
	if frozen.FrozenHeight == nil || frozen.FrozenHeight.IsZero() {
		panic("freeze did not commit")
	}
	deadline := uint64(0)
	for _, c := range proposed.EpochContextChallenges {
		if c.Epoch > proposed.CurrentEpoch {
			deadline = c.UsableAfterUnixNs
		}
	}
	if uint64(d.now.UnixNano()) >= deadline {
		panic("challenge missed response deadline")
	}
	write(filepath.Join(dir, "bounded-result.json"), map[string]any{"accepted_proposal": true, "freeze_committed": true, "freeze_before_deadline": true, "deadline": deadline, "freeze_time": d.now.UnixNano(), "client_bytes": frozen.Size(), "generation": frozen.VerificationGeneration, "controlled_host_clock": true})
	if d.discardAttacker != nil {
		if d.discardAttempts == 0 {
			panic("session discard test did not attempt an attack")
		}
		freezeTime := d.now.UnixNano()
		_, challengeSession, err := lc.BuildObservationPlan(proposed, f.Fork, receipt, 4000, 1)
		must(err)
		d.checkExpiredSessionCleanup(id, challengeSession, abandonedSession)
		write(filepath.Join(dir, "bounded-session-discard-result.json"), map[string]any{"challenger": address, "attacker": sdk.AccAddress(d.discardAttacker.PubKey().Address()).String(), "rejected_discards": d.discardAttempts, "honest_challenge_completed": true, "freeze_committed": true, "freeze_before_deadline": freezeTime < int64(deadline), "freeze_time": freezeTime, "deadline": deadline, "expired_discard": true, "expired_cleanup": true, "active_cleanup_preserved_progress": true, "controlled_host_clock": true})
	}
	if _, err := os.Stat(filepath.Join(dir, "headers.json")); err == nil {
		d.finishLifecycle(dir)
	}
}
func bytesEqual(a, b []byte) bool { return string(a) == string(b) }

func sdkmathInt(gas uint64) sdkmath.Int { return sdkmath.NewIntFromUint64(gas).MulRaw(500000000) }

func boundedServe() {
	home := os.Args[2]
	opts := viper.New()
	opts.SetConfigFile(filepath.Join(home, "config/app.toml"))
	must(opts.ReadInConfig())
	opts.Set("home", home)
	opts.Set("minimum-gas-prices", "500000000inj")
	opts.Set("chain-id", "injective-777")
	database, err := dbm.NewDB("application", dbm.GoLevelDBBackend, filepath.Join(home, "data"))
	must(err)
	application := app.NewInjectiveApp(log.NewNopLogger(), database, nil, true, opts, baseapp.SetChainID("injective-777"))
	server, err := abciserver.NewServer("tcp://0.0.0.0:26658", "socket", sdkserver.NewCometABCIWrapper(application))
	must(err)
	must(server.Start())
	fmt.Println("native Injective application ABCI server ready")
	select {}
}

func (d *boundedDriver) sendPrepared(dir, name string) {
	raw, err := os.ReadFile(filepath.Join(dir, name+".json"))
	must(err)
	tx, err := d.encoding.TxConfig.TxJSONDecoder()(raw)
	must(err)
	if len(tx.GetMsgs()) != 1 {
		panic("expected one prepared lifecycle message")
	}
	if packet, ok := tx.GetMsgs()[0].(*channeltypes.MsgRecvPacket); ok {
		receipt := &channeltypes.QueryPacketReceiptResponse{}
		d.query("/ibc.core.channel.v1.Query/PacketReceipt", &channeltypes.QueryPacketReceiptRequest{PortId: packet.Packet.DestinationPort, ChannelId: packet.Packet.DestinationChannel, Sequence: packet.Packet.Sequence}, receipt)
		if receipt.Received {
			fmt.Println(name + ": already committed before restart")
			return
		}
	}
	d.send(name, tx.GetMsgs()[0])
}
func (d *boundedDriver) forward(id string, header *lc.ProbabilisticHeader, label string) {
	if d.state(id).LatestCheckpointHeight.RevisionHeight >= header.AnchorBlock.Height.RevisionHeight {
		return
	}
	d.stage(id, header, nil, label)
	_, session, err := lc.BuildObservationPlan(d.state(id), header, nil, 4000, 1)
	must(err)
	d.activate(id, session, label+"-activate")
	current := d.state(id)
	if current.LatestCheckpointHeight.RevisionHeight < header.AnchorBlock.Height.RevisionHeight {
		var deadline uint64
		for _, context := range current.EpochContextChallenges {
			deadline = max(deadline, context.UsableAfterUnixNs)
		}
		d.until(deadline)
		d.activate(id, session, label+"-after-window")
	}
}
func (d *boundedDriver) finishLifecycle(dir string) {
	var headers map[string]*lc.ProbabilisticHeader
	raw, err := os.ReadFile(filepath.Join(dir, "headers.json"))
	must(err)
	must(json.Unmarshal(raw, &headers))
	subject, substitute := lc.ModuleName+"-0", lc.ModuleName+"-1"
	recovered := d.state(subject)
	if recovered.VerificationGeneration == 1 {
		d.rejectPrepared(dir, "recv-packet-1032-2", "frozen", "frozen-packet")
		unauthorized := clienttypes.NewMsgRecoverClient(d.address, subject, substitute)
		d.reject("unauthorized-recovery", unauthorized, "unauthorized")
		d.forward(substitute, headers["honest"], "honest-substitute")
		d.forward(substitute, headers["replacement"], "replacement")
		recovery := clienttypes.NewMsgRecoverClient(authtypes.NewModuleAddress("gov").String(), subject, substitute)
		deposit, err := sdk.ParseCoinsNormalized("500000000000000000001inj")
		must(err)
		proposal, err := govtypes.NewMsgSubmitProposal([]sdk.Msg{recovery}, deposit, d.address, "", "Recover compact Cardano client", "Native Injective resource regression", true)
		must(err)
		d.send("governance-recovery", proposal)
		d.send("vote-recovery", govtypes.NewMsgVote(sdk.MustAccAddressFromBech32(d.address), 1, govtypes.OptionYes, ""))
		d.until(uint64(d.now.Add(310 * time.Second).UnixNano()))
		recovered = d.state(subject)
		if recovered.FrozenHeight != nil && !recovered.FrozenHeight.IsZero() {
			d.send("complete-authorized-recovery", &lc.MsgContinueClient{ClientId: subject, Signer: d.address, Operation: 12})
			recovered = d.state(subject)
		}
		if recovered.VerificationGeneration != 2 {
			panic("authorized recovery did not advance generation")
		}
		write(filepath.Join(dir, "recovered-state.json"), recovered)
		d.rejectPrepared(dir, "recv-packet-1032-2", "pending", "early-recovery-packet")
	}
	var deadline uint64
	for _, context := range recovered.EpochContextChallenges {
		deadline = max(deadline, context.UsableAfterUnixNs)
	}
	d.until(deadline)
	d.rejectPrepared(dir, "recv-packet-1001-2", "consensus", "discarded-generation-packet")
	d.sendPrepared(dir, "recv-packet-1032-2")
	d.forward(subject, headers["ordinary"], "ordinary")
	d.sendPrepared(dir, "recv-packet-1063-3")
	d.checkPacketDelivery()
	write(filepath.Join(dir, "final-state.json"), d.state(subject))
	write(filepath.Join(dir, "bounded-lifecycle-result.json"), map[string]any{"authorized_recovery": true, "generation": recovered.VerificationGeneration, "subsequent_packets": true, "controlled_host_clock": true})
}

func (d *boundedDriver) reject(label string, message sdk.Msg, expected string) {
	d.rejectTransaction(label, message, expected, false)
}

func (d *boundedDriver) rejectTransaction(label string, message sdk.Msg, expected string, deliver bool) {
	before, err := d.state(lc.ModuleName + "-0").Marshal()
	must(err)
	raw := d.sign(message, 75000000)
	check, err := d.client.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: raw, Type: 2})
	must(err)
	record := map[string]any{"label": label, "signer": d.address, "signed_bytes": len(raw), "check_tx": check, "expected_rejection": expected}
	text := check.Log
	if check.Code == 0 || deliver {
		result := d.block(raw).TxResults[0]
		record["execution"] = result
		record["height"] = d.height
		record["time_unix_ns"] = d.now.UnixNano()
		text = result.Log
		if result.Code == 0 {
			panic(label + " unexpectedly succeeded")
		}
	}
	if !strings.Contains(strings.ToLower(text), expected) {
		panic(label + ": " + text)
	}
	after, err := d.state(lc.ModuleName + "-0").Marshal()
	must(err)
	if !bytesEqual(before, after) {
		panic(label + " changed client state")
	}
	d.evidence = append(d.evidence, record)
	write(d.output, d.evidence)
	fmt.Println(label + ": expected rejection")
}

func (d *boundedDriver) rejectSessionDiscard(id string, session []byte) {
	progress := d.verification(d.state(id), 8, session)
	before, err := json.Marshal(progress)
	must(err)
	var sequence uint32
	must(json.Unmarshal(progress["Sequence"], &sequence))
	d.as(d.discardAttacker, func() {
		message, err := clienttypes.NewMsgUpdateClient(id, &lc.ProbabilisticHeader{ObservationChunk: &lc.ObservationChunk{Operation: 8, SessionId: session, Sequence: sequence + 1}}, d.address)
		must(err)
		d.rejectTransaction(fmt.Sprintf("reject-active-session-discard-%d", sequence), message, "live observation", true)
	})
	after, err := json.Marshal(d.verification(d.state(id), 8, session))
	must(err)
	if !bytesEqual(before, after) {
		panic("rejected discard changed the challenger's persisted progress")
	}
	d.discardAttempts++
}

func (d *boundedDriver) requireSessionMissing(id string, session []byte) {
	cs := d.state(id)
	request := &lc.QueryVerificationRequest{Namespace: cs.StorageNamespace, Generation: cs.VerificationGeneration, Kind: 8, SessionId: session}
	raw, err := request.Marshal()
	must(err)
	response, err := d.client.Query(context.Background(), &abci.QueryRequest{Path: "/ibc.lightclients.probabilistic.v1.Query/Verification", Data: raw})
	must(err)
	if response.Code == 0 || !strings.Contains(response.Log, "observation session is missing") {
		panic("expired session was not removed: " + response.Log)
	}
}

func (d *boundedDriver) checkExpiredSessionCleanup(id string, challengeSession, abandonedSession []byte) {
	control := lc.ModuleName + "-1"
	challenge := d.verification(d.state(id), 8, challengeSession)
	abandoned := d.verification(d.state(control), 8, abandonedSession)
	var challengeExpiry, abandonedExpiry uint64
	var sequence uint32
	must(json.Unmarshal(challenge["ExpiresAt"], &challengeExpiry))
	must(json.Unmarshal(abandoned["ExpiresAt"], &abandonedExpiry))
	must(json.Unmarshal(abandoned["Sequence"], &sequence))
	d.until(max(challengeExpiry, abandonedExpiry))
	d.as(d.discardAttacker, func() {
		message, err := clienttypes.NewMsgUpdateClient(control, &lc.ProbabilisticHeader{ObservationChunk: &lc.ObservationChunk{Operation: 8, SessionId: abandonedSession, Sequence: sequence + 1}}, d.address)
		must(err)
		d.send("discard-expired-abandoned-session", message)
		d.send("cleanup-expired-challenge-session", &lc.MsgContinueClient{ClientId: id, Signer: d.address, Operation: 9})
	})
	d.requireSessionMissing(control, abandonedSession)
	d.requireSessionMissing(id, challengeSession)
}
func (d *boundedDriver) rejectPrepared(dir, name, expected, label string) {
	raw, err := os.ReadFile(filepath.Join(dir, name+".json"))
	must(err)
	tx, err := d.encoding.TxConfig.TxJSONDecoder()(raw)
	must(err)
	message := tx.GetMsgs()[0]
	if label == "discarded-generation-packet" {
		// Height 967 was genuinely accepted before the dispute. Use an unreceived
		// sequence so the IBC redundancy decorator cannot skip its proof check.
		packet := message.(*channeltypes.MsgRecvPacket)
		packet.ProofHeight = clienttypes.NewHeight(0, 967)
		packet.Packet.Sequence = 4
	}
	d.reject(label, message, expected)
}
func (d *boundedDriver) checkPacketDelivery() {
	balances := &banktypes.QueryAllBalancesResponse{}
	d.query("/cosmos.bank.v1beta1.Query/AllBalances", &banktypes.QueryAllBalancesRequest{Address: d.address}, balances)
	total := sdkmath.ZeroInt()
	for _, coin := range balances.Balances {
		if strings.HasPrefix(coin.Denom, "ibc/") {
			total = total.Add(coin.Amount)
		}
	}
	if !total.Equal(sdkmath.NewInt(300)) {
		panic(fmt.Sprintf("expected 300 voucher units, got %s", total))
	}
	expected := sha256.Sum256([]byte(`{"result":"AQ=="}`))
	for sequence := uint64(1); sequence <= 3; sequence++ {
		acknowledgement := &channeltypes.QueryPacketAcknowledgementResponse{}
		d.query("/ibc.core.channel.v1.Query/PacketAcknowledgement", &channeltypes.QueryPacketAcknowledgementRequest{PortId: "transfer", ChannelId: "channel-0", Sequence: sequence}, acknowledgement)
		if !bytesEqual(acknowledgement.Acknowledgement, expected[:]) {
			panic("missing successful packet acknowledgement")
		}
	}
}
