package stability

import (
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"

	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func RegisterInterfaces(registry codectypes.InterfaceRegistry) {
	registry.RegisterImplementations((*exported.ClientState)(nil), &ClientState{})
	registry.RegisterImplementations((*exported.ConsensusState)(nil), &ConsensusState{})
	registry.RegisterImplementations((*exported.Height)(nil), &Height{})
	registry.RegisterImplementations((*exported.ClientMessage)(nil), &Misbehaviour{})
	registry.RegisterImplementations((*exported.ClientMessage)(nil), &StabilityHeader{})
}
