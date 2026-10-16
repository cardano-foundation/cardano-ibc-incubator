package state

import (
	"bytes"
	"time"
)

var FrozenHeight = NewHeight(0, 1)

func (Misbehaviour) ClientType() string {
	return ModuleName
}

func (Misbehaviour) GetTime() time.Time { return time.Time{} }

func (m Misbehaviour) ValidateBasic(validateClientID func(string) error) error {
	if len(m.VerifiedObservation_1) != 32 || len(m.VerifiedObservation_2) != 32 || m.ProbabilisticHeader1 != nil || m.ProbabilisticHeader2 != nil {
		return ErrIBCInvalidMisbehaviour
	}
	return validateClientID(m.ClientId)
}

func NewMisbehaviour(clientID string, first, second []byte) *Misbehaviour {
	return &Misbehaviour{ClientId: clientID, VerifiedObservation_1: bytes.Clone(first), VerifiedObservation_2: bytes.Clone(second)}
}
