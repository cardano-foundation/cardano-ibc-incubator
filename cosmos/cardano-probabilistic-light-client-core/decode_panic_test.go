package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/blinklabs-io/gouroboros/ledger"
)

// Relayers supply block_cbor and header_cbor, so a decoder panic must not
// escape client verification (#687). The fuzz targets fail on any input the
// guard has to recover from, which catches a decoder regression after a
// gouroboros upgrade. CI runs them briefly; `go test` runs their seeds.

func readBlockFixture(tb testing.TB, path string) []byte {
	tb.Helper()
	fixtureHex, err := os.ReadFile(path)
	if err != nil {
		tb.Fatalf("read block fixture: %v", err)
	}
	blockCbor, err := hex.DecodeString(strings.Join(strings.Fields(string(fixtureHex)), ""))
	if err != nil {
		tb.Fatalf("decode block fixture: %v", err)
	}
	return blockCbor
}

var decodeFixtures = []string{
	"testdata/conway_block.hex",
	"testdata/babbage_block.hex",
	"testdata/babbage_host_state_tx_validity_block.hex",
}

func TestRecoverDecodePanicReturnsAnError(t *testing.T) {
	decode := func() (block ledger.Block, err error) {
		defer recoverDecodePanic(&block, &err)
		var empty []byte
		_ = empty[0]
		return nil, nil
	}

	block, err := decode()
	if block != nil || !errors.Is(err, ErrDecodePanicked) {
		t.Fatalf("expected a recovered decode panic, got block %v and error %v", block, err)
	}
}

// Single-byte corruptions from #687 that panicked gouroboros v0.89.1 in an
// output address decoder.
func TestMalformedBlockOutputsReturnDecodeErrors(t *testing.T) {
	for _, tc := range []struct {
		fixture string
		offset  int
	}{
		{"testdata/conway_block.hex", 5638},
		{"testdata/babbage_block.hex", 5765},
	} {
		blockCbor := readBlockFixture(t, tc.fixture)
		blockCbor[tc.offset] = 0x00
		if _, err := DecodeLedgerBlock(blockCbor); err == nil || errors.Is(err, ErrDecodePanicked) {
			t.Fatalf("%s: expected a decode error, got %v", tc.fixture, err)
		}
	}
}

func requireNoDecodePanic(t *testing.T, label string, err error) {
	t.Helper()
	if errors.Is(err, ErrDecodePanicked) {
		t.Fatalf("%s: %v", label, err)
	}
}

func FuzzDecodeLedgerBlock(f *testing.F) {
	for _, fixture := range decodeFixtures {
		blockCbor := readBlockFixture(f, fixture)
		f.Add(blockCbor)
		f.Add(blockCbor[:len(blockCbor)/2])
	}
	policyID := bytes.Repeat([]byte{0x24}, 28)
	tokenName := []byte("host-state")
	f.Fuzz(func(t *testing.T, blockCbor []byte) {
		block, err := DecodeLedgerBlock(blockCbor)
		requireNoDecodePanic(t, "decode block", err)
		if err != nil {
			return
		}
		_ = block.Hash()
		_ = block.BlockNumber()
		_ = block.SlotNumber()
		_, _ = blockPrevHashForFuzz(block)
		_, _ = BlockBodyHash(block)
		transactions := block.Transactions()
		for index, tx := range transactions {
			_ = tx.Hash()
			_ = tx.IsValid()
			_ = transactionIndexIsInvalid(block, uint(index))
			_, _ = ExtractTransactionBodyCbor(tx)
		}
		// Each extraction decodes the whole block again, so try one transaction.
		if len(transactions) == 0 {
			return
		}
		hostStateTxHash := transactions[len(transactions)-1].Hash().String()
		_, err = ExtractHostStateTxBodyCborFromAnchorBlock(blockCbor, hostStateTxHash)
		requireNoDecodePanic(t, "extract HostState transaction body", err)
		_, err = ExtractIbcStateRootFromAnchorBlock(blockCbor, hostStateTxHash, 0, policyID, tokenName)
		requireNoDecodePanic(t, "extract IBC state root", err)
	})
}

func FuzzDecodeLedgerHeader(f *testing.F) {
	for _, fixture := range decodeFixtures {
		block, err := DecodeLedgerBlock(readBlockFixture(f, fixture))
		if err != nil {
			f.Fatalf("decode %s: %v", fixture, err)
		}
		header, err := nativeBabbageHeader(block)
		if err != nil {
			f.Fatalf("header of %s: %v", fixture, err)
		}
		f.Add(header.Cbor())
	}
	f.Fuzz(func(t *testing.T, headerCbor []byte) {
		header, err := DecodeLedgerHeader(headerCbor)
		requireNoDecodePanic(t, "decode header", err)
		if err != nil {
			return
		}
		_ = header.Hash()
		_ = header.BlockNumber()
		_ = header.SlotNumber()
		_ = HeaderPrevHash(header)
		_ = HeaderBodyHash(header)
	})
}

func blockPrevHashForFuzz(block ledger.Block) (string, error) {
	header, err := nativeBabbageHeader(block)
	if err != nil {
		return "", err
	}
	return HeaderPrevHash(header), nil
}
