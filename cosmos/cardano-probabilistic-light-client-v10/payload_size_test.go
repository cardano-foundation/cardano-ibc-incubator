package probabilistic

import (
	"bytes"
	"fmt"
	"testing"
)

const (
	payloadTestFullBlockCBORBytes     = 17_943
	payloadTestHeaderCBORBytes        = 860
	payloadTestDescendantBlocks       = 24
	payloadTestCheckpointBridgeBlocks = 32
)

var (
	payloadTestFullBlockCBOR = bytes.Repeat([]byte{0x82}, payloadTestFullBlockCBORBytes)
	payloadTestHeaderCBOR    = bytes.Repeat([]byte{0x83}, payloadTestHeaderCBORBytes)
)

func TestProbabilisticHeaderPayloadSizeRegression(t *testing.T) {
	tests := []struct {
		name                   string
		checkpoint             bool
		wantBlocks             int
		wantCompactBytes       int
		minimumReductionFactor int
	}{
		{
			name:                   "minimum root update",
			wantBlocks:             25,
			wantCompactBytes:       41_033,
			minimumReductionFactor: 10,
		},
		{
			name:                   "bounded checkpoint",
			checkpoint:             true,
			wantBlocks:             57,
			wantCompactBytes:       54_442,
			minimumReductionFactor: 15,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			compact := newPayloadTestHeader(test.checkpoint, true)
			legacyFull := newPayloadTestHeader(test.checkpoint, false)

			compactWire := marshalPayloadTestHeader(t, compact)
			legacyFullWire := marshalPayloadTestHeader(t, legacyFull)
			if got := len(compactWire); got != test.wantCompactBytes {
				t.Fatalf("compact protobuf size = %d bytes, want %d", got, test.wantCompactBytes)
			}
			if len(compactWire)*test.minimumReductionFactor >= len(legacyFullWire) {
				t.Fatalf(
					"compact protobuf size %d is not at least %dx smaller than legacy full-witness size %d",
					len(compactWire),
					test.minimumReductionFactor,
					len(legacyFullWire),
				)
			}

			decodedCompact := unmarshalPayloadTestHeader(t, compactWire)
			assertPayloadTestShape(t, decodedCompact, test.checkpoint, test.wantBlocks, true)
			if err := decodedCompact.ValidateBasic(); err != nil {
				t.Fatalf("compact protobuf failed structural validation: %v", err)
			}

			// Field 9 remains decodable so updates produced before header_cbor was
			// introduced do not become unreadable at the protobuf boundary.
			decodedLegacyFull := unmarshalPayloadTestHeader(t, legacyFullWire)
			assertPayloadTestShape(t, decodedLegacyFull, test.checkpoint, test.wantBlocks, false)
			if err := decodedLegacyFull.ValidateBasic(); err != nil {
				t.Fatalf("legacy full-witness protobuf failed structural validation: %v", err)
			}

			t.Logf(
				"compact=%d bytes legacy-full=%d bytes reduction=%.1fx",
				len(compactWire),
				len(legacyFullWire),
				float64(len(legacyFullWire))/float64(len(compactWire)),
			)
		})
	}
}

func BenchmarkProbabilisticHeaderDecode(b *testing.B) {
	tests := []struct {
		name       string
		checkpoint bool
		compact    bool
	}{
		{name: "minimum_root/legacy_full"},
		{name: "minimum_root/compact", compact: true},
		{name: "bounded_checkpoint/legacy_full", checkpoint: true},
		{name: "bounded_checkpoint/compact", checkpoint: true, compact: true},
	}

	for _, test := range tests {
		payload, err := newPayloadTestHeader(test.checkpoint, test.compact).Marshal()
		if err != nil {
			b.Fatalf("marshal benchmark payload: %v", err)
		}
		b.Run(test.name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(payload)))
			for i := 0; i < b.N; i++ {
				var decoded ProbabilisticHeader
				if err := decoded.Unmarshal(payload); err != nil {
					b.Fatalf("unmarshal benchmark payload: %v", err)
				}
			}
		})
	}
}

func newPayloadTestHeader(checkpoint bool, compact bool) *ProbabilisticHeader {
	const trustedHeight uint64 = 1_000

	header := &ProbabilisticHeader{
		TrustedHeight: NewHeight(0, trustedHeight),
		IsCheckpoint:  checkpoint,
	}
	nextHeight := trustedHeight + 1
	if checkpoint {
		header.BridgeBlocks = make([]*ProbabilisticBlock, 0, payloadTestCheckpointBridgeBlocks)
		for range payloadTestCheckpointBridgeBlocks {
			header.BridgeBlocks = append(header.BridgeBlocks, newPayloadTestBlock(nextHeight, compact))
			nextHeight++
		}
	} else {
		header.HostStateTxHash = fmt.Sprintf("%064x", nextHeight)
		header.HostStateTxOutputIndex = 1
	}

	// Root-bearing anchors need their transaction body, while a rootless
	// checkpoint anchor can be authenticated from its signed header alone.
	header.AnchorBlock = newPayloadTestBlock(nextHeight, checkpoint && compact)
	nextHeight++
	header.DescendantBlocks = make([]*ProbabilisticBlock, 0, payloadTestDescendantBlocks)
	for range payloadTestDescendantBlocks {
		header.DescendantBlocks = append(header.DescendantBlocks, newPayloadTestBlock(nextHeight, compact))
		nextHeight++
	}

	return header
}

func newPayloadTestBlock(height uint64, compact bool) *ProbabilisticBlock {
	block := &ProbabilisticBlock{
		Height:    NewHeight(0, height),
		Slot:      10_000_000 + height,
		Hash:      fmt.Sprintf("%064x", height),
		Epoch:     500,
		Timestamp: 1_700_000_000_000_000_000 + height*1_000_000_000,
	}
	if compact {
		block.HeaderCbor = payloadTestHeaderCBOR
	} else {
		block.BlockCbor = payloadTestFullBlockCBOR
	}
	return block
}

func marshalPayloadTestHeader(t *testing.T, header *ProbabilisticHeader) []byte {
	t.Helper()
	payload, err := header.Marshal()
	if err != nil {
		t.Fatalf("marshal probabilistic header: %v", err)
	}
	return payload
}

func unmarshalPayloadTestHeader(t *testing.T, payload []byte) *ProbabilisticHeader {
	t.Helper()
	var header ProbabilisticHeader
	if err := header.Unmarshal(payload); err != nil {
		t.Fatalf("unmarshal probabilistic header: %v", err)
	}
	return &header
}

func assertPayloadTestShape(
	t *testing.T,
	header *ProbabilisticHeader,
	checkpoint bool,
	wantBlocks int,
	compact bool,
) {
	t.Helper()
	wantBridgeBlocks := 0
	if checkpoint {
		wantBridgeBlocks = payloadTestCheckpointBridgeBlocks
	}
	if got := len(header.BridgeBlocks); got != wantBridgeBlocks {
		t.Fatalf("decoded bridge block count = %d, want %d", got, wantBridgeBlocks)
	}
	if header.AnchorBlock == nil {
		t.Fatal("decoded anchor block is nil")
	}
	if got := len(header.DescendantBlocks); got != payloadTestDescendantBlocks {
		t.Fatalf("decoded descendant block count = %d, want %d", got, payloadTestDescendantBlocks)
	}
	blocks := make([]*ProbabilisticBlock, 0, len(header.BridgeBlocks)+1+len(header.DescendantBlocks))
	blocks = append(blocks, header.BridgeBlocks...)
	blocks = append(blocks, header.AnchorBlock)
	blocks = append(blocks, header.DescendantBlocks...)
	if got := len(blocks); got != wantBlocks {
		t.Fatalf("decoded block count = %d, want %d", got, wantBlocks)
	}
	if header.IsCheckpoint != checkpoint {
		t.Fatalf("decoded is_checkpoint = %t, want %t", header.IsCheckpoint, checkpoint)
	}

	for i, block := range blocks {
		wantHeader := compact && (checkpoint || block != header.AnchorBlock)
		if wantHeader {
			if got := len(block.HeaderCbor); got != payloadTestHeaderCBORBytes {
				t.Fatalf("block %d header_cbor size = %d, want %d", i, got, payloadTestHeaderCBORBytes)
			}
			if len(block.BlockCbor) != 0 {
				t.Fatalf("block %d unexpectedly retained block_cbor in compact payload", i)
			}
			continue
		}
		if got := len(block.BlockCbor); got != payloadTestFullBlockCBORBytes {
			t.Fatalf("block %d block_cbor size = %d, want %d", i, got, payloadTestFullBlockCBORBytes)
		}
		if len(block.HeaderCbor) != 0 {
			t.Fatalf("block %d unexpectedly contains header_cbor in full-witness payload", i)
		}
	}
}
