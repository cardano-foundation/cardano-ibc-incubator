package probabilistic

import (
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	transfer "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
)

// The only source transaction updates a packet lane. HostState stays at the
// original trusted UTxO throughout the signed history, including both rollovers.
func TestExportHeartbeatFreeHistory(t *testing.T) {
	if os.Getenv("UPDATE_HEARTBEAT_FREE_FIXTURE") != "1" {
		t.Skip("explicit fixture regeneration only")
	}
	_, hostRoot := idleCheckpointProof(t, acceptanceChannelValues(t), "channelEnds/ports/transfer/channels/channel-0")
	values := idleCheckpointLaneValues(t, 1)
	_, initialRoot := idleCheckpointProof(t, values, idleCheckpointCommitmentKey(1))
	name, err := core.PacketLaneTokenName("transfer", "channel-0", 0, 1)
	require.NoError(t, err)
	hash := blake2b.Sum256([]byte("native-bootstrap"))
	snapshot := core.PacketStateSnapshot{
		Height: 966, BlockHash: hex.EncodeToString(hash[:]), HostTxHash: fmt.Sprintf("%064x", 22), HostRoot: hostRoot,
		Lanes: map[string]core.TrackedPacketLane{hex.EncodeToString(name): {
			State:  core.PacketLaneRoot{Height: 966, Port: "transfer", Channel: "channel-0", LaneCount: 1, Root: initialRoot},
			TxHash: fmt.Sprintf("%064x", 23), OutputIndex: 1,
		}},
	}
	encoded, err := core.EncodePacketStateSnapshot(snapshot)
	require.NoError(t, err)
	values = idleCheckpointLaneValues(t, 2)
	ack := channeltypes.NewResultAcknowledgement([]byte{1}).Acknowledgement()
	values["acks/ports/transfer/channels/channel-0/sequences/1"] = channeltypes.CommitAcknowledgement(ack)
	values["receipts/ports/transfer/channels/channel-0/sequences/1"] = []byte{0x40}
	_, root := idleCheckpointProof(t, values, idleCheckpointCommitmentKey(2))
	zeroHeight := cbor.Tag{Number: 121, Content: []uint64{0, 0}}
	lane := cbor.Tag{Number: 121, Content: []any{
		[]byte("transfer"), []byte("channel-0"), uint64(0), uint64(1), uint64(1), root,
		map[uint64][]byte{1: values[idleCheckpointCommitmentKey(1)], 2: values[idleCheckpointCommitmentKey(2)]},
		[]uint64{1}, map[uint64][]byte{1: channeltypes.CommitAcknowledgement(ack)}, zeroHeight, zeroHeight, map[string]uint64{},
	}}
	previous, err := hex.DecodeString(fmt.Sprintf("%064x", 23))
	require.NoError(t, err)
	body := acceptanceCBOR(t, map[uint64]any{
		0: []any{[]any{previous, uint64(1)}},
		1: []any{map[uint64]any{
			0: append([]byte{0x70}, bytes.Repeat([]byte{0x22}, 28)...),
			1: []any{uint64(2_000_000), map[cbor.ByteString]any{cbor.ByteString(bytes.Repeat([]byte{4}, 28)): map[cbor.ByteString]uint64{cbor.ByteString(name): 1}}},
			2: []any{uint64(1), cbor.Tag{Number: 24, Content: acceptanceCBOR(t, lane)}},
		}},
		2: uint64(1),
	})
	directory := t.TempDir()
	input, output := filepath.Join(directory, "input.json"), filepath.Join(directory, "history.json")
	acceptanceWriteJSON(t, input, map[string]any{
		"Transactions": map[uint64][]byte{1125: body}, "Snapshot": encoded,
		"SlotLengthNs": uint64(time.Second), "EpochLengthSlots": uint64(100_000),
		"ActiveSlotCoefficientNumerator": uint64(1), "ActiveSlotCoefficientDenominator": uint64(2),
	})
	command := exec.Command("go", "test", "./state", "-run", "^TestExportAcceptanceHistory$", "-count=1", "-timeout=5m")
	command.Dir = "../cardano-probabilistic-light-client-core"
	command.Env = append(os.Environ(), "CARIBIC_ACCEPTANCE_HISTORY_INPUT="+input, "CARIBIC_ACCEPTANCE_HISTORY_OUTPUT="+output)
	log, err := command.CombinedOutput()
	require.NoError(t, err, string(log))
	data, err := os.ReadFile(output)
	require.NoError(t, err)
	file, err := os.Create("../cardano-probabilistic-light-client-core/testdata/native-heartbeat-free.json.gz")
	require.NoError(t, err)
	writer := gzip.NewWriter(file)
	_, err = writer.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	require.NoError(t, file.Close())
}

func TestRouteContinuesWithoutHostStateHeartbeats(t *testing.T) {
	var history idleCheckpointHistoryData
	require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "native-heartbeat-free.json.gz"), &history))
	require.Equal(t, 48*time.Hour, history.Client.TrustingPeriod)
	initialTime := time.Unix(0, int64(history.Consensus.Timestamp))
	initial, err := core.DecodePacketStateSnapshot(history.Consensus.PacketStateSnapshot)
	require.NoError(t, err)
	app := newSnapshotTestApp(t)
	t.Cleanup(func() { require.NoError(t, app.Close()) })
	ctx := withTestHostProgress(app.NewContextLegacy(false, cmtproto.Header{ChainID: "heartbeat-free-1", Height: 1, Time: initialTime}))
	cdc := app.AppCodec()
	clientID := ModuleName + "-0"
	store := app.IBCKeeper.ClientKeeper.ClientStore(ctx, clientID)
	params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
	params.AllowedClients = append(params.AllowedClients, ModuleName)
	app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
	client, _, err := initializeTrusted(t, ctx, cdc, store, history.Client, history.Consensus)
	require.NoError(t, err)
	ctx = ctx.WithBlockTime(initialTime.Add(EpochContextChallengePeriod + time.Second))
	payer := idleCheckpointAddress().String()
	app.IBCKeeper.ConnectionKeeper.SetConnection(ctx, "connection-0", connectiontypes.ConnectionEnd{
		ClientId: clientID, State: connectiontypes.OPEN, Versions: connectiontypes.GetCompatibleVersions(),
		Counterparty: connectiontypes.Counterparty{ClientId: "07-tendermint-0", ConnectionId: "connection-0", Prefix: commitmenttypes.NewMerklePrefix([]byte("ibc"))},
	})
	_, err = app.IBCKeeper.ChannelOpenInit(ctx, channeltypes.NewMsgChannelOpenInit("transfer", "ics20-1", channeltypes.UNORDERED, []string{"connection-0"}, "transfer", payer))
	require.NoError(t, err)
	channels := app.IBCKeeper.ChannelKeeper
	channels.SetChannel(ctx, "transfer", "channel-0", channeltypes.Channel{
		State: channeltypes.OPEN, Ordering: channeltypes.UNORDERED,
		Counterparty: channeltypes.Counterparty{PortId: "transfer", ChannelId: "channel-0"}, ConnectionHops: []string{"connection-0"}, Version: "ics20-1",
	})
	receive := func(sequence, height uint64, values map[string][]byte) {
		t.Helper()
		proof, _ := idleCheckpointProof(t, values, idleCheckpointCommitmentKey(sequence))
		response, err := app.IBCKeeper.RecvPacket(ctx, channeltypes.NewMsgRecvPacket(idleCheckpointPacket(sequence), proof, clienttypes.NewHeight(0, height), payer))
		require.NoError(t, err)
		require.Equal(t, channeltypes.SUCCESS, response.Result)
		acknowledgement, found := channels.GetPacketAcknowledgement(ctx, "transfer", "channel-0", sequence)
		require.True(t, found)
		require.NotEmpty(t, acknowledgement)
	}
	receive(1, 966, idleCheckpointLaneValues(t, 1))
	denom := transfer.ParseDenomTrace("transfer/channel-0/lovelace").IBCDenom()
	var outgoing []channeltypes.Packet
	for sequence := uint64(1); sequence <= 2; sequence++ {
		timeout := uint64(initialTime.Add(50 * time.Hour).UnixNano())
		_, err := app.TransferKeeper.Transfer(ctx, transfer.NewMsgTransfer("transfer", "channel-0", sdk.NewInt64Coin(denom, 10), payer, "cardano-test-receiver", clienttypes.ZeroHeight(), timeout, ""))
		require.NoError(t, err)
		data := transfer.NewFungibleTokenPacketData("transfer/channel-0/lovelace", "10", payer, "cardano-test-receiver", "").GetBytes()
		outgoing = append(outgoing, channeltypes.NewPacket(data, sequence, "transfer", "channel-0", "transfer", "channel-0", clienttypes.ZeroHeight(), timeout))
	}
	idleStart := ctx.BlockTime()
	apply := func(header *ProbabilisticHeader) {
		t.Helper()
		message, err := clienttypes.NewMsgUpdateClient(clientID, header, payer)
		require.NoError(t, err)
		_, err = app.IBCKeeper.UpdateClient(ctx, message)
		require.NoError(t, err)
		var found bool
		client, found = getClientState(store, cdc)
		require.True(t, found)
	}
	advance := func(trusted, anchor uint64, checkpoint bool) {
		t.Helper()
		header := idleCheckpointSourceHeader(t, history, "honest", trusted, anchor, true)
		header.IsCheckpoint = checkpoint
		if !checkpoint {
			// Consume the exact header emitted by Gateway's QueryService regression.
			header = &ProbabilisticHeader{}
			require.NoError(t, header.Unmarshal(readBoundaryGzip(t, "gateway-heartbeat-free.pb.gz")))
			require.Equal(t, anchor, header.AnchorBlock.Height.RevisionHeight)
			require.False(t, header.IsCheckpoint)
		}
		if anchor == 976 {
			header.DescendantBlocks = header.DescendantBlocks[:24]
		}
		require.Empty(t, header.HostStateTxHash)
		ctx = ctx.WithBlockTime(maxTime(ctx.BlockTime(), time.Unix(0, int64(header.DescendantBlocks[len(header.DescendantBlocks)-1].Timestamp))))
		steps, id, err := BuildObservationPlan(client, header, nil, 13, 4)
		require.NoError(t, err)
		for _, step := range steps {
			apply(step)
		}
		activation := &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: id, Sequence: steps[len(steps)-1].ObservationChunk.Sequence + 1}}
		apply(activation)
		if header.NewEpochContext != nil {
			for _, challenge := range client.EpochContextChallenges {
				ctx = ctx.WithBlockTime(maxTime(ctx.BlockTime(), time.Unix(0, int64(challenge.UsableAfterUnixNs)).Add(time.Second)))
			}
			activation.ObservationChunk.Sequence++
			apply(activation)
		}
		require.Equal(t, exported.Active, client.Status(ctx, store, cdc))
		if checkpoint {
			require.Equal(t, uint64(966), client.LatestHeight.RevisionHeight)
		}
	}
	trusted := uint64(966)
	for _, anchor := range []uint64{976, 1001, 1063, 1094, 1110} {
		advance(trusted, anchor, true)
		trusted = anchor
	}
	require.Greater(t, ctx.BlockTime().Sub(idleStart), 48*time.Hour)
	require.Equal(t, uint64(9), client.CurrentEpoch)
	// This ordinary observation authenticates the lane-only transaction and
	// publishes a fresh consensus state at the following empty block.
	advance(1110, 1126, false)
	fresh := client.LatestHeight
	proofHeight := clienttypes.NewHeight(0, fresh.RevisionHeight)
	require.Equal(t, uint64(1126), fresh.RevisionHeight)
	for _, block := range history.Honest.Blocks {
		if block.Height.RevisionHeight > 1126 {
			break
		}
		decoded, err := core.DecodeLedgerBlock(block.BlockCbor)
		require.NoError(t, err)
		require.Equal(t, block.Height.RevisionHeight == 1125, len(decoded.Transactions()) > 0)
	}
	consensus, found := GetConsensusState(store, cdc, fresh)
	require.True(t, found)
	require.Equal(t, initial.HostRoot, consensus.IbcStateRoot)
	require.Greater(t, time.Duration(consensus.Timestamp-history.Consensus.Timestamp), 48*time.Hour)
	values := idleCheckpointLaneValues(t, 2)
	ack := channeltypes.NewResultAcknowledgement([]byte{1}).Acknowledgement()
	values["acks/ports/transfer/channels/channel-0/sequences/1"] = channeltypes.CommitAcknowledgement(ack)
	values["receipts/ports/transfer/channels/channel-0/sequences/1"] = []byte{0x40}
	receive(2, fresh.RevisionHeight, values)
	ackProof, _ := idleCheckpointProof(t, values, "acks/ports/transfer/channels/channel-0/sequences/1")
	wrongAck := channeltypes.NewResultAcknowledgement([]byte{2}).Acknowledgement()
	_, err = app.IBCKeeper.Acknowledgement(ctx, channeltypes.NewMsgAcknowledgement(outgoing[0], wrongAck, ackProof, proofHeight, payer))
	require.Error(t, err)
	require.NotEmpty(t, channels.GetPacketCommitment(ctx, "transfer", "channel-0", 1))
	_, err = app.IBCKeeper.Acknowledgement(ctx, channeltypes.NewMsgAcknowledgement(outgoing[0], ack, ackProof, proofHeight, payer))
	require.NoError(t, err)
	require.Empty(t, channels.GetPacketCommitment(ctx, "transfer", "channel-0", 1))
	absence, _ := idleCheckpointProof(t, values, "receipts/ports/transfer/channels/channel-0/sequences/2")
	_, err = app.IBCKeeper.Timeout(ctx, channeltypes.NewMsgTimeout(outgoing[1], 0, absence, clienttypes.NewHeight(0, 966), payer))
	require.Error(t, err)
	require.NotEmpty(t, channels.GetPacketCommitment(ctx, "transfer", "channel-0", 2))
	_, err = app.IBCKeeper.Timeout(ctx, channeltypes.NewMsgTimeout(outgoing[1], 0, absence, proofHeight, payer))
	require.NoError(t, err)
	require.Empty(t, channels.GetPacketCommitment(ctx, "transfer", "channel-0", 2))
	require.Equal(t, "190", app.BankKeeper.GetBalance(ctx, idleCheckpointAddress(), denom).Amount.String())
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
