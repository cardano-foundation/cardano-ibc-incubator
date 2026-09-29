package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	ledgercbor "github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/fxamacker/cbor/v2"
)

func laneDatumFixture(t *testing.T) []byte {
	t.Helper()
	height, err := cbor.Marshal(cbor.Tag{Number: 121, Content: []uint64{0, 0}})
	if err != nil {
		t.Fatal(err)
	}
	datum := packetLaneDatum{
		Port: []byte("transfer"), Channel: []byte("channel-0"), Lane: 7, LaneCount: 16,
		Version: 1, Root: bytes.Repeat([]byte{0xab}, 32),
		Commitments: cbor.RawMessage{0xa0}, Receipts: cbor.RawMessage{0x80},
		Acknowledgements: cbor.RawMessage{0xa0}, MinimumReceiveProofHeight: height,
		MaximumReceiveProofHeight: height,
	}
	raw, err := cbor.Marshal(cbor.Tag{Number: 121, Content: datum})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestPacketLaneDatumBindsIdentity(t *testing.T) {
	raw := laneDatumFixture(t)
	root, err := decodePacketLaneRoot(raw, 42, "transfer", "channel-0", 7, 16)
	if err != nil || root.Height != 42 || root.Version != 1 || !bytes.Equal(root.Root, bytes.Repeat([]byte{0xab}, 32)) {
		t.Fatalf("decode root: %+v, %v", root, err)
	}
	for _, lane := range []uint32{0, 8, 16} {
		if _, err := decodePacketLaneRoot(raw, 42, "transfer", "channel-0", lane, 16); err == nil {
			t.Fatalf("accepted wrong lane %d", lane)
		}
	}
	if _, err := decodePacketLaneRoot(raw, 42, "transfer", "channel-0", 7, 32); err == nil {
		t.Fatal("accepted different partition count")
	}
	if _, err := decodePacketLaneRoot(raw, 42, "transfer", "channel-1", 7, 16); err == nil {
		t.Fatal("accepted different channel")
	}
	if _, err := decodePacketLaneRoot(raw[2:], 42, "transfer", "channel-0", 7, 16); err == nil {
		t.Fatal("accepted untagged datum")
	}
}

func laneBlockFixture(t *testing.T, invalid []uint, spentLater bool) ([]byte, string, []byte) {
	t.Helper()
	policy := bytes.Repeat([]byte{0x11}, 28)
	name, err := PacketLaneTokenName("transfer", "channel-0", 7, 16)
	if err != nil {
		t.Fatal(err)
	}
	output := map[uint64]any{
		0: append([]byte{0x70}, bytes.Repeat([]byte{0x22}, 28)...),
		1: []any{uint64(2_000_000), map[cbor.ByteString]any{
			cbor.ByteString(policy): map[cbor.ByteString]uint64{cbor.ByteString(name): 1},
		}},
		2: []any{uint64(1), cbor.Tag{Number: 24, Content: laneDatumFixture(t)}},
	}
	bodyRaw, err := cbor.Marshal(map[uint64]any{0: []any{}, 1: []any{output}, 2: uint64(1), 22: uint64(1)})
	if err != nil {
		t.Fatal(err)
	}
	body, err := ledger.NewConwayTransactionBodyFromCbor(bodyRaw)
	if err != nil {
		t.Fatal(err)
	}
	bodies := []cbor.RawMessage{bodyRaw}
	witnesses := []map[uint64]any{{}}
	if spentLater {
		hash, _ := hex.DecodeString(body.Hash())
		laterRaw, marshalErr := cbor.Marshal(map[uint64]any{
			0: []any{[]any{hash, uint64(0)}}, 1: []any{}, 2: uint64(2), 22: uint64(1),
		})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		bodies = append(bodies, laterRaw)
		witnesses = append(witnesses, map[uint64]any{})
	}
	header := &ledger.ConwayBlockHeader{}
	header.Body.BlockNumber = 42
	headerRaw, err := ledgercbor.Encode(header)
	if err != nil {
		t.Fatal(err)
	}
	block, err := cbor.Marshal([]any{cbor.RawMessage(headerRaw), bodies, witnesses, map[uint]any{}, invalid})
	if err != nil {
		t.Fatal(err)
	}
	return block, body.Hash(), policy
}

func TestPacketLaneExtractsRootFromActualAnchorHeight(t *testing.T) {
	block, hash, policy := laneBlockFixture(t, []uint{}, false)
	root, err := ExtractPacketLaneRootFromAnchorBlock(block, hash, 0, policy, "transfer", "channel-0", 7, 16)
	if err != nil || root.Height != 42 || root.Lane != 7 {
		t.Fatalf("extract root: %+v, %v", root, err)
	}
	policy[0] = 0x44
	if _, err := ExtractPacketLaneRootFromAnchorBlock(block, hash, 0, policy, "transfer", "channel-0", 7, 16); err == nil {
		t.Fatal("accepted counterfeit lane policy")
	}
}

func TestPacketLaneRejectsInvalidOrSupersededOutput(t *testing.T) {
	for _, tc := range []struct {
		invalid []uint
		spent   bool
		error   string
	}{
		{[]uint{0}, false, "phase-2 invalid"},
		{[]uint{}, true, "spent within anchor block"},
	} {
		block, hash, policy := laneBlockFixture(t, tc.invalid, tc.spent)
		_, err := ExtractPacketLaneRootFromAnchorBlock(block, hash, 0, policy, "transfer", "channel-0", 7, 16)
		if err == nil || !strings.Contains(err.Error(), tc.error) {
			t.Fatalf("expected %q, got %v", tc.error, err)
		}
	}
}

func TestPacketLaneInvalidLaterTransactionDoesNotSpendItsNormalInputs(t *testing.T) {
	block, hash, policy := laneBlockFixture(t, []uint{1}, true)
	if _, err := ExtractPacketLaneRootFromAnchorBlock(block, hash, 0, policy, "transfer", "channel-0", 7, 16); err != nil {
		t.Fatalf("phase-2 invalid later transaction consumed a normal input: %v", err)
	}
}
