package cardano

import (
	"time"

	errorsmod "cosmossdk.io/errors"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientMessage = (*Misbehaviour)(nil)

// FrozenHeight is same for all misbehaviour
var FrozenHeight = NewHeight(0, 1)

// NewMisbehaviour creates a new Misbehaviour instance.
func NewMisbehaviour(clientID string, blockData1, blockData2 *BlockData) *Misbehaviour {
	return &Misbehaviour{
		ClientId:   clientID,
		BlockData1: blockData1,
		BlockData2: blockData2,
	}
}

// ClientType is Cardano light client
func (Misbehaviour) ClientType() string {
	return ModuleName
}

// GetTime returns the timestamp at which misbehaviour occurred. It uses the
// maximum value from both headers to prevent producing an invalid header outside
// of the misbehaviour age range.
func (misbehaviour Misbehaviour) GetTime() time.Time {
	t1, t2 := misbehaviour.BlockData1.GetTime(), misbehaviour.BlockData2.GetTime()
	if t1.After(t2) {
		return t1
	}
	return t2
}

// ValidateBasic implements Misbehaviour interface
func (misbehaviour Misbehaviour) ValidateBasic() error {
	if misbehaviour.BlockData1 == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "misbehaviour BlockData1 cannot be nil")
	}
	if misbehaviour.BlockData2 == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "misbehaviour Header2 cannot be nil")
	}
	if misbehaviour.BlockData1.ChainId != misbehaviour.BlockData2.ChainId {
		return errorsmod.Wrap(clienttypes.ErrInvalidMisbehaviour, "BlockDatas must have identical chainIDs")
	}

	// ValidateBasic on both validators
	if err := misbehaviour.BlockData1.ValidateBasic(); err != nil {
		return errorsmod.Wrap(
			clienttypes.ErrInvalidMisbehaviour,
			errorsmod.Wrap(err, "header 1 failed validation").Error(),
		)
	}
	if err := misbehaviour.BlockData2.ValidateBasic(); err != nil {
		return errorsmod.Wrap(
			clienttypes.ErrInvalidMisbehaviour,
			errorsmod.Wrap(err, "header 2 failed validation").Error(),
		)
	}
	// Ensure that Height1 is greater than or equal to Height2
	if misbehaviour.BlockData1.GetHeight().LT(misbehaviour.BlockData2.GetHeight()) {
		return errorsmod.Wrapf(clienttypes.ErrInvalidMisbehaviour, "Header1 height is less than Header2 height (%s < %s)", misbehaviour.BlockData1.GetHeight(), misbehaviour.BlockData2.GetHeight())
	}
	//TODO: any more?
	return nil
}
