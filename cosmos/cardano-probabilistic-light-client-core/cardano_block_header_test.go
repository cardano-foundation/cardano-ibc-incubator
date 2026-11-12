package probabilisticcore

import (
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"io"
	"os"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
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

func TestDecodeLedgerBlockDetectsTypeFromPreviewHeader(t *testing.T) {
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

func TestBlockTypeDetectionDoesNotReadTransactions(t *testing.T) {
	var fields []cbor.RawMessage
	if _, err := cbor.Decode(previewBlockForHeaderDetection(t), &fields); err != nil {
		t.Fatal(err)
	}
	// A valid header followed by invalid transaction data must still identify
	// the era. Decoding the complete block must reject the malformed body.
	raw := append([]byte{0x85}, fields[0]...)
	raw = append(raw, 0xff)
	blockType, err := determineBlockType(raw)
	if err != nil || blockType != ledger.BlockTypeConway {
		t.Fatalf("header-only detection: type=%d err=%v", blockType, err)
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
	if _, err := DecodeLedgerBlock(raw); err == nil {
		t.Fatal("accepted a block with a changed body")
	}
}

func TestHeaderDetectionRejectsTrailingBlockBytes(t *testing.T) {
	raw := append(previewBlockForHeaderDetection(t), 0x00)
	if _, err := DecodeLedgerBlock(raw); err == nil {
		t.Fatal("accepted trailing bytes after a complete block")
	}
}
