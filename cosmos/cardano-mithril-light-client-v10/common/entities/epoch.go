package entities

import (
	"fmt"
	"math"
)

type Epoch uint64

const (
	SIGNER_RETRIEVAL_OFFSET              int64  = -1
	NEXT_SIGNER_RETRIEVAL_OFFSET         uint64 = 0
	SIGNER_RECORDING_OFFSET              uint64 = 1
	PROTOCOL_PARAMETERS_RECORDING_OFFSET uint64 = 2
	SIGNER_SIGNING_OFFSET                uint64 = 2
)

func (e Epoch) OffsetBy(epochOffset int64) (Epoch, error) {
	epochNew := int64(e) + epochOffset
	if epochNew < 0 {
		return 0, fmt.Errorf("epoch offset error: current epoch %d, offset %d", e, epochOffset)
	}
	return Epoch(epochNew), nil
}

func (e Epoch) OffsetToSignerRetrievalEpoch() (Epoch, error) {
	return e.OffsetBy(SIGNER_RETRIEVAL_OFFSET)
}

func (e Epoch) OffsetToNextSignerRetrievalEpoch() Epoch {
	return e + Epoch(NEXT_SIGNER_RETRIEVAL_OFFSET)
}

func (e Epoch) OffsetToRecordingEpoch() Epoch {
	return e + Epoch(SIGNER_RECORDING_OFFSET)
}

func (e Epoch) OffsetToProtocolParametersRecordingEpoch() Epoch {
	return e + Epoch(PROTOCOL_PARAMETERS_RECORDING_OFFSET)
}

func (e Epoch) OffsetToSignerSigningOffset() Epoch {
	return e + Epoch(SIGNER_SIGNING_OFFSET)
}

func (e Epoch) Next() Epoch {
	return e + 1
}

func (e Epoch) Previous() (Epoch, error) {
	return e.OffsetBy(-1)
}

func (e Epoch) HasGapWith(other Epoch) bool {
	return math.Abs(float64(e-other)) > 1
}
