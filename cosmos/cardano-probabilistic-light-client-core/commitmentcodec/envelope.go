package commitmentcodec

import (
	"errors"
	"fmt"

	"github.com/fxamacker/cbor/v2"
)

// ErrUnsupportedCodec marks a leaf written by a commitment codec that this
// reader does not implement.
var ErrUnsupportedCodec = errors.New("unsupported Cardano commitment codec")

// envelopeTag is Plutus Data constructor 1. No Legacy8 or UpgradePath9 leaf is
// a top-level constructor 1, so an enveloped leaf cannot be read as one.
const envelopeTag = 122

// RequireSupportedCodec rejects a leaf written by a codec later than
// UpgradePath9. Legacy8 and UpgradePath9 leaves have no envelope. A later codec
// N writes every leaf as Plutus Data Constr 1 [N, payload] with N > 1, and
// codec numbers are never reused, so each leaf names the codec that wrote it.
// Call it on authenticated HostState leaf values before decoding them.
func RequireSupportedCodec(committed []byte) error {
	codec, enveloped, err := envelopeCodec(committed)
	if err != nil {
		return err
	}
	if !enveloped {
		return nil
	}
	if codec <= uint64(UpgradePath9) {
		return fmt.Errorf("%w: an envelope cannot name unenveloped codec %d", ErrUnsupportedCodec, codec)
	}
	return fmt.Errorf("%w %d", ErrUnsupportedCodec, codec)
}

func envelopeCodec(committed []byte) (uint64, bool, error) {
	// CBOR major type 6 is a tag.
	if len(committed) == 0 || committed[0]>>5 != 6 {
		return 0, false, nil
	}
	var tag cbor.RawTag
	if err := cbor.Unmarshal(committed, &tag); err != nil {
		return 0, false, err
	}
	if tag.Number != envelopeTag {
		return 0, false, nil
	}
	var fields []cbor.RawMessage
	if err := cbor.Unmarshal(tag.Content, &fields); err != nil || len(fields) != 2 {
		return 0, true, fmt.Errorf("%w: malformed envelope", ErrUnsupportedCodec)
	}
	var codec uint64
	if err := cbor.Unmarshal(fields[0], &codec); err != nil {
		return 0, true, fmt.Errorf("%w: malformed envelope codec", ErrUnsupportedCodec)
	}
	return codec, true, nil
}
