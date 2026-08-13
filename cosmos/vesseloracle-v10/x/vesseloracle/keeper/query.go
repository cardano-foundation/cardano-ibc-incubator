package keeper

import (
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/vesseloracle-v10/x/vesseloracle/types"
)

var _ types.QueryServer = Keeper{}
