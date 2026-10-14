package probabilistic

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	upgradetypes "cosmossdk.io/x/upgrade/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	transfer "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	"github.com/stretchr/testify/require"
)

const acceptanceUpgradeName = "caribic-v8-application-v2"
const acceptanceUpgradeStore = "caribic-upgrade"

type acceptanceUpgradeHost struct {
	t       *testing.T
	command *exec.Cmd
	done    chan error
	exited  bool
	log     string
}

func startAcceptanceUpgradeHost(t *testing.T, binary, file, logFile string, config acceptanceHostConfig) *acceptanceUpgradeHost {
	t.Helper()
	_ = os.Remove(filepath.Join(config.Root, "ready"))
	log, err := os.OpenFile(logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	require.NoError(t, err)
	t.Cleanup(func() { _ = log.Close() })
	command := exec.Command(binary, "-test.run=^TestCaribicAcceptanceHost$", "-test.v", "-test.timeout=20m")
	command.Env = append(os.Environ(), "CARIBIC_ACCEPTANCE_HOST="+file)
	command.Stdout, command.Stderr = log, log
	require.NoError(t, command.Start())
	host := &acceptanceUpgradeHost{t: t, command: command, done: make(chan error, 1), log: logFile}
	go func() { host.done <- command.Wait() }()
	t.Cleanup(host.stop)
	require.Eventually(t, func() bool {
		select {
		case err := <-host.done:
			host.exited = true
			raw, _ := os.ReadFile(logFile)
			t.Fatalf("host exited before readiness: %v\n%s", err, raw)
		default:
		}
		_, err := os.Stat(filepath.Join(config.Root, "ready"))
		return err == nil
	}, 30*time.Second, 100*time.Millisecond)
	return host
}

func (host *acceptanceUpgradeHost) stop() {
	if host.exited {
		return
	}
	host.exited = true
	// An SDK upgrade halt can race test cleanup. Reap an exited process first.
	select {
	case <-host.done:
		return
	default:
	}
	_ = host.command.Process.Signal(syscall.SIGTERM)
	select {
	case err := <-host.done:
		require.NoError(host.t, err)
	case <-time.After(20 * time.Second):
		_ = host.command.Process.Kill()
		<-host.done
		host.t.Error("upgrade host did not stop cleanly")
	}
}

func (host *acceptanceUpgradeHost) requireUpgradeHalt(d *acceptanceDriver, plan upgradetypes.Plan) {
	host.t.Helper()
	// CometBFT recovers the upgrade error and leaves RPC running after stopping
	// consensus. Require the SDK's upgrade file and a stationary committed tip
	// before terminating the idle process. A process exit alone proves neither.
	var firstObserved time.Time
	require.Eventually(host.t, func() bool {
		raw, err := os.ReadFile(filepath.Join(d.config.Root, "data/upgrade-info.json"))
		var info upgradetypes.Plan
		if err != nil || json.Unmarshal(raw, &info) != nil || info.Name != plan.Name || info.Height != plan.Height {
			return false
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		status, err := d.rpc.Status(ctx)
		// CometBFT saves block N before asking the SDK to apply it. Its RPC
		// tip therefore includes that unexecuted block at the upgrade halt.
		if err != nil || status.SyncInfo.LatestBlockHeight != plan.Height {
			return false
		}
		infoResponse, err := d.rpc.ABCIInfo(ctx)
		if err != nil || infoResponse.Response.LastBlockHeight != plan.Height-1 {
			return false
		}
		if firstObserved.IsZero() {
			firstObserved = time.Now()
		}
		return time.Since(firstObserved) >= time.Second
	}, 90*time.Second, 100*time.Millisecond)
	raw, err := os.ReadFile(host.log)
	require.NoError(host.t, err)
	require.True(host.t, strings.Contains(string(raw), "NEEDED at height: "+fmt.Sprint(plan.Height)), "SDK upgrade halt missing from %s", host.log)
	host.stop()
}

func acceptanceUpgradeDigest(t *testing.T, file string) string {
	t.Helper()
	raw, err := os.ReadFile(file)
	require.NoError(t, err)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

func acceptanceUpgradeProposal(t *testing.T, d *acceptanceDriver, plan upgradetypes.Plan) uint64 {
	t.Helper()
	signer := acceptanceAddress("operator").String()
	message := &upgradetypes.MsgSoftwareUpgrade{Authority: authtypes.NewModuleAddress("gov").String(), Plan: plan}
	proposal, err := govtypes.NewMsgSubmitProposal([]sdk.Msg{message}, sdk.NewCoins(sdk.NewInt64Coin("stake", 1)), signer, "", "Upgrade local v8 application", "Retain the original probabilistic client and ICS-20 route", false)
	require.NoError(t, err)
	result := d.send(proposal, "")
	var id uint64
	for _, event := range result.TxResult.Events {
		if event.Type != "submit_proposal" {
			continue
		}
		for _, attribute := range event.Attributes {
			if attribute.Key == "proposal_id" {
				_, err = fmt.Sscan(attribute.Value, &id)
				require.NoError(t, err)
			}
		}
	}
	require.NotZero(t, id)
	d.send(govtypes.NewMsgVote(acceptanceAddress("operator"), id, govtypes.OptionYes, ""), "")
	require.Eventually(t, func() bool {
		r, err := govtypes.NewQueryClient(d.conn).Proposal(d.queryContext(), &govtypes.QueryProposalRequest{ProposalId: id})
		return err == nil && r.Proposal.Status == govtypes.StatusPassed
	}, 15*time.Second, 100*time.Millisecond)
	current, err := upgradetypes.NewQueryClient(d.conn).CurrentPlan(d.queryContext(), &upgradetypes.QueryCurrentPlanRequest{})
	require.NoError(t, err)
	require.Equal(t, plan.Name, current.Plan.Name)
	require.Equal(t, plan.Height, current.Plan.Height)
	return id
}

func TestCaribicV8SoftwareUpgrade(t *testing.T) {
	if os.Getenv("CARIBIC_V8_SOFTWARE_UPGRADE") != "1" {
		t.Skip("run with caribic test --light-client software-upgrade --network v8-classic")
	}
	root, beforeBinary, afterBinary := os.Getenv("CARIBIC_ACCEPTANCE_ARTIFACTS"), os.Getenv("CARIBIC_UPGRADE_BEFORE"), os.Getenv("CARIBIC_UPGRADE_AFTER")
	require.NotEmpty(t, root)
	require.NotEmpty(t, beforeBinary)
	require.NotEmpty(t, afterBinary)
	beforeHash, afterHash := acceptanceUpgradeDigest(t, beforeBinary), acceptanceUpgradeDigest(t, afterBinary)
	require.NotEqual(t, beforeHash, afterHash)
	history := acceptanceSource(t, root)
	config := acceptanceHostConfig{Root: filepath.Join(root, "host"), RPC: spareAddress(t), P2P: spareAddress(t), GRPC: spareAddress(t), History: filepath.Join(root, "source-history.json")}
	require.NoError(t, os.MkdirAll(config.Root, 0700))
	configFile := filepath.Join(root, "host.json")
	acceptanceWriteJSON(t, configFile, config)
	oldHost := startAcceptanceUpgradeHost(t, beforeBinary, configFile, filepath.Join(root, "before-host.log"), config)
	d := newAcceptanceDriver(t, config, "operator")
	signer := acceptanceAddress("operator").String()
	denom := transfer.ParseDenomTrace("transfer/channel-0/lovelace").IBCDenom()

	// Establish the route and both kinds of application state through signed transactions.
	d.waitDeadline(acceptanceDeadline(t, d.state(acceptanceSubject), 7))
	d.send(channeltypes.NewMsgChannelOpenInit("transfer", "ics20-1", channeltypes.UNORDERED, []string{"connection-0"}, "transfer", signer), "")
	proof, _ := acceptanceProof(t, acceptanceChannelValues(t), "channelEnds/ports/transfer/channels/channel-0")
	d.send(channeltypes.NewMsgChannelOpenAck("transfer", "channel-0", "channel-0", "ics20-1", proof, clienttypes.NewHeight(0, 966), signer), "")
	d.update(acceptanceSubject, acceptanceHeader(t, history, "honest", 966, 967))
	acceptanceReceive(t, d, 1, 1, 967, "")
	require.Equal(t, "100", d.balance(signer, denom))
	pending := channeltypes.NewPacket(transfer.NewFungibleTokenPacketData("utest", "7", signer, "cardano-local-receiver", "").GetBytes(), 1, "transfer", "channel-0", "transfer", "channel-0", clienttypes.NewHeight(0, 1000), 0)
	d.send(transfer.NewMsgTransfer("transfer", "channel-0", sdk.NewInt64Coin("utest", 7), signer, "cardano-local-receiver", clienttypes.NewHeight(0, 1000), 0, ""), "")
	require.Equal(t, channeltypes.CommitPacket(nil, pending), d.store("commitments/ports/transfer/channels/channel-0/sequences/1"))
	require.Equal(t, "993", d.balance(signer, "utest"))
	require.Equal(t, "7", d.balance(transfer.GetEscrowAddress("transfer", "channel-0").String(), "utest"))
	d.update(acceptanceSubject, acceptanceHeader(t, history, "honest", 967, 1001))
	deadline := acceptanceDeadline(t, d.state(acceptanceSubject), 8)
	acceptanceReceive(t, d, 2, 2, 1001, "pending")
	retained := d.recoverySnapshot()
	acceptanceWriteJSON(t, filepath.Join(root, "before-upgrade.json"), retained)
	genesisHash := acceptanceUpgradeDigest(t, filepath.Join(config.Root, "config/genesis.json"))
	status, err := d.rpc.Status(context.Background())
	require.NoError(t, err)
	block, err := d.rpc.Block(context.Background(), nil)
	require.NoError(t, err)
	protocolBefore := block.Block.Version.App
	plan := upgradetypes.Plan{Name: acceptanceUpgradeName, Height: status.SyncInfo.LatestBlockHeight + 100, Info: "Caribic v8 acceptance: add the successor application store"}
	proposalID := acceptanceUpgradeProposal(t, d, plan)
	require.Equal(t, retained, d.recoverySnapshot())
	versionsBefore, err := upgradetypes.NewQueryClient(d.conn).ModuleVersions(d.queryContext(), &upgradetypes.QueryModuleVersionsRequest{})
	require.NoError(t, err)
	t.Logf("governance approved plan %s at height %d, waiting for the old host to halt", plan.Name, plan.Height)
	oldHost.requireUpgradeHalt(d, plan)
	var upgradeInfo upgradetypes.Plan
	acceptanceReadJSON(t, filepath.Join(config.Root, "data/upgrade-info.json"), &upgradeInfo)
	require.Equal(t, plan.Name, upgradeInfo.Name)
	require.Equal(t, plan.Height, upgradeInfo.Height)

	// The SDK halted consensus before the controller stopped its idle process.
	// Only the new application has the approved handler and store migration.
	successor := startAcceptanceUpgradeHost(t, afterBinary, configFile, filepath.Join(root, "after-host.log"), config)
	var startup map[string]int64
	acceptanceReadJSON(t, filepath.Join(config.Root, "startup.json"), &startup)
	require.Equal(t, plan.Height-1, startup["loaded_height"])
	require.Equal(t, genesisHash, acceptanceUpgradeDigest(t, filepath.Join(config.Root, "config/genesis.json")))
	require.Equal(t, retained, d.recoverySnapshot(), "binary replacement must retain every probabilistic client key and route value")
	require.Equal(t, deadline, acceptanceDeadline(t, d.state(acceptanceSubject), 8))
	require.Equal(t, sdk.Uint64ToBigEndian(uint64(plan.Height)), d.query("/store/"+acceptanceUpgradeStore+"/key", []byte("applied-height")))
	applied, err := upgradetypes.NewQueryClient(d.conn).AppliedPlan(d.queryContext(), &upgradetypes.QueryAppliedPlanRequest{Name: plan.Name})
	require.NoError(t, err)
	require.Equal(t, plan.Height, applied.Height)
	current, err := upgradetypes.NewQueryClient(d.conn).CurrentPlan(d.queryContext(), &upgradetypes.QueryCurrentPlanRequest{})
	require.NoError(t, err)
	require.Nil(t, current.Plan)
	versionsAfter, err := upgradetypes.NewQueryClient(d.conn).ModuleVersions(d.queryContext(), &upgradetypes.QueryModuleVersionsRequest{})
	require.NoError(t, err)
	require.Equal(t, versionsBefore, versionsAfter)
	status, err = d.rpc.Status(context.Background())
	require.NoError(t, err)
	block, err = d.rpc.Block(context.Background(), nil)
	require.NoError(t, err)
	require.Equal(t, protocolBefore+1, block.Block.Version.App)
	require.Less(t, uint64(status.SyncInfo.LatestBlockTime.UnixNano()), deadline)
	acceptanceReceive(t, d, 2, 2, 1001, "pending")
	acceptanceTimeout(t, d, 2, 1001, pending, "pending")
	require.Equal(t, retained, d.recoverySnapshot())
	acceptanceWriteJSON(t, filepath.Join(root, "after-upgrade.json"), d.recoverySnapshot())

	// Verify retained proof history and new native headers through the real keeper.
	d.waitDeadline(deadline)
	acceptanceReceive(t, d, 2, 2, 1001, "")
	d.update(acceptanceSubject, acceptanceHeader(t, history, "honest", 1001, 1032))
	acceptanceTimeout(t, d, 2, 1032, pending, "")
	require.Empty(t, d.store("commitments/ports/transfer/channels/channel-0/sequences/1"))
	require.Equal(t, "1000", d.balance(signer, "utest"))
	require.Equal(t, "0", d.balance(transfer.GetEscrowAddress("transfer", "channel-0").String(), "utest"))
	d.update(acceptanceSubject, acceptanceHeader(t, history, "honest", 1032, 1063))
	acceptanceReceive(t, d, 3, 3, 1063, "")
	d.update(acceptanceSubject, acceptanceHeader(t, history, "honest", 1063, 1094))
	deadline9 := acceptanceDeadline(t, d.state(acceptanceSubject), 9)
	require.Greater(t, deadline9, deadline)
	acceptanceReceive(t, d, 4, 4, 1094, "pending")
	d.waitDeadline(deadline9)
	acceptanceReceive(t, d, 4, 4, 1094, "")
	beforeRestart := d.recoverySnapshot()
	successor.stop()
	successor = startAcceptanceUpgradeHost(t, afterBinary, configFile, filepath.Join(root, "restart-host.log"), config)
	require.Equal(t, beforeRestart, d.recoverySnapshot())
	require.Equal(t, sdk.Uint64ToBigEndian(uint64(plan.Height)), d.query("/store/"+acceptanceUpgradeStore+"/key", []byte("applied-height")))
	status, err = d.rpc.Status(context.Background())
	require.NoError(t, err)
	block, err = d.rpc.Block(context.Background(), nil)
	require.NoError(t, err)
	require.Equal(t, protocolBefore+1, block.Block.Version.App, "the completed upgrade must not run twice")
	finalHeader := acceptanceHeader(t, history, "honest", 1094, 1125)
	d.update(acceptanceSubject, finalHeader)
	acceptanceReceive(t, d, 5, 5, 1125, "")
	require.Equal(t, "500", d.balance(signer, denom))
	require.Equal(t, uint64(500), acceptanceEscrow(t, finalHeader))
	after := d.recoverySnapshot()
	for _, key := range []string{"connections/", "channelEnds/", "nextSequenceSend/", "nextSequenceRecv/", "nextSequenceAck/", "trace", "denomination", "nextClientSequence", "nextConnectionSequence", "nextChannelSequence", "params"} {
		require.Equal(t, retained[key], after[key], key)
	}
	require.Equal(t, sdk.Uint64ToBigEndian(2), d.store("nextSequenceSend/ports/transfer/channels/channel-0"))
	require.Equal(t, sdk.Uint64ToBigEndian(1), d.store("nextSequenceRecv/ports/transfer/channels/channel-0"))
	require.Equal(t, sdk.Uint64ToBigEndian(1), d.store("nextSequenceAck/ports/transfer/channels/channel-0"))
	for seq := uint64(1); seq <= 5; seq++ {
		require.Equal(t, []byte{1}, d.store(fmt.Sprintf("receipts/ports/transfer/channels/channel-0/sequences/%d", seq)))
		require.Equal(t, channeltypes.CommitAcknowledgement(channeltypes.NewResultAcknowledgement([]byte{1}).Acknowledgement()), d.store(fmt.Sprintf("acks/ports/transfer/channels/channel-0/sequences/%d", seq)))
	}
	final := d.state(acceptanceSubject)
	require.Equal(t, uint64(1125), final.LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, uint64(9), final.LatestCheckpointPoolRegistry.Epoch)
	require.Equal(t, uint64(9), final.LatestCheckpointPoolProduction.Epoch)
	require.Equal(t, uint64(9), final.LatestCheckpointSettlementCredit.Epoch)
	require.NotEmpty(t, final.LatestCheckpointSettlementCredit.Reference)
	require.NotEqual(t, history.Client.LatestCheckpointNonceState, final.LatestCheckpointNonceState)
	acceptanceWriteJSON(t, filepath.Join(root, "after-packets.json"), after)
	acceptanceWriteJSON(t, filepath.Join(root, "evidence.json"), map[string]any{
		"scope":         "local v8 host application upgrade with the checkout verifier retained and signed fixture Cardano history",
		"before_sha256": beforeHash, "after_sha256": afterHash, "genesis_sha256": genesisHash,
		"proposal_id": proposalID, "plan": plan, "successor_loaded_height": startup["loaded_height"],
		"protocol_before": protocolBefore, "protocol_after": block.Block.Version.App,
		"retained_epoch8_deadline": deadline, "new_epoch9_deadline": deadline9,
		"client": acceptanceSubject, "connection": "connection-0", "channel": "channel-0", "final_client": final,
	})
	successor.stop()
	t.Log("PASS: governance upgrade halted the old v8 host, migrated the successor store and resumed authenticated packets on the retained route across an epoch and restart")
}
