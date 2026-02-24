package keeper

import (
	"entrypoint/x/vesseloracle/types"
)

var _ types.QueryServer = Keeper{}
