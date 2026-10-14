package probabilistic

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	transfer "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	"github.com/stretchr/testify/require"
)

// Queue through real CheckTx without conflating mempool acceptance and commit.
func (d *acceptanceDriver) queue(msgs ...sdk.Msg) []byte {
	d.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	response, err := authtypes.NewQueryClient(d.conn).Account(ctx, &authtypes.QueryAccountRequest{Address: acceptanceAddress(d.seed).String()})
	require.NoError(d.t, err)
	var account sdk.AccountI
	require.NoError(d.t, d.app.AppCodec().UnpackAny(response.Account, &account))
	tx, err := simtestutil.GenSignedMockTx(rand.New(rand.NewSource(1)), d.app.TxConfig(), msgs, sdk.NewCoins(sdk.NewInt64Coin("stake", 1_500_000)), 200_000_000, acceptanceChainID, []uint64{account.GetAccountNumber()}, []uint64{account.GetSequence()}, acceptanceKey(d.seed))
	require.NoError(d.t, err)
	wire, err := d.app.TxConfig().TxEncoder()(tx)
	require.NoError(d.t, err)
	require.Less(d.t, len(wire), 8*1024*1024)
	responseTx, err := txtypes.NewServiceClient(d.conn).BroadcastTx(ctx, &txtypes.BroadcastTxRequest{TxBytes: wire, Mode: txtypes.BroadcastMode_BROADCAST_MODE_SYNC})
	require.NoError(d.t, err)
	require.Zero(d.t, responseTx.TxResponse.Code, responseTx.TxResponse.RawLog)
	return cmttypes.Tx(wire).Hash()
}
func (d *acceptanceDriver) committed(hash []byte) *coretypes.ResultTx {
	d.t.Helper()
	var result *coretypes.ResultTx
	require.Eventually(d.t, func() bool {
		r, err := d.rpc.Tx(context.Background(), hash, false)
		if err != nil {
			return false
		}
		result = r
		return true
	}, 30*time.Second, 50*time.Millisecond)
	return result
}
func acceptanceWaitWall(t *testing.T, target time.Time) {
	t.Helper()
	lastLog := time.Now()
	for time.Now().Before(target) {
		if time.Since(lastLog) > 25*time.Second {
			t.Logf("real deadline in %s", time.Until(target).Round(time.Second))
			lastLog = time.Now()
		}
		time.Sleep(min(100*time.Millisecond, time.Until(target)))
	}
}

func TestCaribicV8DeadlineOrdering(t *testing.T) {
	if os.Getenv("CARIBIC_V8_DEADLINES") != "1" {
		t.Skip("run caribic test --light-client deadline-ordering --network v8-classic")
	}
	artifacts := os.Getenv("CARIBIC_ACCEPTANCE_ARTIFACTS")
	require.NotEmpty(t, artifacts)
	for _, scenario := range []struct {
		name                      string
		halt, proofFirst, healthy bool
	}{
		{"halt/proof-first", true, true, false},
		{"halt/challenge-first", true, false, false},
		{"exact-deadline/proof-first", false, true, false},
		{"exact-deadline/challenge-first", false, false, false},
		{"quarantine-restart", true, true, true},
	} {
		name, halt, proofFirst, healthy := scenario.name, scenario.halt, scenario.proofFirst, scenario.healthy
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			root := filepath.Join(artifacts, strings.ReplaceAll(name, "/", "-"))
			require.NoError(t, os.MkdirAll(root, 0700))
			history := acceptanceSource(t, root)
			config := acceptanceHostConfig{Root: filepath.Join(root, "host"), RPC: spareAddress(t), P2P: spareAddress(t), GRPC: spareAddress(t), History: filepath.Join(root, "source-history.json"), ConsensusControl: filepath.Join(root, "consensus.json")}
			require.NoError(t, os.MkdirAll(config.Root, 0700))
			file := filepath.Join(root, "host.json")
			acceptanceWriteJSON(t, file, config)
			host := startAcceptanceUpgradeHost(t, os.Args[0], file, filepath.Join(root, "host.log"), config)
			// SIGCONT is harmless on a running child and guarantees cleanup can stop it.
			t.Cleanup(func() { _ = host.command.Process.Signal(syscall.SIGCONT) })
			d := newAcceptanceDriver(t, config, "operator")
			watcher := newAcceptanceDriver(t, config, "watcher")
			signer := acceptanceAddress("operator").String()
			d.waitDeadline(acceptanceDeadline(t, d.state(acceptanceSubject), 7))
			d.send(channeltypes.NewMsgChannelOpenInit("transfer", "ics20-1", channeltypes.UNORDERED, []string{"connection-0"}, "transfer", signer), "")
			channelProof, _ := acceptanceProof(t, acceptanceChannelValues(t), "channelEnds/ports/transfer/channels/channel-0")
			d.send(channeltypes.NewMsgChannelOpenAck("transfer", "channel-0", "channel-0", "ics20-1", channelProof, clienttypes.NewHeight(0, 966), signer), "")
			d.update(acceptanceSubject, acceptanceHeader(t, history, "honest", 966, 967))
			acceptanceReceive(t, d, 1, 1, 967, "")
			var pending channeltypes.Packet
			if healthy {
				data := transfer.NewFungibleTokenPacketData("utest", "7", signer, "cardano-local-receiver", "").GetBytes()
				pending = channeltypes.NewPacket(data, 1, "transfer", "channel-0", "transfer", "channel-0", clienttypes.NewHeight(0, 1000), 0)
				d.send(transfer.NewMsgTransfer("transfer", "channel-0", sdk.NewInt64Coin("utest", 7), signer, "cardano-local-receiver", clienttypes.NewHeight(0, 1000), 0, ""), "")
			}
			branch := "bad"
			if healthy {
				branch = "honest"
			}
			proposal := acceptanceHeader(t, history, branch, 967, 1001)
			update, err := clienttypes.NewMsgUpdateClient(acceptanceSubject, proposal, signer)
			require.NoError(t, err)
			proposed := d.send(update, "")
			deadline := acceptanceDeadline(t, d.state(acceptanceSubject), 8)
			require.Equal(t, d.blockTime(proposed.Height)+uint64(EpochContextChallengePeriod), deadline)
			require.NotEmpty(t, d.store("clients/"+acceptanceSubject+"/consensusStates/0-1001"), "the disputed root must exist before the proof is queued")
			before := d.applicationSnapshot()
			if !halt {
				acceptanceWaitWall(t, time.Unix(0, int64(deadline)).Add(-4*time.Second))
			}
			status, err := d.rpc.Status(context.Background())
			require.NoError(t, err)
			gate := status.SyncInfo.LatestBlockHeight + 3
			control := acceptanceConsensusControl{GateHeight: gate}
			acceptanceSetConsensusControl(t, config.ConsensusControl, control)
			require.Eventually(t, func() bool { _, err := os.Stat(config.ConsensusControl + ".paused"); return err == nil }, 8*time.Second, 10*time.Millisecond)
			require.GreaterOrEqual(t, gate-proposed.Height, int64(3), "a height floor has already been satisfied")
			proof, _ := acceptanceProof(t, acceptanceLaneValues(t, 2), acceptanceCommitmentKey(2))
			receive := channeltypes.NewMsgRecvPacket(acceptancePacket(2), proof, clienttypes.NewHeight(0, 1001), signer)
			challenge, err := clienttypes.NewMsgSubmitMisbehaviour(acceptanceSubject, NewMisbehaviour(acceptanceSubject, proposal, acceptanceHeader(t, history, "honest", 967, 1001)), acceptanceAddress("watcher").String())
			require.NoError(t, err)
			// A normal self-send followed by a receive is a legal batch.
			// It bypasses the optional IBC ante redundancy shortcut so the
			// message server checks the packet proof during committed execution.
			proofMessages := []sdk.Msg{banktypes.NewMsgSend(acceptanceAddress("operator"), acceptanceAddress("operator"), sdk.NewCoins(sdk.NewInt64Coin("utest", 1))), receive}
			var proofHash, challengeHash []byte
			if healthy {
				proofHash = d.queue(proofMessages...)
			} else if proofFirst {
				proofHash = d.queue(proofMessages...)
				challengeHash = watcher.queue(challenge)
			} else {
				challengeHash = watcher.queue(challenge)
				proofHash = d.queue(proofMessages...)
			}
			mempool, err := d.rpc.UnconfirmedTxs(context.Background(), nil)
			require.NoError(t, err)
			count := 2
			if healthy {
				count = 1
			}
			require.Len(t, mempool.Txs, count)
			require.Equal(t, proofHash, mempool.Txs[map[bool]int{true: 0, false: 1}[proofFirst]].Hash())
			require.True(t, d.state(acceptanceSubject).FrozenHeight.IsZero(), "mempool admission is not a freeze")
			require.Equal(t, before, d.applicationSnapshot())
			if halt {
				require.Less(t, d.blockTime(gate-1), deadline)
				require.NoError(t, host.command.Process.Signal(syscall.SIGSTOP))
				acceptanceWaitWall(t, time.Unix(0, int64(deadline)).Add(time.Second))
				require.NoError(t, host.command.Process.Signal(syscall.SIGCONT))
			} else {
				acceptanceWaitWall(t, time.Unix(0, int64(deadline)))
				control.VoteTimeHeight = gate
				control.VoteTimeUnixNs = int64(deadline)
				acceptanceSetConsensusControl(t, config.ConsensusControl, control)
			}
			require.NoError(t, os.WriteFile(config.ConsensusControl+".release", []byte{1}, 0600))
			var challengeResult *coretypes.ResultTx
			if !healthy {
				challengeResult = d.committed(challengeHash)
				require.Zero(t, challengeResult.TxResult.Code, challengeResult.TxResult.Log)
			}
			proofResult := d.committed(proofHash)
			require.NotZero(t, proofResult.TxResult.Code, proofResult.TxResult.Log)
			require.Equal(t, gate+1, proofResult.Height)
			if !healthy {
				require.Equal(t, proofResult.Height, challengeResult.Height)
				require.Equal(t, proofFirst, proofResult.Index < challengeResult.Index)
			}
			if proofFirst {
				require.Contains(t, proofResult.TxResult.Log, "pending")
			} else {
				require.Contains(t, strings.ToLower(proofResult.TxResult.Log), "frozen")
			}
			committedTime := d.blockTime(proofResult.Height)
			if halt {
				require.Greater(t, committedTime, deadline)
			} else {
				require.Equal(t, deadline, committedTime)
			}
			require.Eventually(t, func() bool {
				s, e := d.rpc.Status(context.Background())
				return e == nil && s.SyncInfo.LatestBlockHeight > proofResult.Height+1
			}, 5*time.Second, 25*time.Millisecond)
			require.Equal(t, healthy, d.state(acceptanceSubject).FrozenHeight.IsZero())
			require.Equal(t, before, d.applicationSnapshot(), "failed proof must not mint, receive or acknowledge a packet")
			progress := decodeHostProgress(d.store(string(hostProgressKey)))
			require.NotNil(t, progress)
			if halt {
				require.GreaterOrEqual(t, progress.ResumeUsableAfterUnixNs, committedTime+uint64(EpochContextChallengePeriod))
			} else {
				require.Equal(t, uint64(1), progress.ResumeUsableAfterUnixNs, "exact-deadline cases must not accidentally test a halt")
			}
			acceptanceWriteJSON(t, filepath.Join(root, "ordering.json"), map[string]any{"deadline_unix_ns": deadline, "committed_unix_ns": committedTime, "proposal_height": proposed.Height, "gate_height": gate, "host_progress": progress, "proof": proofResult, "challenge": challengeResult, "proof_hash": hex.EncodeToString(proofHash), "challenge_hash": hex.EncodeToString(challengeHash), "application_before": before, "application_after": d.applicationSnapshot()})
			denom := transfer.ParseDenomTrace("transfer/channel-0/lovelace").IBCDenom()
			require.Equal(t, "100", d.balance(signer, denom))
			if !healthy {
				acceptanceReceive(t, d, 2, 2, 1001, "frozen")
				require.Equal(t, before, d.applicationSnapshot())
				t.Logf("committed challenge height=%d index=%d proof index=%d code=%d time=%d deadline=%d", challengeResult.Height, challengeResult.Index, proofResult.Index, proofResult.TxResult.Code, committedTime, deadline)
				return
			}
			// The fresh window must survive process replacement and later permit
			// actual authenticated packets on the original channel.
			host.stop()
			host = startAcceptanceUpgradeHost(t, os.Args[0], file, filepath.Join(root, "host-restarted.log"), config)
			restored := decodeHostProgress(d.store(string(hostProgressKey)))
			require.NotNil(t, restored)
			require.Equal(t, progress.ResumeUsableAfterUnixNs, restored.ResumeUsableAfterUnixNs)
			acceptanceReceive(t, d, 2, 2, 1001, "pending")
			acceptanceTimeout(t, d, 2, 1001, pending, "pending")
			require.Equal(t, before, d.applicationSnapshot())
			d.waitDeadline(restored.ResumeUsableAfterUnixNs)
			acceptanceReceive(t, d, 2, 2, 1001, "")
			d.update(acceptanceSubject, acceptanceHeader(t, history, "honest", 1001, 1032))
			acceptanceTimeout(t, d, 2, 1032, pending, "")
			require.Equal(t, "200", d.balance(signer, denom))
			require.Equal(t, "1000", d.balance(signer, "utest"))
			require.Equal(t, "0", d.balance(transfer.GetEscrowAddress("transfer", "channel-0").String(), "utest"))
			require.Empty(t, d.store("commitments/ports/transfer/channels/channel-0/sequences/1"))
			require.NotEmpty(t, d.store("receipts/ports/transfer/channels/channel-0/sequences/2"))
			require.NotEmpty(t, d.store("acks/ports/transfer/channels/channel-0/sequences/2"))
			after := d.applicationSnapshot()
			require.Equal(t, before["channelEnds/"], after["channelEnds/"])
			require.Equal(t, before["connections/"], after["connections/"])
			require.Equal(t, before["trace"], after["trace"])
			require.Equal(t, before["nextSequenceSend/"], after["nextSequenceSend/"])
			require.Equal(t, before["nextSequenceRecv/"], after["nextSequenceRecv/"])
			require.Equal(t, before["nextSequenceAck/"], after["nextSequenceAck/"])
			acceptanceWriteJSON(t, filepath.Join(root, "resumed.json"), map[string]any{"host_progress": decodeHostProgress(d.store(string(hostProgressKey))), "application": d.applicationSnapshot()})
		})
	}
}

func acceptanceSetConsensusControl(t *testing.T, file string, control acceptanceConsensusControl) {
	t.Helper()
	raw, err := json.Marshal(control)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(file+".tmp", raw, 0600))
	require.NoError(t, os.Rename(file+".tmp", file))
}
