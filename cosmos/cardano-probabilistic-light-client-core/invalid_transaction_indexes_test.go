package probabilisticcore

import (
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/stretchr/testify/require"
)

func TestInvalidTransactionIndexBounds(t *testing.T) {
	for _, tc := range []struct {
		name    string
		count   int
		indexes []uint
		invalid bool
	}{
		{"empty block", 0, []uint{}, false},
		{"first and last indexes", 3, []uint{0, 2}, false},
		{"preserve order and duplicates", 3, []uint{2, 0, 2}, false},
		{"index in empty block", 0, []uint{0}, true},
		{"index equals count", 1, []uint{1}, true},
		{"index exceeds count", 1, []uint{2}, true},
		{"maximum uint", 1, []uint{^uint(0)}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := cbor.Encode(tc.indexes)
			require.NoError(t, err)
			indexes, err := decodeInvalidTransactions(raw, tc.count)
			if tc.invalid {
				require.ErrorContains(t, err, "outside transaction list length")
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.indexes, indexes)
		})
	}
}

func TestFallbackRejectsOutOfRangeInvalidTransactionIndexes(t *testing.T) {
	for _, era := range []string{"babbage", "conway"} {
		t.Run(era, func(t *testing.T) {
			var fields, bodies []cbor.RawMessage
			_, err := cbor.Decode(readBlockFixture(t, "testdata/"+era+"_block.hex"), &fields)
			require.NoError(t, err)
			_, err = cbor.Decode(fields[1], &bodies)
			require.NoError(t, err)
			fields[4], err = cbor.Encode([]uint{uint(len(bodies))})
			require.NoError(t, err)
			raw, err := cbor.Encode(fields)
			require.NoError(t, err)
			// The index must be rejected structurally, before body authentication.
			blockType := uint(ledger.BlockTypeConway)
			if era == "babbage" {
				blockType = ledger.BlockTypeBabbage
			}
			_, err = ledger.NewBlockFromCbor(blockType, raw)
			require.ErrorContains(t, err, "outside transaction list length")
			rawFields, bodyFields, err := rawBlockFields(raw)
			require.NoError(t, err)
			if era == "babbage" {
				_, err = decodeRawBabbageBlock(raw, rawFields, bodyFields)
			} else {
				_, err = decodeRawConwayBlock(raw, rawFields, bodyFields)
			}
			require.ErrorContains(t, err, "outside transaction list length")
			block, err := DecodeLedgerBlock(raw)
			require.Error(t, err)
			require.Nil(t, block, "fallback must not undo the primary rejection")
		})
	}
}
