package probabilistic

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	datum "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/cardanodatum"
	transfer "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
)

func acceptanceProof(t *testing.T, values map[string][]byte, key string) ([]byte, []byte) {
	t.Helper()
	levels := make([]map[uint64][]byte, 65)
	levels[0] = map[uint64][]byte{}
	zero := make([]byte, 32)
	for k, v := range values {
		kh, vh := sha256.Sum256([]byte(k)), sha256.Sum256(v)
		leaf := sha256.Sum256(append(append([]byte{0}, kh[:]...), vh[:]...))
		index := binary.BigEndian.Uint64(kh[:8])
		require.Nil(t, levels[0][index], "fixture keys collide")
		levels[0][index] = leaf[:]
	}
	get := func(depth int, index uint64) []byte {
		if v := levels[depth][index]; v != nil {
			return v
		}
		return zero
	}
	for depth := 0; depth < 64; depth++ {
		levels[depth+1] = map[uint64][]byte{}
		for index := range levels[depth] {
			parent := index >> 1
			left, right := get(depth, parent<<1), get(depth, parent<<1|1)
			hash := sha256.Sum256(append(append([]byte{1}, left...), right...))
			levels[depth+1][parent] = hash[:]
		}
	}
	kh := sha256.Sum256([]byte(key))
	index := binary.BigEndian.Uint64(kh[:8])
	path := []*ics23.InnerOp{}
	for depth := 0; depth < 64; depth++ {
		sibling := get(depth, index^1)
		op := &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: []byte{1}}
		if index&1 == 0 {
			op.Suffix = sibling
		} else {
			op.Prefix = append(op.Prefix, sibling...)
		}
		path = append(path, op)
		index >>= 1
	}
	existence := &ics23.ExistenceProof{Key: []byte(key), Value: values[key], Path: path}
	proof := &ics23.CommitmentProof{Proof: &ics23.CommitmentProof_Exist{Exist: existence}}
	if len(values[key]) == 0 {
		proof = &ics23.CommitmentProof{Proof: &ics23.CommitmentProof_Nonexist{Nonexist: &ics23.NonExistenceProof{Key: []byte(key), Left: existence}}}
	}
	encoded, err := (&commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{proof}}).Marshal()
	require.NoError(t, err)
	root := get(64, 0)
	calculated, err := core.ComputeRootFromProofPath([]byte(key), values[key], path)
	require.NoError(t, err)
	require.Equal(t, root, calculated)
	return encoded, root
}
func acceptancePacket(sequence uint64) channeltypes.Packet {
	return acceptancePacketForReceiver(sequence, acceptanceAddress("operator").String())
}
func acceptancePacketForReceiver(sequence uint64, receiver string) channeltypes.Packet {
	data := transfer.NewFungibleTokenPacketData("lovelace", "100", "cardano-local-sender", receiver, "").GetBytes()
	return channeltypes.NewPacket(data, sequence, "transfer", "channel-0", "transfer", "channel-0", clienttypes.ZeroHeight(), uint64(time.Date(2090, 1, 1, 0, 0, 0, 0, time.UTC).UnixNano()))
}
func acceptanceCommitmentKey(sequence uint64) string {
	return fmt.Sprintf("commitments/ports/transfer/channels/channel-0/sequences/%d", sequence)
}
func acceptanceLaneValues(t *testing.T, count uint64) map[string][]byte {
	return acceptanceLaneValuesForReceiver(t, count, acceptanceAddress("operator").String())
}
func acceptanceLaneValuesForReceiver(t *testing.T, count uint64, receiver string) map[string][]byte {
	t.Helper()
	values := map[string][]byte{}
	for n := uint64(1); n <= count; n++ {
		values[acceptanceCommitmentKey(n)] = channeltypes.CommitPacket(nil, acceptancePacketForReceiver(n, receiver))
	}
	return values
}
func acceptanceCBOR(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := cbor.Marshal(value)
	require.NoError(t, err)
	return raw
}
func acceptanceChannelValues(t *testing.T) map[string][]byte {
	channel := datum.ChannelDatum{State: cbor.Tag{Number: 123, Content: []any{}}, Ordering: cbor.Tag{Number: 122, Content: []any{}}, Counterparty: datum.ChannelCounterpartyDatum{PortId: []byte("transfer"), ChannelId: []byte("channel-0")}, ConnectionHops: [][]byte{[]byte("connection-0")}, Version: []byte("ics20-1")}
	return map[string][]byte{"channelEnds/ports/transfer/channels/channel-0": acceptanceCBOR(t, channel)}
}
func acceptanceSource(t *testing.T, root string) acceptanceHistory {
	return acceptanceSourceForReceiver(t, root, acceptanceAddress("operator").String(), false)
}
func acceptanceSourceForReceiver(t *testing.T, root, receiver string, export bool) acceptanceHistory {
	t.Helper()
	_, hostRoot := acceptanceProof(t, acceptanceChannelValues(t), "channelEnds/ports/transfer/channels/channel-0")
	hash := blake2b.Sum256([]byte("native-bootstrap"))
	name, err := core.PacketLaneTokenName("transfer", "channel-0", 0, 1)
	require.NoError(t, err)
	_, laneRoot := acceptanceProof(t, acceptanceLaneValuesForReceiver(t, 1, receiver), acceptanceCommitmentKey(1))
	snapshot := core.PacketStateSnapshot{Height: 966, BlockHash: hex.EncodeToString(hash[:]), HostTxHash: fmt.Sprintf("%064x", 22), HostRoot: hostRoot, Lanes: map[string]core.TrackedPacketLane{hex.EncodeToString(name): {State: core.PacketLaneRoot{Height: 966, Port: "transfer", Channel: "channel-0", Lane: 0, LaneCount: 1, Version: 0, Root: laneRoot}, TxHash: fmt.Sprintf("%064x", 23), OutputIndex: 1}}}
	rawSnapshot, err := core.EncodePacketStateSnapshot(snapshot)
	require.NoError(t, err)
	transactions := map[uint64][]byte{}
	previousHost, previousLane := snapshot.HostTxHash, snapshot.Lanes[hex.EncodeToString(name)].TxHash
	for version, point := range []struct{ height, count uint64 }{{967, 1}, {1001, 2}, {1032, 2}, {1063, 3}, {1094, 4}, {1125, 5}} {
		_, laneRoot = acceptanceProof(t, acceptanceLaneValuesForReceiver(t, point.count, receiver), acceptanceCommitmentKey(1))
		heightDatum := cbor.Tag{Number: 121, Content: []uint64{0, 0}}
		commitments := map[uint64][]byte{}
		for n := uint64(1); n <= point.count; n++ {
			commitments[n] = channeltypes.CommitPacket(nil, acceptancePacketForReceiver(n, receiver))
		}
		laneDatum := cbor.Tag{Number: 121, Content: []any{[]byte("transfer"), []byte("channel-0"), uint64(0), uint64(1), uint64(version + 1), laneRoot, commitments, []uint64{}, map[uint64][]byte{}, heightDatum, heightDatum, map[string]uint64{}}}
		hostDatum := core.HostStateDatum{State: core.HostState{Version: 1, IbcStateRoot: hostRoot, BoundPort: []uint64{}}, NftPolicy: bytes.Repeat([]byte{1}, 28), Deployer: make([]byte, 28), Shutdown: cbor.RawMessage{0x80}}
		output := func(policy, name, datum []byte) map[uint64]any {
			return map[uint64]any{0: append([]byte{0x70}, bytes.Repeat([]byte{0x22}, 28)...), 1: []any{uint64(2_000_000), map[cbor.ByteString]any{cbor.ByteString(policy): map[cbor.ByteString]uint64{cbor.ByteString(name): 1}}}, 2: []any{uint64(1), cbor.Tag{Number: 24, Content: datum}}}
		}
		hostBytes, _ := hex.DecodeString(previousHost)
		laneBytes, _ := hex.DecodeString(previousLane)
		inputs := []any{[]any{hostBytes, uint64(0)}, []any{laneBytes, uint64(1)}}
		if version > 0 {
			inputs = append(inputs, []any{hostBytes, uint64(2)})
		}
		body := map[uint64]any{0: inputs, 1: []any{output(bytes.Repeat([]byte{1}, 28), []byte("host-state"), acceptanceCBOR(t, hostDatum)), output(bytes.Repeat([]byte{4}, 28), name, acceptanceCBOR(t, laneDatum)), map[uint64]any{0: append([]byte{0x70}, bytes.Repeat([]byte{0x33}, 28)...), 1: point.count * 100}}, 2: uint64(1)}
		raw := acceptanceCBOR(t, body)
		transactions[point.height] = raw
		txHash := blake2b.Sum256(raw)
		previousHost, previousLane = hex.EncodeToString(txHash[:]), hex.EncodeToString(txHash[:])
	}
	input := filepath.Join(root, "source-input.json")
	output := filepath.Join(root, "source-history.json")
	acceptanceWriteJSON(t, input, map[string]any{"Transactions": transactions, "Snapshot": rawSnapshot})
	var history acceptanceHistory
	if export || os.Getenv("UPDATE_NATIVE_RECOVERY_FIXTURE") == "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		command := exec.CommandContext(ctx, "go", "test", "./state", "-run", "^TestExportAcceptanceHistory$", "-count=1", "-timeout=5m")
		command.Dir = "../cardano-probabilistic-light-client-core"
		command.Env = append(os.Environ(), "CARIBIC_ACCEPTANCE_HISTORY_INPUT="+input, "CARIBIC_ACCEPTANCE_HISTORY_OUTPUT="+output)
		log, err := command.CombinedOutput()
		require.NoError(t, err, string(log))
		acceptanceReadJSON(t, output, &history)
		if !export {
			file, err := os.Create("../cardano-probabilistic-light-client-core/testdata/native-recovery.json.gz")
			require.NoError(t, err)
			writer := gzip.NewWriter(file)
			require.NoError(t, json.NewEncoder(writer).Encode(history))
			require.NoError(t, writer.Close())
			require.NoError(t, file.Close())
		}
	} else {
		require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "native-recovery.json.gz"), &history))
	}
	// Source time is a trusted local deployment parameter. Slots and all native
	// signatures are unchanged. Host challenge periods use real committed time.
	newest := history.Honest.Blocks[len(history.Honest.Blocks)-1].Timestamp
	delta := time.Now().Add(-5*time.Minute).UnixNano() - int64(newest)
	history.Client.SystemStartUnixNs = uint64(int64(history.Client.SystemStartUnixNs) + delta)
	history.Client.LatestCheckpointTimestamp = uint64(int64(history.Client.LatestCheckpointTimestamp) + delta)
	history.Consensus.Timestamp = uint64(int64(history.Consensus.Timestamp) + delta)
	for _, blocks := range [][]*ProbabilisticBlock{history.Honest.Blocks, history.Bad.Blocks, history.Tail.Blocks} {
		for _, block := range blocks {
			block.Timestamp = uint64(int64(block.Timestamp) + delta)
		}
	}
	acceptanceWriteJSON(t, output, history)
	return history
}

// The Injective node uses its own ethsecp256k1 address. Produce native signed
// Cardano bodies containing commitments for that recipient before any node runs.
func TestExportInjectiveLifecycleHistory(t *testing.T) {
	root, receiver := os.Getenv("INJECTIVE_LIFECYCLE_FIXTURE_DIR"), os.Getenv("INJECTIVE_LIFECYCLE_RECEIVER")
	if root == "" || receiver == "" {
		t.Skip("called by the local Injective lifecycle driver")
	}
	require.NoError(t, os.MkdirAll(root, 0700))
	history := acceptanceSourceForReceiver(t, root, receiver, true)
	headers := map[string]*ProbabilisticHeader{}
	for _, step := range []struct {
		name, branch    string
		trusted, anchor uint64
	}{{"baseline", "honest", 966, 967}, {"proposal", "bad", 967, 1001}, {"honest", "honest", 967, 1001}, {"replacement", "honest", 1001, 1032}, {"ordinary", "honest", 1032, 1063}, {"boundary", "honest", 1063, 1094}, {"restart", "honest", 1094, 1125}} {
		headers[step.name] = acceptanceHeader(t, history, step.branch, step.trusted, step.anchor)
	}
	acceptanceWriteJSON(t, filepath.Join(root, "headers.json"), headers)
	channelProof, _ := acceptanceProof(t, acceptanceChannelValues(t), "channelEnds/ports/transfer/channels/channel-0")
	acceptanceWriteJSON(t, filepath.Join(root, "channel-proof.json"), map[string]any{"proof": channelProof})
	for _, point := range []struct{ anchor, count uint64 }{{967, 1}, {1001, 2}, {1032, 2}, {1063, 3}, {1094, 4}, {1125, 5}} {
		for sequence := uint64(1); sequence <= point.count; sequence++ {
			proof, _ := acceptanceProof(t, acceptanceLaneValuesForReceiver(t, point.count, receiver), acceptanceCommitmentKey(sequence))
			acceptanceWriteJSON(t, filepath.Join(root, fmt.Sprintf("packet-%d-%d.json", point.anchor, sequence)), map[string]any{"packet": acceptancePacketForReceiver(sequence, receiver), "proof_commitment": proof, "proof_height": NewHeight(0, point.anchor), "signer": receiver})
		}
	}
	acceptanceWriteJSON(t, filepath.Join(root, "fixture-metadata.json"), map[string]any{"receiver": receiver, "trusted_height": history.Client.LatestCheckpointHeight, "scope": "Native signed Cardano fixture bodies and headers for a disposable Injective node"})
}
func acceptanceHeader(t *testing.T, history acceptanceHistory, branch string, trusted, anchor uint64) *ProbabilisticHeader {
	t.Helper()
	blocks, contexts := history.Honest.Blocks, history.Honest.Contexts
	if branch == "bad" {
		blocks, contexts = history.Bad.Blocks, history.Bad.Contexts
	}
	if branch == "tail" {
		blocks, contexts = history.Tail.Blocks, history.Tail.Contexts
	}
	h := &ProbabilisticHeader{TrustedHeight: NewHeight(0, trusted)}
	for _, b := range blocks {
		if b.Height.RevisionHeight <= trusted || b.Height.RevisionHeight > anchor+30 {
			continue
		}
		copy := cloneTestProbabilisticBlock(b)
		if b.Height.RevisionHeight < anchor {
			h.BridgeBlocks = append(h.BridgeBlocks, copy)
		} else if b.Height.RevisionHeight == anchor {
			h.AnchorBlock = copy
			block, err := core.DecodeLedgerBlock(b.BlockCbor)
			require.NoError(t, err)
			require.Len(t, block.Transactions(), 1)
			h.HostStateTxHash = block.Transactions()[0].Hash().String()
		} else {
			h.DescendantBlocks = append(h.DescendantBlocks, copy)
		}
	}
	trustedEpoch := uint64(7)
	if trusted >= 1001 {
		trustedEpoch = 8
	}
	if trusted >= 1094 {
		trustedEpoch = 9
	}
	if h.AnchorBlock.Epoch > trustedEpoch {
		for _, c := range contexts {
			if c.Epoch == h.AnchorBlock.Epoch {
				h.NewEpochContext = fromCoreEpochContext(toCoreEpochContext(c))
			}
		}
	}
	require.NoError(t, h.ValidateBasic())
	return h
}

// Keep malformed or discontinuous signed fixtures from costing a full live
// response window before failing. The acceptance run still uses signed RPC
// transactions and the real destination keeper for every state change.
func TestAcceptanceSourceContinuity(t *testing.T) {
	history := acceptanceSource(t, t.TempDir())
	ctx, store := newProbabilisticTestClientStore(t, "acceptance-source-continuity")
	ctx = ctx.WithBlockTime(time.Now())
	cdc := newProbabilisticTestCodec()
	require.NoError(t, history.Client.Initialize(ctx, cdc, store, history.Consensus))
	ctx = ctx.WithBlockTime(ctx.BlockTime().Add(3 * time.Minute))
	trusted := uint64(966)
	for _, anchor := range []uint64{967, 1001, 1032, 1063, 1094, 1125} {
		state, found := getClientState(store, cdc)
		require.True(t, found)
		header := acceptanceHeader(t, history, "honest", trusted, anchor)
		require.NoError(t, state.VerifyClientMessage(ctx, cdc, store, header), "anchor %d", anchor)
		state.UpdateState(ctx, cdc, store, header)
		if anchor == 1001 {
			state, found = getClientState(store, cdc)
			require.True(t, found)
			bad := acceptanceHeader(t, history, "bad", 967, 1001)
			require.NoError(t, state.VerifyClientMessage(ctx, cdc, store, NewMisbehaviour(acceptanceSubject, header, bad)))
			tail := acceptanceHeader(t, history, "tail", 967, 1001)
			require.ErrorContains(t, state.VerifyClientMessage(ctx, cdc, store, NewMisbehaviour(acceptanceSubject, header, tail)), "do not conflict")
		}
		if header.NewEpochContext != nil {
			ctx = ctx.WithBlockTime(ctx.BlockTime().Add(3 * time.Minute))
		}
		trusted = anchor
	}
}
