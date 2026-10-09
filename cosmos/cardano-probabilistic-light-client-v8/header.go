package probabilistic

import (
	"time"

	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientMessage = (*ProbabilisticHeader)(nil)

func (ProbabilisticHeader) ClientType() string {
	return ModuleName
}

func (h ProbabilisticHeader) GetHeight() exported.Height {
	return NewHeight(0, h.AnchorBlock.Height.RevisionHeight)
}

func (h ProbabilisticHeader) GetTimestamp() uint64 {
	return h.AnchorBlock.Timestamp
}

func (h ProbabilisticHeader) GetTime() time.Time {
	return time.Unix(int64(h.GetTimestamp()/uint64(time.Second)), int64(h.GetTimestamp()%uint64(time.Second)))
}

func (h ProbabilisticHeader) ConsensusState() *ConsensusState {
	return fromCoreConsensusState(toCoreProbabilisticHeader(&h).ConsensusState())
}

func (h ProbabilisticHeader) ValidateBasic() error {
	return adapterError(toCoreProbabilisticHeader(&h).ValidateBasic())
}
