package keeper

import (
	"cardano-entrypoint/x/vesseloracle/types"
)

var _ types.QueryServer = Keeper{}
