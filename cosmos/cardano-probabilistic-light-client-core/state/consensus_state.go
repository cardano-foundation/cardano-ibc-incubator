package state

import (
	"time"
)

// Accepted observations historically serialized this value after every
// settlement threshold passed. Keep it for compatibility, not as a score.
const legacyAcceptedSecurityScoreBps uint64 = 10_000

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
