package probabilistic

import (
	"bytes"
	"slices"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

func cloneEpochContext(ctx *EpochContext) *EpochContext {
	if ctx == nil {
		return nil
	}

	cloned := &EpochContext{
		Epoch:                 ctx.Epoch,
		EpochNonce:            bytes.Clone(ctx.EpochNonce),
		SlotsPerKesPeriod:     ctx.SlotsPerKesPeriod,
		EpochStartSlot:        ctx.EpochStartSlot,
		EpochEndSlotExclusive: ctx.EpochEndSlotExclusive,
	}
	if len(ctx.StakeDistribution) > 0 {
		cloned.StakeDistribution = make([]*StakeDistributionEntry, 0, len(ctx.StakeDistribution))
		for _, entry := range ctx.StakeDistribution {
			if entry == nil {
				continue
			}
			cloned.StakeDistribution = append(cloned.StakeDistribution, &StakeDistributionEntry{
				PoolId:                entry.PoolId,
				Stake:                 entry.Stake,
				VrfKeyHash:            bytes.Clone(entry.VrfKeyHash),
				FirstRegistrationSlot: entry.FirstRegistrationSlot,
			})
		}
	}
	return cloned
}

func cloneEpochContexts(contexts []*EpochContext) []*EpochContext {
	cloned := make([]*EpochContext, 0, len(contexts))
	for _, ctx := range contexts {
		if ctx == nil {
			continue
		}
		cloned = append(cloned, cloneEpochContext(ctx))
	}
	return cloned
}

func cloneStakeDistributionEntries(entries []*StakeDistributionEntry) []*StakeDistributionEntry {
	cloned := make([]*StakeDistributionEntry, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		cloned = append(cloned, &StakeDistributionEntry{
			PoolId:                entry.PoolId,
			Stake:                 entry.Stake,
			VrfKeyHash:            bytes.Clone(entry.VrfKeyHash),
			FirstRegistrationSlot: entry.FirstRegistrationSlot,
		})
	}
	return cloned
}

func validateEpochContext(ctx *EpochContext) error {
	if ctx == nil {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch context must not be nil")
	}
	if len(ctx.StakeDistribution) == 0 {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution must not be empty", ctx.Epoch)
	}
	if len(ctx.EpochNonce) != 32 {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d nonce must be 32 bytes", ctx.Epoch)
	}
	if ctx.SlotsPerKesPeriod == 0 {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d slots per KES period must be greater than zero", ctx.Epoch)
	}
	if ctx.EpochEndSlotExclusive <= ctx.EpochStartSlot {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d slot bounds must be increasing", ctx.Epoch)
	}

	totalStake := uint64(0)
	seenPools := make(map[string]struct{}, len(ctx.StakeDistribution))
	for _, entry := range ctx.StakeDistribution {
		if entry == nil {
			return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution entry must not be nil", ctx.Epoch)
		}
		if strings.TrimSpace(entry.PoolId) == "" {
			return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution pool id must not be empty", ctx.Epoch)
		}
		if len(entry.VrfKeyHash) != 32 {
			return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d vrf_key_hash for pool %s must be 32 bytes", ctx.Epoch, entry.PoolId)
		}
		poolKey := strings.ToLower(entry.PoolId)
		if _, exists := seenPools[poolKey]; exists {
			return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "duplicate epoch %d stake distribution pool id %s", ctx.Epoch, entry.PoolId)
		}
		seenPools[poolKey] = struct{}{}
		totalStake += entry.Stake
	}
	if totalStake == 0 {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution must have positive total stake", ctx.Epoch)
	}

	return nil
}

func normalizeEpochContexts(contexts []*EpochContext) ([]*EpochContext, error) {
	contextByEpoch := make(map[uint64]*EpochContext, len(contexts))
	for _, ctx := range contexts {
		if ctx == nil {
			continue
		}
		if err := validateEpochContext(ctx); err != nil {
			return nil, err
		}
		if existing := contextByEpoch[ctx.Epoch]; existing != nil && !epochContextsEqual(existing, ctx) {
			return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "conflicting epoch context for epoch %d", ctx.Epoch)
		}
		contextByEpoch[ctx.Epoch] = cloneEpochContext(ctx)
	}

	epochs := make([]uint64, 0, len(contextByEpoch))
	for epoch := range contextByEpoch {
		epochs = append(epochs, epoch)
	}
	slices.Sort(epochs)

	normalized := make([]*EpochContext, 0, len(epochs))
	for _, epoch := range epochs {
		normalized = append(normalized, contextByEpoch[epoch])
	}
	return normalized, nil
}

func (cs ClientState) normalizedEpochContexts() ([]*EpochContext, error) {
	return normalizeEpochContexts(cs.EpochContexts)
}

func mergeEpochContexts(base []*EpochContext, candidate *EpochContext) ([]*EpochContext, error) {
	contexts, err := normalizeEpochContexts(base)
	if err != nil {
		return nil, err
	}
	if candidate == nil {
		return contexts, nil
	}
	if err := validateEpochContext(candidate); err != nil {
		return nil, err
	}

	// Verification must be able to authenticate a same-epoch header using the
	// context it carries. CheckForMisbehaviour later freezes if that context
	// disagrees with the one already stored for the epoch.
	for i, ctx := range contexts {
		if ctx != nil && ctx.Epoch == candidate.Epoch {
			contexts[i] = cloneEpochContext(candidate)
			return contexts, nil
		}
	}

	contexts = append(contexts, cloneEpochContext(candidate))
	return normalizeEpochContexts(contexts)
}

func epochContextByEpoch(contexts []*EpochContext, epoch uint64) *EpochContext {
	for _, ctx := range contexts {
		if ctx != nil && ctx.Epoch == epoch {
			return ctx
		}
	}
	return nil
}

func epochContextForSlot(contexts []*EpochContext, slot uint64) *EpochContext {
	var match *EpochContext
	for _, ctx := range contexts {
		if ctx != nil && slot >= ctx.EpochStartSlot && slot < ctx.EpochEndSlotExclusive {
			match = ctx
		}
	}
	return match
}

func epochContextsEqual(left, right *EpochContext) bool {
	if left == nil || right == nil {
		return left == right
	}
	if left.Epoch != right.Epoch ||
		left.SlotsPerKesPeriod != right.SlotsPerKesPeriod ||
		left.EpochStartSlot != right.EpochStartSlot ||
		left.EpochEndSlotExclusive != right.EpochEndSlotExclusive ||
		!bytes.Equal(left.EpochNonce, right.EpochNonce) ||
		len(left.StakeDistribution) != len(right.StakeDistribution) {
		return false
	}

	rightByPool := make(map[string]*StakeDistributionEntry, len(right.StakeDistribution))
	for _, entry := range right.StakeDistribution {
		if entry == nil {
			return false
		}
		rightByPool[strings.ToLower(entry.PoolId)] = entry
	}

	for _, leftEntry := range left.StakeDistribution {
		if leftEntry == nil {
			return false
		}
		rightEntry := rightByPool[strings.ToLower(leftEntry.PoolId)]
		if rightEntry == nil ||
			leftEntry.Stake != rightEntry.Stake ||
			!bytes.Equal(leftEntry.VrfKeyHash, rightEntry.VrfKeyHash) {
			return false
		}
	}
	return true
}

func syncCurrentEpochFields(cs *ClientState, contexts []*EpochContext, currentEpoch uint64) error {
	currentCtx := epochContextByEpoch(contexts, currentEpoch)
	if currentCtx == nil {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "missing epoch context for current epoch %d", currentEpoch)
	}

	cs.CurrentEpoch = currentEpoch
	cs.EpochContexts = cloneEpochContexts(contexts)
	cs.EpochStakeDistribution = cloneStakeDistributionEntries(currentCtx.StakeDistribution)
	cs.EpochNonce = bytes.Clone(currentCtx.EpochNonce)
	cs.SlotsPerKesPeriod = currentCtx.SlotsPerKesPeriod
	cs.CurrentEpochStartSlot = currentCtx.EpochStartSlot
	cs.CurrentEpochEndSlotExclusive = currentCtx.EpochEndSlotExclusive
	return nil
}

func collectReferencedConsensusEpochs(clientStore storetypes.KVStore, cdc codec.BinaryCodec) map[uint64]struct{} {
	referencedEpochs := make(map[uint64]struct{})
	IterateConsensusStateAscending(clientStore, func(height exported.Height) bool {
		if height == nil {
			return false
		}
		consensusState, found := GetConsensusState(clientStore, cdc, height)
		if found {
			referencedEpochs[consensusState.AcceptedEpoch] = struct{}{}
		}
		return false
	})
	return referencedEpochs
}

func retainEpochContexts(contexts []*EpochContext, keep map[uint64]struct{}) []*EpochContext {
	retained := make([]*EpochContext, 0, len(contexts))
	for _, ctx := range contexts {
		if ctx == nil {
			continue
		}
		if _, found := keep[ctx.Epoch]; found {
			retained = append(retained, cloneEpochContext(ctx))
		}
	}
	return retained
}
