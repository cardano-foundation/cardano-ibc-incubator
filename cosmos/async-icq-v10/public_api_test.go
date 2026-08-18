package asyncicq_test

import (
	"testing"

	asyncicq "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/async-icq-v10"
	"github.com/cosmos/cosmos-sdk/baseapp"
	porttypes "github.com/cosmos/ibc-go/v10/modules/core/05-port/types"
)

type publicQueryRouter struct{}

func (publicQueryRouter) Route(string) baseapp.GRPCQueryHandler {
	return nil
}

func TestPublicModuleConstruction(t *testing.T) {
	host := asyncicq.NewIBCModule(publicQueryRouter{}, nil)
	var _ porttypes.IBCModule = host

	if asyncicq.PortID != "icqhost" || asyncicq.Version != "icq-1" {
		t.Fatal("unexpected public async-ICQ protocol identifiers")
	}
}
