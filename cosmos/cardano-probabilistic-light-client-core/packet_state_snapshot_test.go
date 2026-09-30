package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	ics23 "github.com/cosmos/ics23/go"
	"os"
	"strings"
	"testing"

	ledgercbor "github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/fxamacker/cbor/v2"
	"golang.org/x/crypto/blake2b"
)

func snapshotBlock(t *testing.T, previous PacketStateSnapshot, txs []cbor.RawMessage) []byte {
	t.Helper()
	fields := []any{txs, make([]map[uint64]any, len(txs)), map[uint64]any{}, []uint{}}
	hashes := []byte{}
	encoded := []cbor.RawMessage{}
	for _, field := range fields {
		raw, err := cbor.Marshal(field)
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, raw)
		hash := blake2b.Sum256(raw)
		hashes = append(hashes, hash[:]...)
	}
	bodyHash := blake2b.Sum256(hashes)
	header := &ledger.ConwayBlockHeader{}
	header.Body.BlockNumber = previous.Height + 1
	parent, _ := hex.DecodeString(previous.BlockHash)
	header.Body.PrevHash = ledger.NewBlake2b256(parent)
	header.Body.BlockBodyHash = ledger.NewBlake2b256(bodyHash[:])
	rawHeader, err := ledgercbor.Encode(header)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cbor.Marshal([]any{cbor.RawMessage(rawHeader), encoded[0], encoded[1], encoded[2], encoded[3]})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func snapshotStart() PacketStateSnapshot {
	return PacketStateSnapshot{Height: 41, BlockHash: hex.EncodeToString(bytes.Repeat([]byte{3}, 32)), HostTxHash: hex.EncodeToString(bytes.Repeat([]byte{4}, 32)), HostRoot: make([]byte, 32), Lanes: map[string]TrackedPacketLane{}}
}

func snapshotLaneTx(t *testing.T, version uint64, previous *TrackedPacketLane, copies int) cbor.RawMessage {
	t.Helper()
	policy := bytes.Repeat([]byte{0x11}, 28)
	name, _ := PacketLaneTokenName("transfer", "channel-0", 1, 16)
	var tag cbor.RawTag
	var datum packetLaneDatum
	if err := cbor.Unmarshal(laneDatumFixture(t), &tag); err != nil {
		t.Fatal(err)
	}
	if err := cbor.Unmarshal(tag.Content, &datum); err != nil {
		t.Fatal(err)
	}
	datum.Version = version
	datum.Root = bytes.Repeat([]byte{byte(version)}, 32)
	rawDatum, _ := cbor.Marshal(cbor.Tag{Number: 121, Content: datum})
	output := map[uint64]any{0: append([]byte{0x70}, bytes.Repeat([]byte{2}, 28)...), 1: []any{uint64(5_000_000), map[cbor.ByteString]any{cbor.ByteString(policy): map[cbor.ByteString]uint64{cbor.ByteString(name): 1}}}, 2: []any{uint64(1), cbor.Tag{Number: 24, Content: rawDatum}}}
	outputs := []any{}
	for i := 0; i < copies; i++ {
		outputs = append(outputs, output)
	}
	inputs := []any{}
	if previous != nil {
		hash, _ := hex.DecodeString(previous.TxHash)
		inputs = append(inputs, []any{hash, uint64(previous.OutputIndex)})
	}
	body := map[uint64]any{0: inputs, 1: outputs, 2: uint64(version + 1), 22: uint64(1)}
	if version == 0 {
		body[9] = map[cbor.ByteString]any{cbor.ByteString(policy): map[cbor.ByteString]int64{cbor.ByteString(name): 1}}
	}
	raw, err := cbor.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func advanceSnapshot(t *testing.T, previous PacketStateSnapshot, blocks ...[]byte) (PacketStateSnapshot, error) {
	t.Helper()
	return AdvancePacketStateSnapshot(previous, blocks, bytes.Repeat([]byte{0x11}, 28), bytes.Repeat([]byte{0x22}, 28), []byte("ibc_host_state"))
}

func TestSnapshotCarriesOnlyCompletelyObservedLaneState(t *testing.T) {
	start := snapshotStart()
	initial := snapshotBlock(t, start, []cbor.RawMessage{snapshotLaneTx(t, 0, nil, 1)})
	issued, err := advanceSnapshot(t, start, initial)
	if err != nil {
		t.Fatal(err)
	}
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/1")
	empty, err := issued.PacketRoot(key, 42)
	if err != nil || !bytes.Equal(empty.Root, make([]byte, 32)) {
		t.Fatalf("initial lane: %+v %v", empty, err)
	}
	untouched := snapshotBlock(t, issued, []cbor.RawMessage{})
	later, err := advanceSnapshot(t, issued, untouched)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := later.PacketRoot(key, 43); err != nil {
		t.Fatal(err)
	}
	var previous TrackedPacketLane
	for _, lane := range later.Lanes {
		previous = lane
	}
	updatedBlock := snapshotBlock(t, later, []cbor.RawMessage{snapshotLaneTx(t, 1, &previous, 1)})
	updated, err := advanceSnapshot(t, later, updatedBlock)
	if err != nil {
		t.Fatal(err)
	}
	root, err := updated.PacketRoot(key, 44)
	if err != nil || !bytes.Equal(root.Root, bytes.Repeat([]byte{1}, 32)) {
		t.Fatalf("updated root: %+v %v", root, err)
	}
	if _, err := advanceSnapshot(t, issued, updatedBlock); err == nil {
		t.Fatal("accepted omitted intervening block")
	}
	if _, err := issued.PacketRoot(key, 44); err == nil {
		t.Fatal("old empty root relabelled at a later height")
	}
	if _, err := advanceSnapshot(t, later, initial); err == nil {
		t.Fatal("accepted rollback as forward progression")
	}
	if issued.Height != 42 {
		t.Fatal("mutated prior snapshot")
	}
	encoded, err := EncodePacketStateSnapshot(updated)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodePacketStateSnapshot(encoded); err != nil {
		t.Fatal(err)
	}
}

func TestSnapshotRejectsLostDuplicateOrSkippedLaneContinuation(t *testing.T) {
	start := snapshotStart()
	issued, err := advanceSnapshot(t, start, snapshotBlock(t, start, []cbor.RawMessage{snapshotLaneTx(t, 0, nil, 1)}))
	if err != nil {
		t.Fatal(err)
	}
	var previous TrackedPacketLane
	for _, lane := range issued.Lanes {
		previous = lane
	}
	for _, mutation := range []struct {
		version  uint64
		previous *TrackedPacketLane
		copies   int
	}{{1, &previous, 0}, {1, &previous, 2}, {2, &previous, 1}, {1, nil, 1}} {
		raw := snapshotBlock(t, issued, []cbor.RawMessage{snapshotLaneTx(t, mutation.version, mutation.previous, mutation.copies)})
		if _, err := advanceSnapshot(t, issued, raw); err == nil {
			t.Fatalf("accepted invalid continuation: %+v", mutation)
		}
	}
	raw := snapshotBlock(t, issued, []cbor.RawMessage{})
	var parts []cbor.RawMessage
	if err := cbor.Unmarshal(raw, &parts); err != nil {
		t.Fatal(err)
	}
	parts[1], _ = cbor.Marshal([]cbor.RawMessage{snapshotLaneTx(t, 1, &previous, 1)})
	tampered, _ := cbor.Marshal(parts)
	if _, err := advanceSnapshot(t, issued, tampered); err == nil {
		t.Fatal("accepted unauthenticated block body")
	}
}

func TestGatewaySnapshotCarriesUnchangedLaneOnlyAcrossAuthenticatedBodies(t *testing.T) {
	text, err := os.ReadFile("testdata/gateway-packet-snapshot.hex")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := hex.DecodeString(strings.TrimSpace(string(text)))
	if err != nil {
		t.Fatal(err)
	}
	initial, err := DecodePacketStateSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	if initial.Height != 42 || len(initial.Lanes) != 2 {
		t.Fatal("Gateway CBOR layout mismatch")
	}
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/1")
	existence, _ := packetLaneProof(key, nil)
	proof := &ics23.NonExistenceProof{Key: key, Left: existence}
	old, err := initial.PacketRoot(key, 42)
	if err != nil {
		t.Fatal(err)
	}
	if VerifyPacketLaneNonMembership(old, 43, key, proof) == nil {
		t.Fatal("accepted old root at new height")
	}
	block := snapshotBlock(t, initial, nil)
	next, err := AdvancePacketStateSnapshot(initial, [][]byte{block}, bytes.Repeat([]byte{1}, 28), bytes.Repeat([]byte{2}, 28), []byte("ibc_host_state"))
	if err != nil {
		t.Fatal(err)
	}
	root, err := next.PacketRoot(key, 43)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPacketLaneNonMembership(root, 43, key, proof); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(root.Root, old.Root) || root.Version != old.Version {
		t.Fatal("untouched lane changed")
	}
}

func TestPacketSnapshotRemovesOnlyAuthenticatedRetiredLane(t *testing.T) {
	start := snapshotStart()
	issued, err := advanceSnapshot(t, start, snapshotBlock(t, start, []cbor.RawMessage{snapshotLaneTx(t, 0, nil, 1)}))
	if err != nil {
		t.Fatal(err)
	}
	var old TrackedPacketLane
	for _, lane := range issued.Lanes {
		old = lane
	}
	for _, amount := range []int64{-2, -1, 0, 1} {
		raw := snapshotLaneTx(t, 1, &old, 0)
		var body map[uint64]cbor.RawMessage
		if err := cbor.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		policy := bytes.Repeat([]byte{0x11}, 28)
		name, _ := PacketLaneTokenName("transfer", "channel-0", 1, 16)
		body[9], _ = cbor.Marshal(map[cbor.ByteString]any{cbor.ByteString(policy): map[cbor.ByteString]int64{cbor.ByteString(name): amount}})
		raw, _ = cbor.Marshal(body)
		next, err := advanceSnapshot(t, issued, snapshotBlock(t, issued, []cbor.RawMessage{raw}))
		if amount == -1 {
			if err != nil {
				t.Fatal(err)
			}
			if len(next.Lanes) != 0 {
				t.Fatal("retired lane remains authenticated")
			}
			if _, err := next.PacketRoot([]byte("receipts/ports/transfer/channels/channel-0/sequences/1"), next.Height); err == nil {
				t.Fatal("retired lane supplied a newer absence proof")
			}
		} else if err == nil {
			t.Fatalf("accepted retirement mint %d", amount)
		}
	}
}
