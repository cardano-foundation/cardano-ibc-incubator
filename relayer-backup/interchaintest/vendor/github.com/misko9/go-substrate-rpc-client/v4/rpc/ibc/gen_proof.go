package ibc

import (
	"context"

	"github.com/misko9/go-substrate-rpc-client/v4/types"
)

func (i IBC) GenerateConnectionHandshakeProof(
	ctx context.Context,
	height uint32,
	clientID string,
	connID string,
) (
	types.ConnHandshakeProof,
	error,
) {
	var res types.ConnHandshakeProof
	err := i.client.CallContext(ctx, &res, generateConnectionHandshakeProofMethod)
	if err != nil {
		return types.ConnHandshakeProof{}, err
	}
	return res, nil
}
