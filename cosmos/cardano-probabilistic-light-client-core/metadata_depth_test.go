package probabilisticcore

import (
	"bytes"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"strconv"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/blinklabs-io/gouroboros/ledger/common"
	"github.com/stretchr/testify/require"
)

// Auxiliary data for transaction zero with label zero containing nested lists.
func nestedMetadataSet(depth int) []byte {
	raw := []byte{0xa1, 0x00, 0xa1, 0x00}
	raw = append(raw, bytes.Repeat([]byte{0x81}, depth)...)
	return append(raw, 0x00)
}

func TestMetadataBeyond1024LevelsIsAccepted(t *testing.T) {
	for _, depth := range []int{1023, 1024, 1025, 1100, cbor.MaxNestedLevels - 2} {
		t.Run(strconv.Itoa(depth), func(t *testing.T) {
			raw := nestedMetadataSet(depth)
			metadata, err := decodeTransactionMetadataSet(raw)
			require.NoError(t, err)
			stored, ok := metadata.GetRawMetadata(0)
			require.True(t, ok)
			require.Equal(t, raw[2:], []byte(stored))
			value, ok := metadata.GetMetadata(0)
			require.True(t, ok)
			labels, ok := value.(common.MetaMap)
			require.True(t, ok)
			require.Len(t, labels.Pairs, 1)
			value = labels.Pairs[0].Value
			for range depth {
				list, ok := value.(common.MetaList)
				require.True(t, ok)
				require.Len(t, list.Items, 1)
				value = list.Items[0]
			}
			integer, ok := value.(common.MetaInt)
			require.True(t, ok)
			require.Zero(t, integer.Value.Sign())
		})
	}
	// The envelope still enforces its finite CBOR depth bound.
	_, err := decodeTransactionMetadataSet(nestedMetadataSet(cbor.MaxNestedLevels - 1))
	require.ErrorContains(t, err, "exceeded max nested level")
}

func TestBlockDecodersAcceptDeepMetadata(t *testing.T) {
	for _, era := range []string{"babbage", "conway"} {
		t.Run(era, func(t *testing.T) {
			var fields []cbor.RawMessage
			_, err := cbor.Decode(readBlockFixture(t, "testdata/"+era+"_block.hex"), &fields)
			require.NoError(t, err)
			fields[3] = nestedMetadataSet(1100)
			bodyFields := rawBlockBodyFields{fields[1], fields[2], fields[3], fields[4]}
			hash := rawBodyHash(bodyFields)
			// Preserve the era's header shape and update its body commitment. This is
			// a decoder/body-authentication fixture, not a signed ledger-valid block.
			var header, headerBody []cbor.RawMessage
			_, err = cbor.Decode(fields[0], &header)
			require.NoError(t, err)
			_, err = cbor.Decode(header[0], &headerBody)
			require.NoError(t, err)
			headerBody[7], err = cbor.Encode(hash[:])
			require.NoError(t, err)
			header[0], err = cbor.Encode(headerBody)
			require.NoError(t, err)
			fields[0], err = cbor.Encode(header)
			require.NoError(t, err)
			raw, err := cbor.Encode(fields)
			require.NoError(t, err)
			blockType := uint(ledger.BlockTypeConway)
			if era == "babbage" {
				blockType = ledger.BlockTypeBabbage
			}
			primary, err := ledger.NewBlockFromCbor(blockType, raw)
			require.NoError(t, err)
			rawFields, rawBody, err := rawBlockFields(raw)
			require.NoError(t, err)
			var fallback ledger.Block
			if era == "babbage" {
				fallback, err = decodeRawBabbageBlock(raw, rawFields, rawBody)
			} else {
				fallback, err = decodeRawConwayBlock(raw, rawFields, rawBody)
			}
			require.NoError(t, err)
			decoded, err := DecodeLedgerBlock(raw)
			require.NoError(t, err)
			require.NoError(t, BlockDecodeFallbackCause(decoded), "primary decoding must not silently fall back")
			for _, block := range []ledger.Block{primary, fallback, decoded} {
				bodyHash, err := BlockBodyHash(block)
				require.NoError(t, err)
				valid, err := verifyRawBlockBody(rawBody, bodyHash)
				require.NoError(t, err)
				require.True(t, valid)
				changed := rawBody
				changed.transactionMetadataSet = bytes.Clone(rawBody.transactionMetadataSet)
				changed.transactionMetadataSet[len(changed.transactionMetadataSet)-1] = 1
				valid, err = verifyRawBlockBody(changed, bodyHash)
				require.NoError(t, err)
				require.False(t, valid, "metadata bytes must remain authenticated")
			}
		})
	}
}

func TestMetadataDecoderResourceBounds(t *testing.T) {
	const childEnv = "CARDANO_METADATA_DECODER_STRESS_CHILD"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestMetadataDecoderResourceBounds$", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		output, err := cmd.CombinedOutput()
		require.NoError(t, err, "%s", output)
		t.Logf("%s", output)
		return
	}
	previousStack := debug.SetMaxStack(32 << 20)
	defer debug.SetMaxStack(previousStack)
	previousMemory := debug.SetMemoryLimit(128 << 20)
	defer debug.SetMemoryLimit(previousMemory)
	raw := nestedMetadataSet(cbor.MaxNestedLevels - 2)
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	for range 16 {
		metadata, err := decodeTransactionMetadataSet(raw)
		require.NoError(t, err)
		_, ok := metadata.GetMetadata(0)
		require.True(t, ok)
	}
	runtime.ReadMemStats(&after)
	allocated := after.TotalAlloc - before.TotalAlloc
	require.Less(t, allocated, uint64(64<<20))
	t.Logf("16 maximum-depth metadata decodes allocated %d bytes with a 32 MiB stack cap and 128 MiB soft memory limit", allocated)
}

func BenchmarkMetadataDecoderNesting(b *testing.B) {
	for _, depth := range []int{32, 1100, 4096, cbor.MaxNestedLevels - 2} {
		b.Run(strconv.Itoa(depth), func(b *testing.B) {
			raw := nestedMetadataSet(depth)
			b.SetBytes(int64(len(raw)))
			b.ReportAllocs()
			for b.Loop() {
				if _, err := decodeTransactionMetadataSet(raw); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
