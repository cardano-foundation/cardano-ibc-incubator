package ibc

import (
	"context"
)

func (i IBC) QueryTimestamp(
	ctx context.Context,
	heigt uint32,
) (
	uint64,
	error,
) {
	var res uint64
	err := i.client.CallContext(ctx, &res, queryTimestampMethod)
	if err != nil {
		return 0, err
	}

	return res, nil
}
