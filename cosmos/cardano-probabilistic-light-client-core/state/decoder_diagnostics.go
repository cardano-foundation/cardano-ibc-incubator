package state

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/blinklabs-io/gouroboros/ledger"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

const eventBlockDecodeFallback = "cardano_block_decode_fallback"
const maxDecoderDiagnosticBytes = 512

func emitBlockDecodeFallback(ctx Context, block ledger.Block) {
	cause := core.BlockDecodeFallbackCause(block)
	if cause == nil {
		return
	}
	ctx.emitEvent(eventBlockDecodeFallback,
		newEventAttribute("block_height", strconv.FormatUint(block.BlockNumber(), 10)),
		newEventAttribute("block_hash", block.Hash().String()),
		newEventAttribute("cause", boundedDecoderDiagnostic(cause.Error())),
	)
}

func boundedDecoderDiagnostic(cause string) string {
	var text strings.Builder
	text.Grow(maxDecoderDiagnosticBytes)
	for _, r := range cause {
		if unicode.IsControl(r) {
			r = ' '
		}
		if text.Len()+utf8.RuneLen(r) > maxDecoderDiagnosticBytes {
			break
		}
		text.WriteRune(r)
	}
	return text.String()
}
