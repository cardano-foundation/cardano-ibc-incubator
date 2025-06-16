package ibc

import (
	"context"

	"github.com/misko9/go-substrate-rpc-client/v4/types"
)

func (i IBC) QueryProof(
	ctx context.Context,
	height uint32,
	keys [][]byte) (
	types.Proof,
	error,
) {
	var res types.Proof
	err := i.client.CallContext(ctx, &res, queryProofMethod, height, keys)
	if err != nil {
		return types.Proof{}, err
	}
	return res, nil
}
