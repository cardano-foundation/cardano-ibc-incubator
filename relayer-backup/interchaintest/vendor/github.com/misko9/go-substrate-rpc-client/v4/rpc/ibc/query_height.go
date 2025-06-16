package ibc

import "context"

func (i IBC) QueryLatestHeight(ctx context.Context) (
	uint64,
	error,
) {
	var res uint64
	err := i.client.CallContext(ctx, &res, queryLatestHeightMethod)
	if err != nil {
		return 0, err
	}
	return res, nil
}
