package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	"os"
	"runtime"
	"strings"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/stretchr/testify/require"
)

func blockWithDeepNativeScript(t testing.TB, era string) []byte {
	t.Helper()
	encode := func(value any) cbor.RawMessage {
		raw, err := cbor.Encode(value)
		require.NoError(t, err)
		return raw
	}
	fixture, err := os.ReadFile("testdata/" + era + "_block.hex")
	require.NoError(t, err)
	raw, err := hex.DecodeString(strings.Join(strings.Fields(string(fixture)), ""))
	require.NoError(t, err)
	var fields, bodies []cbor.RawMessage
	_, err = cbor.Decode(raw, &fields)
	require.NoError(t, err)
	_, err = cbor.Decode(fields[1], &bodies)
	require.NoError(t, err)
	var body map[uint]cbor.RawMessage
	_, err = cbor.Decode(bodies[0], &body)
	require.NoError(t, err)
	// Each all-of script contains one child. The innermost all-of is empty.
	script := append(bytes.Repeat([]byte{0x82, 0x01, 0x81}, 5000), 0x82, 0x01, 0x80)
	reference := encode([]any{uint64(0), cbor.RawMessage(script)})
	address := append([]byte{0x60}, make([]byte, 28)...)
	body[1] = encode([]any{map[uint]any{
		0: address, 1: uint64(2000000),
		3: cbor.Tag{Number: 24, Content: []byte(reference)},
	}})
	bodies[0] = encode(body)
	fields[1] = encode(bodies)
	// Update the body commitment only. This is a decoder fixture, not a signed
	// ledger-valid block or a transaction submitted to a node.
	hash := rawBodyHash(rawBlockBodyFields{fields[1], fields[2], fields[3], fields[4]})
	var header, headerBody []cbor.RawMessage
	_, err = cbor.Decode(fields[0], &header)
	require.NoError(t, err)
	_, err = cbor.Decode(header[0], &headerBody)
	require.NoError(t, err)
	headerBody[7] = encode(hash[:])
	header[0] = encode(headerBody)
	fields[0] = encode(header)
	return encode(fields)
}

func TestDeepNativeReferenceScriptAllocation(t *testing.T) {
	for _, era := range []string{"babbage", "conway"} {
		raw := blockWithDeepNativeScript(t, era)
		for _, path := range []string{"primary", "fallback", "combined"} {
			t.Run(era+"/"+path, func(t *testing.T) {
				decode := nativeScriptDecoder(era, path)
				runtime.GC()
				var before, after runtime.MemStats
				runtime.ReadMemStats(&before)
				block, err := decode(raw)
				runtime.ReadMemStats(&after)
				require.NoError(t, err)
				// The old recursive decoder allocated about 142 MB for this 15 KB body.
				// Leave ample room for architecture and compiler differences.
				require.Less(t, after.TotalAlloc-before.TotalAlloc, uint64(8<<20))
				require.NoError(t, BlockDecodeFallbackCause(block))
				fields, err := extractRawBlockBodyFields(raw)
				require.NoError(t, err)
				hash, err := BlockBodyHash(block)
				require.NoError(t, err)
				valid, err := verifyRawBlockBody(fields, hash)
				require.NoError(t, err)
				require.True(t, valid)
			})
		}
	}
}

func nativeScriptDecoder(era, path string) func([]byte) (ledger.Block, error) {
	if path == "combined" {
		return DecodeLedgerBlock
	}
	if path == "primary" {
		blockType := uint(ledger.BlockTypeConway)
		if era == "babbage" {
			blockType = ledger.BlockTypeBabbage
		}
		return func(raw []byte) (ledger.Block, error) { return ledger.NewBlockFromCbor(blockType, raw) }
	}
	return func(raw []byte) (ledger.Block, error) {
		fields, body, err := rawBlockFields(raw)
		if err != nil {
			return nil, err
		}
		if era == "babbage" {
			return decodeRawBabbageBlock(raw, fields, body)
		}
		return decodeRawConwayBlock(raw, fields, body)
	}
}

func BenchmarkDeepNativeReferenceScript(b *testing.B) {
	for _, era := range []string{"babbage", "conway"} {
		raw := blockWithDeepNativeScript(b, era)
		for _, path := range []string{"primary", "fallback", "combined"} {
			b.Run(era+"/"+path, func(b *testing.B) {
				decode := nativeScriptDecoder(era, path)
				b.ReportAllocs()
				for b.Loop() {
					if _, err := decode(raw); err != nil {
						b.Fatal(err)
					}
				}
			})
		}
	}
}
