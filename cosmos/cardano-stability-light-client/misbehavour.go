package stability

import (
	"time"

	errorsmod "cosmossdk.io/errors"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v10/modules/core/24-host"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.ClientMessage = (*Misbehaviour)(nil)

var FrozenHeight = NewHeight(0, 1)

func NewMisbehaviour(clientID string, header1, header2 *StabilityHeader) *Misbehaviour {
	return &Misbehaviour{
		ClientId:         clientID,
		StabilityHeader1: header1,
		StabilityHeader2: header2,
	}
}

func (Misbehaviour) ClientType() string {
	return ModuleName
}

func (misbehaviour Misbehaviour) GetTime() time.Time {
	t1, t2 := misbehaviour.StabilityHeader1.GetTime(), misbehaviour.StabilityHeader2.GetTime()
	if t1.After(t2) {
		return t1
	}
	return t2
}

func (misbehaviour Misbehaviour) ValidateBasic() error {
	if misbehaviour.StabilityHeader1 == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "misbehaviour StabilityHeader1 cannot be nil")
	}
	if misbehaviour.StabilityHeader2 == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "misbehaviour StabilityHeader2 cannot be nil")
	}
	if err := host.ClientIdentifierValidator(misbehaviour.ClientId); err != nil {
		return errorsmod.Wrap(err, "misbehaviour client ID is invalid")
	}
	if err := misbehaviour.StabilityHeader1.ValidateBasic(); err != nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidMisbehaviour, errorsmod.Wrap(err, "stability header 1 failed validation").Error())
	}
	if err := misbehaviour.StabilityHeader2.ValidateBasic(); err != nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidMisbehaviour, errorsmod.Wrap(err, "stability header 2 failed validation").Error())
	}
	if misbehaviour.StabilityHeader1.GetHeight().LT(misbehaviour.StabilityHeader2.GetHeight()) {
		return errorsmod.Wrapf(clienttypes.ErrInvalidMisbehaviour, "stability header 1 height is less than stability header 2 height (%s < %s)", misbehaviour.StabilityHeader1.GetHeight(), misbehaviour.StabilityHeader2.GetHeight())
	}
	return nil
}
