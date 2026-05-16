package stability

import (
	"time"

	errorsmod "cosmossdk.io/errors"

	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.ClientMessage = (*StabilityHeader)(nil)

func (h StabilityHeader) ConsensusState() *ConsensusState {
	// This is only an interface placeholder. The verified consensus state for
	// stability updates is derived inside the authenticated update path, not from
	// these untrusted relayed header fields.
	return &ConsensusState{
		Timestamp:         h.GetTimestamp(),
		IbcStateRoot:      make([]byte, 32),
		AcceptedBlockHash: h.AnchorBlock.Hash,
		AcceptedEpoch:     h.AnchorBlock.Epoch,
		UniquePoolsCount:  0,
		UniqueStakeBps:    0,
		SecurityScoreBps:  0,
	}
}

func (StabilityHeader) ClientType() string {
	return ModuleName
}

func (h StabilityHeader) GetHeight() exported.Height {
	return NewHeight(0, h.AnchorBlock.Height.RevisionHeight)
}

func (h StabilityHeader) GetTimestamp() uint64 {
	return h.AnchorBlock.Timestamp
}

func (h StabilityHeader) GetTime() time.Time {
	return time.Unix(int64(h.GetTimestamp()/uint64(time.Second)), int64(h.GetTimestamp()%uint64(time.Second)))
}

func (h StabilityHeader) ValidateBasic() error {
	if h.TrustedHeight == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "trusted height must be present")
	}
	if h.TrustedHeight.RevisionHeight == 0 {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "trusted height cannot be zero")
	}
	if h.AnchorBlock == nil || h.AnchorBlock.Height == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "anchor block must be present")
	}
	if h.AnchorBlock.Height.RevisionHeight == 0 {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "anchor block height cannot be zero")
	}
	if h.AnchorBlock.Hash == "" {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "anchor block hash cannot be empty")
	}
	if len(h.AnchorBlock.BlockCbor) == 0 {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "anchor block_cbor cannot be empty")
	}
	if h.TrustedHeight.RevisionHeight >= h.AnchorBlock.Height.RevisionHeight {
		return errorsmod.Wrapf(
			ErrInvalidHeaderHeight,
			"trusted height %d must be less than anchor height %d",
			h.TrustedHeight.RevisionHeight,
			h.AnchorBlock.Height.RevisionHeight,
		)
	}
	if h.NewEpochContext != nil {
		if err := validateEpochContext(h.NewEpochContext); err != nil {
			return err
		}
	}
	for _, block := range h.BridgeBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "bridge block cannot be nil")
		}
		if len(block.BlockCbor) == 0 {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "bridge block_cbor cannot be empty")
		}
	}
	for _, block := range h.DescendantBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "descendant block cannot be nil")
		}
		if len(block.BlockCbor) == 0 {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "descendant block_cbor cannot be empty")
		}
	}
	return nil
}
