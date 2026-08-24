package probabilistic

import (
	"fmt"
	"math"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

type authenticatedTemporalBlock struct {
	label string
	block *authenticatedProbabilisticBlock
}

func (cs ClientState) maximumAllowedCardanoTimestamp(ctx sdk.Context) (uint64, error) {
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

func (cs ClientState) verifyHeaderTemporalContinuity(
	ctx sdk.Context,
	header *authenticatedProbabilisticHeader,
	trustedBlock *trustedBlockState,
) error {
	if trustedBlock == nil || trustedBlock.height == nil {
		return errorsmod.Wrap(ErrInvalidTimestamp, "trusted Cardano temporal cursor is missing")
	}
	if trustedBlock.timestamp == 0 {
		return errorsmod.Wrap(ErrInvalidTimestamp, "trusted Cardano timestamp is missing")
	}
	if header == nil || header.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidTimestamp, "authenticated anchor block is missing")
	}

	maxTimestamp, err := cs.maximumAllowedCardanoTimestamp(ctx)
	if err != nil {
		return err
	}

	blocks := make([]authenticatedTemporalBlock, 0, len(header.bridgeBlocks)+len(header.descendantBlocks)+1)
	for index, block := range header.bridgeBlocks {
		blocks = append(blocks, authenticatedTemporalBlock{
			label: fmt.Sprintf("bridge block at index %d", index),
			block: block,
		})
	}
	blocks = append(blocks, authenticatedTemporalBlock{label: "anchor block", block: header.anchorBlock})
	for index, block := range header.descendantBlocks {
		blocks = append(blocks, authenticatedTemporalBlock{
			label: fmt.Sprintf("descendant block at index %d", index),
			block: block,
		})
	}

	previousSlot := trustedBlock.slot
	previousTimestamp := trustedBlock.timestamp
	for _, candidate := range blocks {
		if candidate.block == nil {
			return errorsmod.Wrapf(ErrInvalidTimestamp, "%s is missing", candidate.label)
		}
		expectedTimestamp, err := cs.DeriveTimestampFromSlot(candidate.block.slot)
		if err != nil {
			return errorsmod.Wrapf(err, "%s has an invalid slot", candidate.label)
		}
		if candidate.block.timestamp != expectedTimestamp {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s timestamp %d does not match slot %d timestamp %d",
				candidate.label,
				candidate.block.timestamp,
				candidate.block.slot,
				expectedTimestamp,
			)
		}
		if candidate.block.slot <= previousSlot {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s slot %d must be greater than previous authenticated slot %d",
				candidate.label,
				candidate.block.slot,
				previousSlot,
			)
		}
		if candidate.block.timestamp <= previousTimestamp {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s timestamp %d must be later than previous authenticated timestamp %d",
				candidate.label,
				candidate.block.timestamp,
				previousTimestamp,
			)
		}
		if candidate.block.timestamp > maxTimestamp {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s timestamp %d exceeds Cosmos host time plus max clock drift %d",
				candidate.label,
				candidate.block.timestamp,
				maxTimestamp,
			)
		}
		previousSlot = candidate.block.slot
		previousTimestamp = candidate.block.timestamp
	}

	return nil
}
