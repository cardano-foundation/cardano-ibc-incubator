package ibc

import (
	"context"

	sdk "github.com/cosmos/cosmos-sdk/types"
)

func (i IBC) QueryBalanceWithAddress(
	ctx context.Context,
	addr string,
	denom uint64,
) (
	sdk.Coin,
	error,
) {
	var res sdk.Coin
	err := i.client.CallContext(ctx, &res, queryBalanceWithAddressMethod, addr, denom)
	if err != nil {
		return sdk.Coin{}, err
	}
	return res, nil
}
