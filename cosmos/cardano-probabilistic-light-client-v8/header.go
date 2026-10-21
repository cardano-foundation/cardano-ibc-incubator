package probabilistic

import (
	"fmt"
	"time"

	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"

	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientMessage = (*ProbabilisticHeader)(nil)

func (ProbabilisticHeader) ClientType() string {
	return ModuleName
}

func (h ProbabilisticHeader) GetHeight() exported.Height {
	height := toCoreProbabilisticHeader(&h).GetHeight()
	return clienttypes.NewHeight(height.RevisionNumber, height.RevisionHeight)
}

func (h ProbabilisticHeader) GetTimestamp() uint64 {
	return toCoreProbabilisticHeader(&h).GetTimestamp()
}

func (h ProbabilisticHeader) GetTime() time.Time {
	return time.Unix(int64(h.GetTimestamp()/uint64(time.Second)), int64(h.GetTimestamp()%uint64(time.Second)))
}



func (h ProbabilisticHeader) ValidateBasic() error {
	if h.Size() > state.MaxOperationSignedBytes-state.BoundedMessageEnvelopeBytes {
		return fmt.Errorf("bounded client message exceeds the transport budget")
	}
	return adapterError(toCoreProbabilisticHeader(&h).ValidateBasic())
}
