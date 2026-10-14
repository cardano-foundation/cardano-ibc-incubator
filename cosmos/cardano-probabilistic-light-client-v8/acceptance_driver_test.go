package probabilistic

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"cosmossdk.io/log"
	"github.com/cosmos/cosmos-sdk/baseapp"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
	dbm "github.com/cosmos/cosmos-db"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	transfer "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"

	rpcclient "github.com/cometbft/cometbft/rpc/client"
	"github.com/cosmos/ibc-go/v8/testing/simapp"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

type acceptanceDriver struct {
	t      *testing.T
	config acceptanceHostConfig
	rpc    *rpchttp.HTTP
	conn   *grpc.ClientConn
	app    *simapp.SimApp // Codecs only. All state queries and mutations go over the wire.
	seed   string
}

func newAcceptanceDriver(t *testing.T, config acceptanceHostConfig, seed string) *acceptanceDriver {
	t.Helper()
	rpc, err := rpchttp.NewWithTimeout("http://"+config.RPC, "/websocket", 10)
	require.NoError(t, err)
	conn, err := grpc.NewClient(config.GRPC, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(16*1024*1024)))
	require.NoError(t, err)
	app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.EmptyAppOptions{}, baseapp.SetChainID(acceptanceChainID))
	registerCapacityClient(app)
	t.Cleanup(func() { require.NoError(t, conn.Close()); require.NoError(t, app.Close()) })
	return &acceptanceDriver{t, config, rpc, conn, app, seed}
}
func (d *acceptanceDriver) safeHeight() int64 {
	d.t.Helper()
	status, err := d.rpc.Status(context.Background())
	require.NoError(d.t, err)
	require.Greater(d.t, status.SyncInfo.LatestBlockHeight, int64(1))
	return status.SyncInfo.LatestBlockHeight - 1
}
func (d *acceptanceDriver) queryContext() context.Context {
	return metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-cosmos-block-height", fmt.Sprint(d.safeHeight())))
}
func (d *acceptanceDriver) query(path string, key []byte) []byte {
	d.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r, err := d.rpc.ABCIQueryWithOptions(ctx, path, key, rpcclient.ABCIQueryOptions{Height: d.safeHeight()})
	require.NoError(d.t, err)
	require.Zero(d.t, r.Response.Code, r.Response.Log)
	return r.Response.Value
}
func (d *acceptanceDriver) store(key string) []byte { return d.query("/store/ibc/key", []byte(key)) }
func (d *acceptanceDriver) state(id string) *ClientState {
	d.t.Helper()
	raw := d.store("clients/" + id + "/clientState")
	state := clienttypes.MustUnmarshalClientState(d.app.AppCodec(), raw)
	return state.(*ClientState)
}
func (d *acceptanceDriver) send(msg sdk.Msg, wantError string) *coretypes.ResultTx {
	d.t.Helper()
	ctx, cancel := context.WithTimeout(d.queryContext(), 25*time.Second)
	defer cancel()
	response, err := authtypes.NewQueryClient(d.conn).Account(ctx, &authtypes.QueryAccountRequest{Address: acceptanceAddress(d.seed).String()})
	require.NoError(d.t, err)
	var account sdk.AccountI
	require.NoError(d.t, d.app.AppCodec().UnpackAny(response.Account, &account))
	tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), d.app.TxConfig(), []sdk.Msg{msg}, sdk.NewCoins(sdk.NewInt64Coin("stake", 1_500_000)), 600_000_000, acceptanceChainID, []uint64{account.GetAccountNumber()}, []uint64{account.GetSequence()}, acceptanceKey(d.seed))
	require.NoError(d.t, err)
	wire, err := d.app.TxConfig().TxEncoder()(tx)
	require.NoError(d.t, err)
	require.Less(d.t, len(wire), 8*1024*1024)
	broadcast, err := txtypes.NewServiceClient(d.conn).BroadcastTx(ctx, &txtypes.BroadcastTxRequest{TxBytes: wire, Mode: txtypes.BroadcastMode_BROADCAST_MODE_SYNC})
	require.NoError(d.t, err)
	if broadcast.TxResponse.Code != 0 {
		require.NotEmpty(d.t, wantError, broadcast.TxResponse.RawLog)
		require.Contains(d.t, strings.ToLower(broadcast.TxResponse.RawLog), strings.ToLower(wantError))
		return nil
	}
	var committed *coretypes.ResultTx
	require.Eventually(d.t, func() bool {
		r, e := d.rpc.Tx(ctx, cmttypes.Tx(wire).Hash(), false)
		if e != nil {
			return false
		}
		committed = r
		return true
	}, 20*time.Second, 50*time.Millisecond)
	if wantError == "" {
		require.Zero(d.t, committed.TxResult.Code, committed.TxResult.Log)
	} else {
		require.NotZero(d.t, committed.TxResult.Code)
		require.Contains(d.t, strings.ToLower(committed.TxResult.Log), strings.ToLower(wantError))
	}
	require.LessOrEqual(d.t, committed.TxResult.GasUsed, int64(600_000_000))
	require.Eventually(d.t, func() bool {
		status, e := d.rpc.Status(ctx)
		return e == nil && status.SyncInfo.LatestBlockHeight > committed.Height
	}, 5*time.Second, 25*time.Millisecond)
	d.t.Logf("committed %T height=%d gas=%d code=%d", msg, committed.Height, committed.TxResult.GasUsed, committed.TxResult.Code)
	return committed
}
func (d *acceptanceDriver) update(id string, h *ProbabilisticHeader) {
	d.t.Helper()
	msg, err := clienttypes.NewMsgUpdateClient(id, h, acceptanceAddress(d.seed).String())
	require.NoError(d.t, err)
	d.send(msg, "")
}
func (d *acceptanceDriver) balance(address, denom string) string {
	d.t.Helper()
	r, err := banktypes.NewQueryClient(d.conn).Balance(d.queryContext(), &banktypes.QueryBalanceRequest{Address: address, Denom: denom})
	require.NoError(d.t, err)
	return r.Balance.Amount.String()
}
func (d *acceptanceDriver) blockTime(height int64) uint64 {
	d.t.Helper()
	r, err := d.rpc.Block(context.Background(), &height)
	require.NoError(d.t, err)
	return uint64(r.Block.Time.UnixNano())
}
func (d *acceptanceDriver) waitDeadline(deadline uint64) {
	d.t.Helper()
	d.t.Logf("waiting for committed host time >= %s", time.Unix(0, int64(deadline)).UTC())
	lastLog := time.Now()
	require.Eventually(d.t, func() bool {
		status, err := d.rpc.Status(context.Background())
		if err != nil {
			return false
		}
		if time.Since(lastLog) > 25*time.Second {
			d.t.Logf("host height=%d, deadline in %s", status.SyncInfo.LatestBlockHeight, time.Until(time.Unix(0, int64(deadline))).Round(time.Second))
			lastLog = time.Now()
		}
		return uint64(status.SyncInfo.LatestBlockTime.UnixNano()) >= deadline
	}, 4*time.Minute, 500*time.Millisecond)
}
func acceptanceDeadline(t *testing.T, state *ClientState, epoch uint64) uint64 {
	t.Helper()
	for _, c := range state.EpochContextChallenges {
		if c.Epoch == epoch {
			return c.UsableAfterUnixNs
		}
	}
	t.Fatalf("no epoch %d deadline", epoch)
	return 0
}
func acceptanceProcess(t *testing.T, testName, envName, file, logFile string) *exec.Cmd {
	t.Helper()
	log, err := os.OpenFile(logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	require.NoError(t, err)
	t.Cleanup(func() { _ = log.Close() })
	command := exec.Command(os.Args[0], "-test.run=^"+testName+"$", "-test.v", "-test.timeout=20m")
	command.Env = append(os.Environ(), envName+"="+file)
	command.Stdout, command.Stderr = log, log
	require.NoError(t, command.Start())
	return command
}
func acceptanceStartHost(t *testing.T, config acceptanceHostConfig, file string) func() {
	t.Helper()
	_ = os.Remove(filepath.Join(config.Root, "ready"))
	command := acceptanceProcess(t, "TestCaribicAcceptanceHost", "CARIBIC_ACCEPTANCE_HOST", file, filepath.Join(config.Root, "host.log"))
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		require.NoError(t, command.Process.Signal(syscall.SIGTERM))
		select {
		case err := <-done:
			require.NoError(t, err)
		case <-time.After(20 * time.Second):
			_ = command.Process.Kill()
			t.Fatal("host did not stop cleanly")
		}
	}
	t.Cleanup(func() {
		if !stopped {
			stop()
		}
	})
	require.Eventually(t, func() bool {
		select {
		case err := <-done:
			raw, _ := os.ReadFile(filepath.Join(config.Root, "host.log"))
			t.Fatalf("host exited: %v\n%s", err, raw)
		default:
		}
		_, err := os.Stat(filepath.Join(config.Root, "ready"))
		return err == nil
	}, 25*time.Second, 100*time.Millisecond)
	return stop
}

// Snapshots follow the recovery script: route ends, counters, commitments,
// receipts, acknowledgements, denomination identity and exact bank balances.
func (d *acceptanceDriver) applicationSnapshot() map[string]string {
	result := map[string]string{"subject": acceptanceSubject, "connection": "connection-0", "channel": "channel-0", "denomination": transfer.ParseDenomTrace("transfer/channel-0/lovelace").IBCDenom()}
	for _, prefix := range []string{"connections/", "channelEnds/", "nextSequenceSend/", "nextSequenceRecv/", "nextSequenceAck/", "commitments/", "receipts/", "acks/"} {
		result[prefix] = hex.EncodeToString(d.query("/store/ibc/subspace", []byte(prefix)))
	}
	denom := transfer.ParseDenomTrace("transfer/channel-0/lovelace").IBCDenom()
	result["voucher"] = d.balance(acceptanceAddress("operator").String(), denom)
	result["sender"] = d.balance(acceptanceAddress("operator").String(), "utest")
	result["escrow"] = d.balance(transfer.GetEscrowAddress("transfer", "channel-0").String(), "utest")
	trace, err := transfer.NewQueryClient(d.conn).DenomTrace(d.queryContext(), &transfer.QueryDenomTraceRequest{Hash: strings.TrimPrefix(denom, "ibc/")})
	require.NoError(d.t, err)
	result["trace"] = trace.DenomTrace.GetFullDenomPath()
	return result
}

// The SDK's localhost client advances every block. Snapshot all probabilistic
// client data and the route's application state so unrelated host bookkeeping
// does not conceal or falsely report a recovery mutation.
func (d *acceptanceDriver) recoverySnapshot() map[string]string {
	result := d.applicationSnapshot()
	for _, prefix := range []string{"clients/" + ModuleName + "-", "nextClientSequence", "nextConnectionSequence", "nextChannelSequence", "params"} {
		result[prefix] = hex.EncodeToString(d.query("/store/ibc/subspace", []byte(prefix)))
	}
	return result
}

func acceptanceReceive(t *testing.T, d *acceptanceDriver, count, sequence, height uint64, wantError string) {
	t.Helper()
	proof, _ := acceptanceProof(t, acceptanceLaneValues(t, count), acceptanceCommitmentKey(sequence))
	d.send(channeltypes.NewMsgRecvPacket(acceptancePacket(sequence), proof, clienttypes.NewHeight(0, height), acceptanceAddress(d.seed).String()), wantError)
}
func acceptanceTimeout(t *testing.T, d *acceptanceDriver, count, height uint64, packet channeltypes.Packet, wantError string) {
	t.Helper()
	proof, _ := acceptanceProof(t, acceptanceLaneValues(t, count), "receipts/ports/transfer/channels/channel-0/sequences/1")
	d.send(channeltypes.NewMsgTimeout(packet, 1, proof, clienttypes.NewHeight(0, height), acceptanceAddress(d.seed).String()), wantError)
}
func acceptanceEscrow(t *testing.T, h *ProbabilisticHeader) uint64 {
	t.Helper()
	b, err := core.DecodeLedgerBlock(h.AnchorBlock.BlockCbor)
	require.NoError(t, err)
	return b.Transactions()[0].Outputs()[2].Amount().Uint64()
}

func TestCaribicV8ChallengeRecovery(t *testing.T) {
	if os.Getenv("CARIBIC_V8_ACCEPTANCE") != "1" {
		t.Skip("run with caribic test --light-client challenge-recovery --network v8-classic")
	}
	root := os.Getenv("CARIBIC_ACCEPTANCE_ARTIFACTS")
	require.NotEmpty(t, root)
	require.NoError(t, os.MkdirAll(root, 0700))
	history := acceptanceSource(t, root)
	config := acceptanceHostConfig{Root: filepath.Join(root, "host"), RPC: spareAddress(t), P2P: spareAddress(t), GRPC: spareAddress(t), History: filepath.Join(root, "source-history.json")}
	require.NoError(t, os.MkdirAll(config.Root, 0700))
	configFile := filepath.Join(root, "host.json")
	acceptanceWriteJSON(t, configFile, config)
	stopHost := acceptanceStartHost(t, config, configFile)
	d := newAcceptanceDriver(t, config, "operator")
	signer := acceptanceAddress("operator").String()
	require.Equal(t, "1000", d.balance(signer, "utest"))
	d.waitDeadline(acceptanceDeadline(t, d.state(acceptanceSubject), 7))
	d.send(channeltypes.NewMsgChannelOpenInit("transfer", "ics20-1", channeltypes.UNORDERED, []string{"connection-0"}, "transfer", signer), "")
	proof, _ := acceptanceProof(t, acceptanceChannelValues(t), "channelEnds/ports/transfer/channels/channel-0")
	d.send(channeltypes.NewMsgChannelOpenAck("transfer", "channel-0", "channel-0", "ics20-1", proof, clienttypes.NewHeight(0, 966), signer), "")
	baseline := acceptanceHeader(t, history, "honest", 966, 967)
	d.update(acceptanceSubject, baseline)
	d.update(acceptanceControl, baseline)
	acceptanceReceive(t, d, 1, 1, 967, "")
	denom := transfer.ParseDenomTrace("transfer/channel-0/lovelace").IBCDenom()
	require.Equal(t, "100", d.balance(signer, denom))
	require.Equal(t, uint64(100), acceptanceEscrow(t, baseline))
	outgoingData := transfer.NewFungibleTokenPacketData("utest", "7", signer, "cardano-local-receiver", "").GetBytes()
	pending := channeltypes.NewPacket(outgoingData, 1, "transfer", "channel-0", "transfer", "channel-0", clienttypes.NewHeight(0, 1000), 0)
	d.send(transfer.NewMsgTransfer("transfer", "channel-0", sdk.NewInt64Coin("utest", 7), signer, "cardano-local-receiver", clienttypes.NewHeight(0, 1000), 0, ""), "")
	require.Equal(t, channeltypes.CommitPacket(nil, pending), d.store("commitments/ports/transfer/channels/channel-0/sequences/1"))
	require.Equal(t, "993", d.balance(signer, "utest"))
	require.Equal(t, "7", d.balance(transfer.GetEscrowAddress("transfer", "channel-0").String(), "utest"))
	before := d.applicationSnapshot()
	acceptanceWriteJSON(t, filepath.Join(root, "route-before.json"), before)
	proposal := acceptanceHeader(t, history, "bad", 967, 1001)
	d.update(acceptanceSubject, proposal)
	honestProposal := acceptanceHeader(t, history, "honest", 967, 1001)
	d.update(acceptanceControl, honestProposal)
	deadline := acceptanceDeadline(t, d.state(acceptanceSubject), 8)
	// Native evidence negative controls share the same healthy destination client.
	invalid := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(honestProposal))
	invalid.AnchorBlock.Hash = strings.Repeat("00", 32)
	msg, err := clienttypes.NewMsgSubmitMisbehaviour(acceptanceControl, NewMisbehaviour(acceptanceControl, honestProposal, invalid), signer)
	require.NoError(t, err)
	d.send(msg, "hash")
	table := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(honestProposal))
	table.NewEpochContext.StakeDistribution[11].Stake--
	table.NewEpochContext.StakeDistribution[12].Stake++
	for _, entry := range table.NewEpochContext.StakeDistribution {
		entry.RelativeStakeNumerator = entry.Stake
	}
	msg, err = clienttypes.NewMsgSubmitMisbehaviour(acceptanceControl, NewMisbehaviour(acceptanceControl, honestProposal, table), signer)
	require.NoError(t, err)
	d.send(msg, "do not conflict")
	msg, err = clienttypes.NewMsgSubmitMisbehaviour(acceptanceControl, NewMisbehaviour(acceptanceControl, honestProposal, acceptanceHeader(t, history, "tail", 967, 1001)), signer)
	require.NoError(t, err)
	d.send(msg, "do not conflict")
	require.True(t, d.state(acceptanceControl).FrozenHeight.IsZero())
	// A new process starts after inclusion with no proposal message in memory.
	witnessFile := filepath.Join(root, "independent-fork.json")
	acceptanceWriteJSON(t, witnessFile, honestProposal)
	watcherFile := filepath.Join(root, "watcher.json")
	watcher := acceptanceWatcherConfig{Host: config, Client: acceptanceSubject, Witness: witnessFile, Cursor: filepath.Join(root, "watcher-cursor.json"), Challenge: true}
	acceptanceWriteJSON(t, watcherFile, watcher)
	command := acceptanceProcess(t, "TestCaribicAcceptanceWatcher", "CARIBIC_ACCEPTANCE_WATCHER", watcherFile, filepath.Join(root, "watcher.log"))
	require.NoError(t, command.Wait())
	var cursor acceptanceWatcherCursor
	acceptanceReadJSON(t, watcher.Cursor, &cursor)
	require.Less(t, cursor.ChallengeCommittedUnixNs, deadline)
	require.NotZero(t, cursor.ProposalCommittedUnixNs)
	require.Equal(t, deadline, cursor.ProposalCommittedUnixNs+uint64(3*time.Minute))
	require.False(t, d.state(acceptanceSubject).FrozenHeight.IsZero())
	require.Equal(t, before, d.applicationSnapshot())
	acceptanceReceive(t, d, 2, 2, 1001, "frozen")
	acceptanceTimeout(t, d, 2, 1001, pending, "frozen")
	// Authenticate the valid replacement through ordinary client transactions.
	substituteBootstrap := fromCoreClientState(toCoreClientState(d.state(acceptanceControl)))
	substituteBootstrap.OperationalCertificateCounterHistoryStartHeight = substituteBootstrap.LatestCheckpointHeight
	substituteConsensus := clienttypes.MustUnmarshalConsensusState(d.app.AppCodec(), d.store("clients/"+acceptanceControl+"/consensusStates/0-1001"))
	create, err := clienttypes.NewMsgCreateClient(substituteBootstrap, substituteConsensus, signer)
	require.NoError(t, err)
	d.send(create, "")
	replacement := acceptanceHeader(t, history, "honest", 1001, 1032)
	d.update(acceptanceSubstitute, replacement)
	d.waitDeadline(max(deadline, acceptanceDeadline(t, d.state(acceptanceSubstitute), 8)))
	acceptanceReceive(t, d, 2, 2, 1001, "frozen")
	acceptanceTimeout(t, d, 2, 1001, pending, "frozen")
	require.Equal(t, before, d.applicationSnapshot())
	// Prove the same proof bytes are usable by an active client in a separate
	// diagnostic store. Production packet attempts above still traverse the keeper.
	proof, _ = acceptanceProof(t, acceptanceLaneValues(t, 2), acceptanceCommitmentKey(2))
	diagnosticCtx, diagnosticStore := newProbabilisticTestClientStore(t, "active-proof-control")
	diagnosticCodec := newProbabilisticTestCodec()
	consensus := clienttypes.MustUnmarshalConsensusState(d.app.AppCodec(), d.store("clients/"+acceptanceSubstitute+"/consensusStates/0-1032")).(*ConsensusState)
	setConsensusState(diagnosticStore, diagnosticCodec, consensus, NewHeight(0, 1032))
	processedTime := binary.BigEndian.Uint64(d.store("clients/" + acceptanceSubstitute + "/consensusStates/0-1032/processedTime"))
	processedHeight, err := clienttypes.ParseHeight(string(d.store("clients/" + acceptanceSubstitute + "/consensusStates/0-1032/processedHeight")))
	require.NoError(t, err)
	setConsensusMetadataWithValues(diagnosticStore, NewHeight(0, 1032), processedHeight, processedTime)
	diagnosticCtx = diagnosticCtx.WithChainID(acceptanceChainID).WithBlockHeight(d.safeHeight())
	diagnosticCtx = diagnosticCtx.WithBlockTime(time.Now())
	active := d.state(acceptanceSubstitute)
	path := commitmenttypes.NewMerklePath("ibc", acceptanceCommitmentKey(2))
	require.NoError(t, active.VerifyMembership(diagnosticCtx, diagnosticStore, diagnosticCodec, NewHeight(0, 1032), 0, 0, proof, path, channeltypes.CommitPacket(nil, acceptancePacket(2))))
	absent, _ := acceptanceProof(t, acceptanceLaneValues(t, 2), "receipts/ports/transfer/channels/channel-0/sequences/1")
	require.NoError(t, active.VerifyNonMembership(diagnosticCtx, diagnosticStore, diagnosticCodec, NewHeight(0, 1032), 0, 0, absent, commitmenttypes.NewMerklePath("ibc", "receipts/ports/transfer/channels/channel-0/sequences/1")))
	incompatible := fromCoreClientState(toCoreClientState(d.state(acceptanceSubstitute)))
	incompatible.PacketLanePolicyId = bytes.Repeat([]byte{9}, 28)
	incompatible.OperationalCertificateCounterHistoryStartHeight = incompatible.LatestCheckpointHeight
	incompatibleConsensus := clienttypes.MustUnmarshalConsensusState(d.app.AppCodec(), d.store("clients/"+acceptanceSubstitute+"/consensusStates/0-1032"))
	createIncompatible, err := clienttypes.NewMsgCreateClient(incompatible, incompatibleConsensus, signer)
	require.NoError(t, err)
	d.send(createIncompatible, "")
	ibcBefore := d.recoverySnapshot()
	d.send(clienttypes.NewMsgRecoverClient(signer, acceptanceSubject, acceptanceSubstitute), "unauthorized")
	require.Equal(t, ibcBefore, d.recoverySnapshot())
	require.Equal(t, before, d.applicationSnapshot())
	authority := authtypes.NewModuleAddress("gov").String()
	recoverThroughGov := func(substitute string, want govtypes.ProposalStatus) {
		message := clienttypes.NewMsgRecoverClient(authority, acceptanceSubject, substitute)
		submit, err := govtypes.NewMsgSubmitProposal([]sdk.Msg{message}, sdk.NewCoins(sdk.NewInt64Coin("stake", 1)), signer, "", "Recover local Cardano client", "Local acceptance recovery", false)
		require.NoError(t, err)
		result := d.send(submit, "")
		var proposalID uint64
		for _, event := range result.TxResult.Events {
			if event.Type == "submit_proposal" {
				for _, attr := range event.Attributes {
					if attr.Key == "proposal_id" {
						_, err = fmt.Sscan(attr.Value, &proposalID)
						require.NoError(t, err)
					}
				}
			}
		}
		require.NotZero(t, proposalID)
		d.send(govtypes.NewMsgVote(acceptanceAddress("operator"), proposalID, govtypes.OptionYes, ""), "")
		require.Eventually(t, func() bool {
			r, e := govtypes.NewQueryClient(d.conn).Proposal(d.queryContext(), &govtypes.QueryProposalRequest{ProposalId: proposalID})
			return e == nil && r.Proposal.Status == want
		}, 15*time.Second, 100*time.Millisecond)
	}
	// The newer replacement uses another lane policy. Authority alone cannot make it compatible.
	recoverThroughGov(ModuleName+"-3", govtypes.StatusFailed)
	require.Equal(t, ibcBefore, d.recoverySnapshot())
	require.Equal(t, before, d.applicationSnapshot())
	require.False(t, d.state(acceptanceSubject).FrozenHeight.IsZero())
	recoverThroughGov(acceptanceSubstitute, govtypes.StatusPassed)
	recovered := d.state(acceptanceSubject)
	require.True(t, recovered.FrozenHeight.IsZero())
	require.Equal(t, replacement.AnchorBlock.Height, recovered.LatestHeight)
	freshDeadline := acceptanceDeadline(t, recovered, 8)
	require.Greater(t, freshDeadline, deadline)
	require.Greater(t, freshDeadline, acceptanceDeadline(t, d.state(acceptanceSubstitute), 8))
	require.Equal(t, before, d.applicationSnapshot())
	for _, height := range []uint64{966, 967, 1001} {
		for _, key := range []string{fmt.Sprintf("consensusStates/0-%d", height), fmt.Sprintf("consensusStates/0-%d/processedTime", height), fmt.Sprintf("consensusStates/0-%d/processedHeight", height), fmt.Sprintf("packetState/%020d", height), string(IterationKey(clienttypes.NewHeight(0, height)))} {
			require.Empty(t, d.store("clients/"+acceptanceSubject+"/"+key), key)
		}
	}
	acceptanceReceive(t, d, 2, 2, 1032, "pending")
	acceptanceTimeout(t, d, 2, 1032, pending, "pending")
	d.waitDeadline(freshDeadline)
	for _, height := range []uint64{967, 1001} {
		acceptanceReceive(t, d, 2, 2, height, "processed time not found")
	}
	ordinary := acceptanceHeader(t, history, "honest", 1032, 1063)
	d.update(acceptanceSubject, ordinary)
	acceptanceReceive(t, d, 3, 2, 1063, "")
	acceptanceReceive(t, d, 3, 3, 1063, "")
	acceptanceTimeout(t, d, 3, 1063, pending, "")
	require.Equal(t, "1000", d.balance(signer, "utest"))
	require.Equal(t, "0", d.balance(transfer.GetEscrowAddress("transfer", "channel-0").String(), "utest"))
	require.Empty(t, d.store("commitments/ports/transfer/channels/channel-0/sequences/1"))
	boundary := acceptanceHeader(t, history, "honest", 1063, 1094)
	d.update(acceptanceSubject, boundary)
	d.waitDeadline(acceptanceDeadline(t, d.state(acceptanceSubject), 9))
	acceptanceReceive(t, d, 4, 4, 1094, "")
	require.Equal(t, "400", d.balance(signer, denom))
	require.Equal(t, uint64(400), acceptanceEscrow(t, boundary))
	// Persisted restarts keep the original IDs, quarantine and packet accounting.
	beforeRestart := d.applicationSnapshot()
	stateBeforeRestart := d.state(acceptanceSubject)
	stopHost()
	stopHost = acceptanceStartHost(t, config, configFile)
	require.Equal(t, beforeRestart, d.applicationSnapshot())
	require.Equal(t, stateBeforeRestart, d.state(acceptanceSubject))
	watcher.Challenge = false
	restartStatus, err := d.rpc.Status(context.Background())
	require.NoError(t, err)
	watcher.WaitAfterHeight = restartStatus.SyncInfo.LatestBlockHeight
	acceptanceWriteJSON(t, watcherFile, watcher)
	command = acceptanceProcess(t, "TestCaribicAcceptanceWatcher", "CARIBIC_ACCEPTANCE_WATCHER", watcherFile, filepath.Join(root, "watcher.log"))
	next := acceptanceHeader(t, history, "honest", 1094, 1125)
	d.update(acceptanceSubject, next)
	acceptanceReceive(t, d, 5, 5, 1125, "")
	require.NoError(t, command.Wait())
	var resumedCursor acceptanceWatcherCursor
	acceptanceReadJSON(t, watcher.Cursor, &resumedCursor)
	require.Greater(t, resumedCursor.LastHeight, watcher.WaitAfterHeight)
	require.Equal(t, uint64(1094), resumedCursor.TrustedHeight)
	acceptanceReceive(t, d, 2, 2, 1001, "processed time not found")
	require.Equal(t, uint64(200), acceptanceEscrow(t, proposal))
	require.Equal(t, acceptanceEscrow(t, proposal), acceptanceEscrow(t, replacement))
	require.Equal(t, "500", d.balance(signer, denom))
	require.Equal(t, uint64(500), acceptanceEscrow(t, next))
	after := d.applicationSnapshot()
	require.Equal(t, before["connections/"], after["connections/"])
	require.Equal(t, before["channelEnds/"], after["channelEnds/"])
	require.Equal(t, before["trace"], after["trace"])
	require.Equal(t, before["nextSequenceSend/"], after["nextSequenceSend/"])
	require.Equal(t, before["nextSequenceRecv/"], after["nextSequenceRecv/"])
	require.Equal(t, before["nextSequenceAck/"], after["nextSequenceAck/"])
	require.Equal(t, sdk.Uint64ToBigEndian(2), d.store("nextSequenceSend/ports/transfer/channels/channel-0"))
	require.Equal(t, sdk.Uint64ToBigEndian(1), d.store("nextSequenceRecv/ports/transfer/channels/channel-0"))
	require.Equal(t, sdk.Uint64ToBigEndian(1), d.store("nextSequenceAck/ports/transfer/channels/channel-0"))
	successAck := channeltypes.NewResultAcknowledgement([]byte{1}).Acknowledgement()
	for sequence := uint64(1); sequence <= 5; sequence++ {
		require.Equal(t, []byte{1}, d.store(fmt.Sprintf("receipts/ports/transfer/channels/channel-0/sequences/%d", sequence)))
		require.Equal(t, channeltypes.CommitAcknowledgement(successAck), d.store(fmt.Sprintf("acks/ports/transfer/channels/channel-0/sequences/%d", sequence)))
	}
	finalState := d.state(acceptanceSubject)
	require.Equal(t, uint64(9), finalState.CurrentEpoch)
	require.Equal(t, uint64(9), finalState.LatestCheckpointPoolRegistry.Epoch)
	require.Equal(t, uint64(9), finalState.LatestCheckpointPoolProduction.Epoch)
	require.Equal(t, uint64(9), finalState.LatestCheckpointSettlementCredit.Epoch)
	require.NotEmpty(t, finalState.LatestCheckpointSettlementCredit.Reference)
	require.NotEqual(t, recovered.LatestCheckpointNonceState, finalState.LatestCheckpointNonceState)
	require.Equal(t, recovered.LatestCheckpointOperationalCertificateCounters, finalState.LatestCheckpointOperationalCertificateCounters)
	acceptanceWriteJSON(t, filepath.Join(root, "evidence.json"), map[string]any{"client": acceptanceSubject, "connection": "connection-0", "channel": "channel-0", "proposal_committed_unix_ns": cursor.ProposalCommittedUnixNs, "challenge_committed_unix_ns": cursor.ChallengeCommittedUnixNs, "original_deadline_unix_ns": deadline, "recovery_deadline_unix_ns": freshDeadline, "source_escrow_before": acceptanceEscrow(t, baseline), "source_escrow_after": acceptanceEscrow(t, next), "final_client": finalState})
	acceptanceWriteJSON(t, filepath.Join(root, "route-after.json"), after)
	stopHost()
	t.Log("PASS: authenticated ICS-20 processing resumed on the original route after challenge, governance recovery and persisted restarts")
}
