package probabilistic

import (
	"time"

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
	return adapterError(toCoreMisbehaviour(&misbehaviour).ValidateBasic(host.ClientIdentifierValidator))
}
