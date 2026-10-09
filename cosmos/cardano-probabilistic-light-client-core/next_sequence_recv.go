package probabilisticcore

import (
	"encoding/binary"
	"fmt"
	"github.com/fxamacker/cbor/v2"
)

// Cardano commits a CBOR integer while ibc-go expects an eight-byte counter.
func VerifyNextSequenceRecvValue(committedValue, expectedValue []byte) error {
	if len(expectedValue) != 8 {
		return fmt.Errorf("invalid expected nextSequenceRecv length: %d (want 8)", len(expectedValue))
	}
	if len(committedValue) == 0 || committedValue[0]>>5 != 0 {
		return fmt.Errorf("committed nextSequenceRecv must be a CBOR unsigned integer")
	}
	var committedSequence uint64
	if err := cbor.Unmarshal(committedValue, &committedSequence); err != nil {
		return fmt.Errorf("failed to decode committed nextSequenceRecv CBOR: %w", err)
	}
	if committedSequence != binary.BigEndian.Uint64(expectedValue) {
		return fmt.Errorf("existence proof value mismatch")
	}
	return nil
}
