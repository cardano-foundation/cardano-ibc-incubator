package keeper

import (
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/vesseloracle-v10/x/vesseloracle/types"
)

type msgServer struct {
	Keeper
}

// NewMsgServerImpl returns an implementation of the MsgServer interface
// for the provided Keeper.
func NewMsgServerImpl(keeper Keeper) types.MsgServer {
	return &msgServer{Keeper: keeper}
}

var _ types.MsgServer = msgServer{}
