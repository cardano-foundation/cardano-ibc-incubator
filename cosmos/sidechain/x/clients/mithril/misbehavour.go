package mithril

import (
	"time"

	errorsmod "cosmossdk.io/errors"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientMessage = (*Misbehaviour)(nil)

// FrozenHeight is same for all misbehaviour
var FrozenHeight = NewHeight(0, 1)

// NewMisbehaviour creates a new Misbehaviour instance.
func NewMisbehaviour(clientID string, header1, header2 *MithrilHeader) *Misbehaviour {
	return &Misbehaviour{
		ClientId:       clientID,
		MithrilHeader1: header1,
		MithrilHeader2: header2,
	}
}

// ClientType is Mithril light client
func (Misbehaviour) ClientType() string {
	return ModuleName
}

// GetTime returns the timestamp at which misbehaviour occurred. It uses the
// maximum value from both headers to prevent producing an invalid header outside
// of the misbehaviour age range.
func (misbehaviour Misbehaviour) GetTime() time.Time {
	t1, t2 := misbehaviour.MithrilHeader1.GetTime(), misbehaviour.MithrilHeader2.GetTime()
	if t1.After(t2) {
		return t1
	}
	return t2
}

// ValidateBasic implements Misbehaviour interface
func (misbehaviour Misbehaviour) ValidateBasic() error {
	if misbehaviour.MithrilHeader1 == nil {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "misbehaviour MithrilHeader1 cannot be nil")
	}
	if misbehaviour.MithrilHeader2 == nil {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "misbehaviour MithrilHeader2 cannot be nil")
	}
	if misbehaviour.MithrilHeader1.TransactionSnapshot.BlockNumber == 0 {
		return errorsmod.Wrapf(ErrInvalidMithrilHeaderHeight, "misbehaviour MithrilHeader1 cannot have zero mithril height")
	}
	if misbehaviour.MithrilHeader2.TransactionSnapshot.BlockNumber == 0 {
		return errorsmod.Wrapf(ErrInvalidMithrilHeaderHeight, "misbehaviour MithrilHeader2 cannot have zero mithril height")
	}
	if err := host.ClientIdentifierValidator(misbehaviour.ClientId); err != nil {
		return errorsmod.Wrap(err, "misbehaviour client ID is invalid")
	}

	// ValidateBasic on both MithrilHeader
	if err := misbehaviour.MithrilHeader1.ValidateBasic(); err != nil {
		return errorsmod.Wrap(
			clienttypes.ErrInvalidMisbehaviour,
			errorsmod.Wrap(err, "mithril header 1 failed validation").Error(),
		)
	}
	if err := misbehaviour.MithrilHeader2.ValidateBasic(); err != nil {
		return errorsmod.Wrap(
			clienttypes.ErrInvalidMisbehaviour,
			errorsmod.Wrap(err, "mithril header 2 failed validation").Error(),
		)
	}
	// Ensure that Height1 is greater than or equal to Height2
	if misbehaviour.MithrilHeader1.GetHeight().LT(misbehaviour.MithrilHeader2.GetHeight()) {
		return errorsmod.Wrapf(clienttypes.ErrInvalidMisbehaviour, "MithrilHeader1 height is less than MithrilHeader2 height (%s < %s)", misbehaviour.MithrilHeader1.GetHeight(), misbehaviour.MithrilHeader2.GetHeight())
	}

	return nil
}
