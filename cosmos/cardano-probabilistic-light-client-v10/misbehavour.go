package probabilistic

import (
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
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
	return toCoreMisbehaviour(&misbehaviour).GetTime()
}

func (misbehaviour Misbehaviour) ValidateBasic() error {
	if err := toCoreMisbehaviour(&misbehaviour).ValidateBasic(host.ClientIdentifierValidator); err != nil {
		return adapterError(err)
	}
	if len(misbehaviour.VerifiedObservation_1) > 0 {
		return nil
	}
	if err := state.ValidateHeaderBytes(misbehaviour.ProbabilisticHeader1.Size()); err != nil {
		return adapterError(err)
	}
	return adapterError(state.ValidateHeaderBytes(misbehaviour.ProbabilisticHeader2.Size()))
}
