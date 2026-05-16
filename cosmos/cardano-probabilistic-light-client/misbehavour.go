package probabilistic

import (
	"time"

	errorsmod "cosmossdk.io/errors"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v10/modules/core/24-host"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.ClientMessage = (*Misbehaviour)(nil)

var FrozenHeight = NewHeight(0, 1)

func NewMisbehaviour(clientID string, header1, header2 *ProbabilisticHeader) *Misbehaviour {
	return &Misbehaviour{
		ClientId:             clientID,
		ProbabilisticHeader1: header1,
		ProbabilisticHeader2: header2,
	}
}

func (Misbehaviour) ClientType() string {
	return ModuleName
}

func (misbehaviour Misbehaviour) GetTime() time.Time {
	t1, t2 := misbehaviour.ProbabilisticHeader1.GetTime(), misbehaviour.ProbabilisticHeader2.GetTime()
	if t1.After(t2) {
		return t1
	}
	return t2
}

func (misbehaviour Misbehaviour) ValidateBasic() error {
	if misbehaviour.ProbabilisticHeader1 == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "misbehaviour ProbabilisticHeader1 cannot be nil")
	}
	if misbehaviour.ProbabilisticHeader2 == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "misbehaviour ProbabilisticHeader2 cannot be nil")
	}
	if err := host.ClientIdentifierValidator(misbehaviour.ClientId); err != nil {
		return errorsmod.Wrap(err, "misbehaviour client ID is invalid")
	}
	if err := misbehaviour.ProbabilisticHeader1.ValidateBasic(); err != nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidMisbehaviour, errorsmod.Wrap(err, "probabilistic header 1 failed validation").Error())
	}
	if err := misbehaviour.ProbabilisticHeader2.ValidateBasic(); err != nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidMisbehaviour, errorsmod.Wrap(err, "probabilistic header 2 failed validation").Error())
	}
	if misbehaviour.ProbabilisticHeader1.GetHeight().LT(misbehaviour.ProbabilisticHeader2.GetHeight()) {
		return errorsmod.Wrapf(clienttypes.ErrInvalidMisbehaviour, "probabilistic header 1 height is less than probabilistic header 2 height (%s < %s)", misbehaviour.ProbabilisticHeader1.GetHeight(), misbehaviour.ProbabilisticHeader2.GetHeight())
	}
	return nil
}
