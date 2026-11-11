package probabilisticcore

import (
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	fxcbor "github.com/fxamacker/cbor/v2"
)

func previewNestedBlock(t *testing.T) []byte {
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

func TestDecodeLedgerBlockAcceptsNestedPreviewBlock(t *testing.T) {
	raw := previewNestedBlock(t)
	block, err := DecodeLedgerBlock(raw)
	if err != nil {
		t.Fatalf("decode real Preview block: %v", err)
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
		t.Fatalf("native verification rejected the real Preview block: valid=%v err=%v", valid, err)
	}
}

func TestNestedPreviewBlockStillAuthenticatesItsCompleteBody(t *testing.T) {
	fields, _, err := rawBlockFields(previewNestedBlock(t))
	if err != nil {
		t.Fatal(err)
	}
	// Change the validity list while retaining the exact signed header.
	fields[4] = fxcbor.RawMessage{0x81, 0x00}
	tampered, err := fxcbor.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	block, err := DecodeLedgerBlock(tampered)
	if err != nil {
		t.Fatal(err)
	}
	bodyHash, err := BlockBodyHash(block)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := verifyNativeBlockBody(block, bodyHash)
	if err != nil || valid {
		t.Fatalf("changed body verification: valid=%v err=%v", valid, err)
	}
}

func TestRawBlockDecoderKeepsLedgerNestingBound(t *testing.T) {
	raw := append(bytes.Repeat([]byte{0x81}, cbor.MaxNestedLevels+1), 0x00)
	_, _, err := rawBlockFields(raw)
	if err == nil || !strings.Contains(err.Error(), "exceeded max nested level") {
		t.Fatalf("expected excessive nesting to be rejected, got %v", err)
	}
}
