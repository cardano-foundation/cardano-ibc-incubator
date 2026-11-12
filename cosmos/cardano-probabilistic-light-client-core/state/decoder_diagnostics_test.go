package state

import (
	"encoding/hex"
	"os"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"github.com/stretchr/testify/require"
)

func TestDecoderFallbackEmitsDiagnosticWithoutChangingDecodeResult(t *testing.T) {
	rawHex, err := os.ReadFile("../testdata/babbage_host_state_tx_validity_block.hex")
	require.NoError(t, err)
	raw, err := hex.DecodeString(strings.Join(strings.Fields(string(rawHex)), ""))
	require.NoError(t, err)
	block, err := core.DecodeLedgerBlock(raw)
	require.NoError(t, err)
	cause := core.BlockDecodeFallbackCause(block)
	require.NotNil(t, cause)
	count := 0
	ctx := Context{EmitEvent: func(name string, attrs ...EventAttribute) {
		count++
		require.Equal(t, "cardano_block_decode_fallback", name)
		got := map[string]string{}
		for _, attr := range attrs {
			got[attr.Key] = attr.Value
		}
		require.Equal(t, strconv.FormatUint(block.BlockNumber(), 10), got["block_height"])
		require.Equal(t, block.Hash().String(), got["block_hash"])
		require.Equal(t, boundedDecoderDiagnostic(cause.Error()), got["cause"])
	}}
	emitBlockDecodeFallback(ctx, block)
	require.Equal(t, 1, count)
	emitBlockDecodeFallback(Context{}, block)
}

func TestOrdinaryBlockDoesNotEmitDecoderFallback(t *testing.T) {
	rawHex, err := os.ReadFile("../testdata/conway_block.hex")
	require.NoError(t, err)
	raw, err := hex.DecodeString(strings.Join(strings.Fields(string(rawHex)), ""))
	require.NoError(t, err)
	block, err := core.DecodeLedgerBlock(raw)
	require.NoError(t, err)
	emitBlockDecodeFallback(Context{EmitEvent: func(string, ...EventAttribute) {
		t.Fatal("ordinary decoding emitted a fallback warning")
	}}, block)
}

func TestDecoderDiagnosticIsBoundedValidText(t *testing.T) {
	cause := "decoder failed\n\r\x00\xff" + strings.Repeat("界", 1024)
	text := boundedDecoderDiagnostic(cause)
	require.LessOrEqual(t, len(text), maxDecoderDiagnosticBytes)
	require.True(t, utf8.ValidString(text))
	require.NotContains(t, text, "\n")
	require.NotContains(t, text, "\r")
	require.NotContains(t, text, "\x00")
	require.Contains(t, text, "decoder failed")
}
