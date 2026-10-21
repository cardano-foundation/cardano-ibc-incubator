package state

import (
	"math"

	errorsmod "cosmossdk.io/errors"
)

func (cs ClientState) maximumAllowedCardanoTimestamp(ctx Context) (uint64, error) {
	if cs.MaxClockDrift <= 0 {
		return 0, errorsmod.Wrap(ErrInvalidMaxClockDrift, "max clock drift must be greater than zero")
	}
	hostTimestamp := ctx.BlockTime().UnixNano()
	if hostTimestamp <= 0 {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "Cosmos host block time must be after the Unix epoch")
	}
	hostTimestampNs := uint64(hostTimestamp)
	driftNs := uint64(cs.MaxClockDrift)
	if hostTimestampNs > math.MaxUint64-driftNs {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "Cosmos host block time plus max clock drift overflows uint64")
	}
	return hostTimestampNs + driftNs, nil
}
