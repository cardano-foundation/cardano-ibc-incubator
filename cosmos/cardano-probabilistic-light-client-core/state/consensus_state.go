package state

import (
	"time"
)

func (ConsensusState) ClientType() string {
	return ModuleName
}

func (cs ConsensusState) GetTimestamp() uint64 {
	return cs.Timestamp
}

func (cs ConsensusState) GetTime() time.Time {
	return time.Unix(int64(cs.GetTimestamp()/uint64(time.Second)), int64(cs.GetTimestamp()%uint64(time.Second)))
}

func (cs ConsensusState) ValidateBasic() error { return validateConsensusState(&cs) }
