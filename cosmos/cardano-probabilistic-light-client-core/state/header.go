package state

import (
	"time"

	errorsmod "cosmossdk.io/errors"
)

func (ProbabilisticHeader) ClientType() string {
	return ModuleName
}

func (h ProbabilisticHeader) GetHeight() *Height {
	if h.ObservationChunk != nil {
		return NewHeight(0, h.ObservationChunk.AnchorHeight)
	}
	if h.AnchorBlock == nil || h.AnchorBlock.Height == nil {
		return ZeroHeight()
	}
	return NewHeight(0, h.AnchorBlock.Height.RevisionHeight)
}

func (h ProbabilisticHeader) GetTimestamp() uint64 {
	if h.AnchorBlock == nil {
		return 0
	}
	return h.AnchorBlock.Timestamp
}

func (h ProbabilisticHeader) GetTime() time.Time {
	return time.Unix(int64(h.GetTimestamp()/uint64(time.Second)), int64(h.GetTimestamp()%uint64(time.Second)))
}

func (h ProbabilisticHeader) ValidateBasic() error {
	if h.ObservationChunk == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "client updates require bounded observation operations")
	}
	return h.validateObservationChunk()
}

func validateProbabilisticBlockWitness(block *ProbabilisticBlock, label string, requireFullBlock bool) error {
	if len(block.BlockCbor) > MaxBlockCBORBytes || len(block.HeaderCbor) > MaxHeaderCBORBytes {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s witness exceeds the challenge capacity bound", label)
	}
	hasFullBlock := len(block.BlockCbor) > 0
	hasHeader := len(block.HeaderCbor) > 0
	if hasFullBlock && hasHeader {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block cannot contain both block_cbor and header_cbor",
			label,
		)
	}
	if requireFullBlock && !hasFullBlock {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block requires full block_cbor", label)
	}
	if !hasFullBlock && !hasHeader {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block must contain block_cbor or header_cbor", label)
	}
	return nil
}
