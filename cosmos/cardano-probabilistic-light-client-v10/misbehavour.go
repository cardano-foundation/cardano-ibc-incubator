package probabilistic

import (
	"time"

	host "github.com/cosmos/ibc-go/v10/modules/core/24-host"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.ClientMessage = (*Misbehaviour)(nil)

var FrozenHeight = NewHeight(0, 1)

func NewMisbehaviour(clientID string, first, second []byte) *Misbehaviour {
	return &Misbehaviour{ClientId: clientID, VerifiedObservation_1: append([]byte(nil), first...), VerifiedObservation_2: append([]byte(nil), second...)}
}

func (Misbehaviour) ClientType() string {
	return ModuleName
}

func (misbehaviour Misbehaviour) GetTime() time.Time {
	return toCoreMisbehaviour(&misbehaviour).GetTime()
}

func (misbehaviour Misbehaviour) ValidateBasic() error {
	return adapterError(toCoreMisbehaviour(&misbehaviour).ValidateBasic(host.ClientIdentifierValidator))
}
