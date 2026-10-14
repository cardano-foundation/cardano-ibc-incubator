package probabilistic

import (
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/msgservice"

	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

func RegisterInterfaces(registry codectypes.InterfaceRegistry) {
	registry.RegisterImplementations((*sdk.Msg)(nil), &MsgContinueClient{})
	msgservice.RegisterMsgServiceDesc(registry, &_Msg_serviceDesc)
	registry.RegisterImplementations((*exported.ClientState)(nil), &ClientState{})
	registry.RegisterImplementations((*exported.ConsensusState)(nil), &ConsensusState{})
	registry.RegisterImplementations((*exported.Height)(nil), &Height{})
	registry.RegisterImplementations((*exported.ClientMessage)(nil), &Misbehaviour{})
	registry.RegisterImplementations((*exported.ClientMessage)(nil), &ProbabilisticHeader{})
}
