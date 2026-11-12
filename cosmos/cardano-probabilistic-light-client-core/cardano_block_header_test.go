package probabilisticcore

import (
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"io"
	"os"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
)

func previewBlockForHeaderDetection(t *testing.T) []byte {
	t.Helper()
	compressed, err := os.ReadFile("testdata/preview-block-4846910.cbor.gz")
	if err != nil {
		t.Fatal(err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestDecodeLedgerBlockAcceptsNestedPreviewRedeemer(t *testing.T) {
	block, err := DecodeLedgerBlock(previewBlockForHeaderDetection(t))
	if err != nil {
		t.Fatalf("decode Preview block with nested redeemer map: %v", err)
	}
	if block.BlockNumber() != 4_846_910 || block.Hash().String() != "ecea5dca941ec52645d41bc8f6a161793511c6323c50e32bf24b236c50117684" {
		t.Fatal("decoded block does not match its Preview header")
	}
	nonce, err := hex.DecodeString("25e7ec25915768e9f511635286ab9b7bfc4b66c0ca64cd674a10a8e5d54b7ee2")
	if err != nil {
		t.Fatal(err)
	}
	valid, _, err := VerifyNativeBlock(block, nonce, 129600, 62, fullStakePraosParameters())
	if err != nil || !valid {
		t.Fatalf("native verification rejected the Preview block: valid=%v err=%v", valid, err)
	}
}

func TestPrimaryDecoderRejectsMalformedTransactions(t *testing.T) {
	var fields []cbor.RawMessage
	if _, err := cbor.Decode(previewBlockForHeaderDetection(t), &fields); err != nil {
		t.Fatal(err)
	}
	// A valid header must not hide malformed transaction data.
	raw := append([]byte{0x85}, fields[0]...)
	raw = append(raw, 0xff)
	if _, err := decodePrimaryBlock(raw); err == nil {
		t.Fatal("primary decoder accepted malformed transaction data")
	}
	if _, err := DecodeLedgerBlock(raw); err == nil {
		t.Fatal("accepted a block with malformed transaction data")
	}
}

func TestHeaderDetectionStillRejectsChangedPreviewBody(t *testing.T) {
	var fields []cbor.RawMessage
	if _, err := cbor.Decode(previewBlockForHeaderDetection(t), &fields); err != nil {
		t.Fatal(err)
	}
	// Change the validity list while preserving the signed header and all
	// transactions. The body hash must no longer match.
	fields[4] = cbor.RawMessage{0x81, 0x00}
	raw, err := cbor.Encode(fields)
	if err != nil {
		t.Fatal(err)
	}
	block, err := DecodeLedgerBlock(raw)
	if err != nil {
		return
	}
	// The raw fallback can decode the changed body. It must still fail
	// authentication against the original signed header.
	bodyHash, err := BlockBodyHash(block)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := verifyNativeBlockBody(block, bodyHash)
	if err != nil || valid {
		t.Fatalf("changed body verification: valid=%v err=%v", valid, err)
	}
}

func TestHeaderDetectionRejectsTrailingBlockBytes(t *testing.T) {
	raw := append(previewBlockForHeaderDetection(t), 0x00)
	if _, err := DecodeLedgerBlock(raw); err == nil {
		t.Fatal("accepted trailing bytes after a complete block")
	}
}

func TestOrdinaryBlocksUseGouroborosDecoder(t *testing.T) {
	for _, fixture := range []string{"testdata/babbage_block.hex", "testdata/conway_block.hex"} {
		t.Run(fixture, func(t *testing.T) {
			block, err := DecodeLedgerBlock(readBlockFixture(t, fixture))
			if err != nil {
				t.Fatal(err)
			}
			if cause := BlockDecodeFallbackCause(block); cause != nil {
				t.Fatalf("ordinary block unexpectedly required the legacy parser: %v", cause)
			}
		})
	}
	block, err := DecodeLedgerBlock(previewBlockForHeaderDetection(t))
	if err != nil {
		t.Fatal(err)
	}
	if cause := BlockDecodeFallbackCause(block); cause != nil {
		t.Fatalf("Preview block unexpectedly required the legacy parser: %v", cause)
	}
}

func TestLegacyBlockPreservesPrimaryDecodeFailure(t *testing.T) {
	block, err := DecodeLedgerBlock(readBlockFixture(t, "testdata/babbage_host_state_tx_validity_block.hex"))
	if err != nil {
		t.Fatal(err)
	}
	if cause := BlockDecodeFallbackCause(block); cause == nil || cause.Error() == "" {
		t.Fatal("successful fallback discarded the primary decoder error")
	}
	if BlockDecodeFallbackCause(nil) != nil {
		t.Fatal("nil block has a fallback cause")
	}
}

func TestPrimaryDecoderDoesNotInferEraFromProducerVersion(t *testing.T) {
	for _, era := range []string{"babbage", "conway"} {
		t.Run(era, func(t *testing.T) {
			for _, major := range []uint64{7, 9, 12} {
				var fields, header, body []cbor.RawMessage
				if _, err := cbor.Decode(readBlockFixture(t, "testdata/"+era+"_block.hex"), &fields); err != nil {
					t.Fatal(err)
				}
				if _, err := cbor.Decode(fields[0], &header); err != nil {
					t.Fatal(err)
				}
				if _, err := cbor.Decode(header[0], &body); err != nil {
					t.Fatal(err)
				}
				encode := func(v any) cbor.RawMessage {
					raw, err := cbor.Encode(v)
					if err != nil {
						t.Fatal(err)
					}
					return raw
				}
				// Change only the producer capability. This tests decoding, not the
				// signature on the modified header or the network's hard-fork schedule.
				body[9] = encode([]uint64{major, 0})
				header[0] = encode(body)
				fields[0] = encode(header)
				block, err := DecodeLedgerBlock(encode(fields))
				if err != nil {
					t.Fatalf("producer major %d: %v", major, err)
				}
				if cause := BlockDecodeFallbackCause(block); cause != nil {
					t.Fatalf("producer major %d unexpectedly needed the legacy parser: %v", major, cause)
				}
			}
		})
	}
}
