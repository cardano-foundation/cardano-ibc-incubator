package module

import (
	"github.com/cosmos/ibc-go/v7/modules/core/exported"
)

var _ exported.ClientState = (*ClientState)(nil)
var _ exported.ConsensusState = (*ConsensusState)(nil)

func (ClientState) ClientType() string {
	return "099-cardano"
}

// GetLatestHeight returns latest block height.
func (cs ClientState) GetLatestHeight() exported.Height {
	return cs.LatestHeight
}
