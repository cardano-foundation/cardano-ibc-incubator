package cardano

import (
	"strings"
	"time"

	errorsmod "cosmossdk.io/errors"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientMessage = (*BlockData)(nil)

// ConsensusState returns the updated consensus state associated with the header
func (b BlockData) ConsensusState() *ConsensusState {
	return &ConsensusState{
		Timestamp: b.Timestamp,
		Slot:      b.Slot,
	}
}

// ClientType defines that the BlockData is a Cardano consensus algorithm
func (BlockData) ClientType() string {
	return ModuleName
}

// GetHeight returns the current height. It returns 0 if the Cardano
// header is nil.
// NOTE: the header.BlockData is checked to be non nil in ValidateBasic.
func (b BlockData) GetHeight() exported.Height {
	return *b.Height
}

// GetTime returns the current block timestamp. It returns a zero time if
// the Cardano header is nil.
// NOTE: the header.BlockData is checked to be non nil in ValidateBasic.
func (b BlockData) GetTime() time.Time {
	return time.Unix(int64(b.Timestamp), 0)
}

// ValidateBasic calls the SignedBlockData ValidateBasic function and checks
// that validatorsets are not nil.
// NOTE: TrustedHeight and TrustedValidators may be empty when creating client
// with MsgCreateClient
func (b BlockData) ValidateBasic() error {

	if b.Height.RevisionHeight == 0 {
		return errorsmod.Wrapf(ErrInvalidBlockDataHeight, "misbehaviour BlockData cannot have zero revision height")
	}
	if b.Slot == 0 {
		return errorsmod.Wrapf(ErrInvalidBlockDataSlot, "misbehaviour BlockData cannot have zero revision height")
	}
	if strings.EqualFold(b.HeaderCbor, "") {
		return errorsmod.Wrap(ErrInvalidHeaderCbor, "header cbor in BlockData cannot be empty")
	}
	if strings.EqualFold(b.Hash, "") {
		return errorsmod.Wrap(ErrInvalidBlockDataHash, "hash in BlockData cannot be empty")
	}
	if strings.EqualFold(b.PrevHash, "") {
		return errorsmod.Wrap(ErrInvalidBlockDataHash, "previous hash in BlockData cannot be empty")
	}
	if strings.EqualFold(b.EpochNonce, "") {
		return errorsmod.Wrap(ErrInvalidBlockDataHash, "epoch nonce in BlockData cannot be empty")
	}
	if b.Timestamp <= 0 {
		return errorsmod.Wrap(ErrInvalidBlockDataEpochNonce, "timestamp in BlockData is invalid")
	}
	if strings.EqualFold(b.ChainId, "") {
		return errorsmod.Wrap(ErrInvalidChainId, "ChainID in BlockData is invalid")
	}
	return nil
}
