package stability

import (
	"bytes"
	"slices"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
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
				PoolId:     entry.PoolId,
				Stake:      entry.Stake,
				VrfKeyHash: bytes.Clone(entry.VrfKeyHash),
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

func (cs ClientState) legacyEpochContext() *EpochContext {
	if len(cs.EpochStakeDistribution) == 0 && len(cs.EpochNonce) == 0 &&
		cs.SlotsPerKesPeriod == 0 && cs.CurrentEpochStartSlot == 0 && cs.CurrentEpochEndSlotExclusive == 0 {
		return nil
	}

	return &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		StakeDistribution:     cloneStakeDistributionEntries(cs.EpochStakeDistribution),
		EpochNonce:            bytes.Clone(cs.EpochNonce),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
	}
}

func cloneStakeDistributionEntries(entries []*StakeDistributionEntry) []*StakeDistributionEntry {
	cloned := make([]*StakeDistributionEntry, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		cloned = append(cloned, &StakeDistributionEntry{
			PoolId:     entry.PoolId,
			Stake:      entry.Stake,
			VrfKeyHash: bytes.Clone(entry.VrfKeyHash),
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
	contexts := cloneEpochContexts(cs.EpochContexts)
	if len(contexts) == 0 {
		if legacy := cs.legacyEpochContext(); legacy != nil {
			contexts = append(contexts, legacy)
		}
	}
	return normalizeEpochContexts(contexts)
}

func mergeEpochContexts(base []*EpochContext, candidate *EpochContext) ([]*EpochContext, error) {
	contexts := cloneEpochContexts(base)
	if candidate != nil {
		contexts = append(contexts, cloneEpochContext(candidate))
	}
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
	for _, ctx := range contexts {
		if ctx != nil && slot >= ctx.EpochStartSlot && slot < ctx.EpochEndSlotExclusive {
			return ctx
		}
	}
	return nil
}

func syncLegacyEpochContextFields(cs *ClientState, contexts []*EpochContext, currentEpoch uint64) error {
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
