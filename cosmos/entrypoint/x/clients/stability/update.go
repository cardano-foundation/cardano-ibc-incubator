package stability

import (
	"fmt"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v10/modules/core/24-host"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func (cs *ClientState) VerifyClientMessage(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) error {
	switch msg := clientMsg.(type) {
	case *StabilityHeader:
		return cs.verifyHeader(ctx, clientStore, cdc, msg)
	case *Misbehaviour:
		return cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	default:
		return clienttypes.ErrInvalidClientType
	}
}

type headerVerificationMode struct {
	enforceForwardUpdate bool
}

func (cs *ClientState) verifyHeader(
	_ sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec,
	header *StabilityHeader,
) error {
	return cs.verifyHeaderWithMode(clientStore, cdc, header, headerVerificationMode{
		enforceForwardUpdate: true,
	})
}

func (cs *ClientState) verifyHeaderAgainstTrustedState(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	header *StabilityHeader,
) error {
	return cs.verifyHeaderWithMode(clientStore, cdc, header, headerVerificationMode{
		enforceForwardUpdate: false,
	})
}

func (cs *ClientState) verifyHeaderWithMode(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	header *StabilityHeader,
	mode headerVerificationMode,
) error {
	if err := header.ValidateBasic(); err != nil {
		return err
	}

	if mode.enforceForwardUpdate && cs.LatestHeight != nil && header.GetHeight().LTE(cs.LatestHeight) {
		return errorsmod.Wrapf(ErrInvalidHeaderHeight, "expected newer header height than %s, got %s", cs.LatestHeight.String(), header.GetHeight().String())
	}

	anchor := header.AnchorBlock
	if anchor == nil || anchor.Height == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "anchor block missing")
	}
	if mode.enforceForwardUpdate {
		if cs.LatestHeight == nil || cs.LatestHeight.IsZero() {
			return errorsmod.Wrap(ErrInvalidHeaderHeight, "latest height must be present for stability header verification")
		}
		if !header.TrustedHeight.EQ(cs.LatestHeight) {
			return errorsmod.Wrapf(
				ErrInvalidHeaderHeight,
				"trusted height %s must equal latest height %s",
				header.TrustedHeight.String(),
				cs.LatestHeight.String(),
			)
		}
	}

	trustedHeight := NewHeight(header.TrustedHeight.RevisionNumber, header.TrustedHeight.RevisionHeight)
	trustedConsensus, found := GetConsensusState(clientStore, cdc, trustedHeight)
	if !found {
		return errorsmod.Wrapf(
			clienttypes.ErrConsensusStateNotFound,
			"trusted consensus state not found at height %s",
			trustedHeight.String(),
		)
	}

	currentEpochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return err
	}
	epochContexts, err := mergeEpochContexts(currentEpochContexts, header.NewEpochContext)
	if err != nil {
		return err
	}

	authenticatedHeader, err := cs.authenticateHeaderBlocksWithContexts(header, epochContexts)
	if err != nil {
		return err
	}

	if err := verifyHeaderEpochTransition(header, trustedConsensus, authenticatedHeader); err != nil {
		return err
	}

	if err := verifyBridgeContinuity(header.TrustedHeight, authenticatedHeader, trustedConsensus); err != nil {
		return err
	}

	anchorEpochContext := epochContextByEpoch(epochContexts, authenticatedHeader.anchorBlock.epoch)
	if anchorEpochContext == nil {
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"missing epoch context for accepted epoch %d",
			authenticatedHeader.anchorBlock.epoch,
		)
	}

	depth := uint64(len(authenticatedHeader.descendantBlocks))
	if depth < cs.HeuristicParams.ThresholdDepth {
		return errorsmod.Wrapf(ErrInvalidStabilityScore, "insufficient descendant depth: got %d, need %d", depth, cs.HeuristicParams.ThresholdDepth)
	}

	uniquePools, uniqueStakeBps, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, anchorEpochContext)
	if err != nil {
		return err
	}

	if uniquePools < cs.HeuristicParams.ThresholdUniquePools {
		return errorsmod.Wrapf(ErrInvalidUniquePools, "insufficient unique pools: got %d, need %d", uniquePools, cs.HeuristicParams.ThresholdUniquePools)
	}
	if uniqueStakeBps < cs.HeuristicParams.ThresholdUniqueStakeBps {
		return errorsmod.Wrapf(ErrInvalidUniqueStake, "insufficient unique stake bps: got %d, need %d", uniqueStakeBps, cs.HeuristicParams.ThresholdUniqueStakeBps)
	}

	if _, err := cs.ExtractIbcStateRootFromHostStateTx(header); err != nil {
		return errorsmod.Wrapf(ErrInvalidHostStateCommitment, "invalid host state tx body: %v", err)
	}

	return nil
}

func verifyHeaderEpochTransition(
	header *StabilityHeader,
	trustedConsensus *ConsensusState,
	authenticatedHeader *authenticatedStabilityHeader,
) error {
	if header == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "stability header missing")
	}
	if trustedConsensus == nil {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "trusted consensus state missing")
	}
	if authenticatedHeader == nil || authenticatedHeader.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}

	trustedEpoch := trustedConsensus.AcceptedEpoch
	anchorEpoch := authenticatedHeader.anchorBlock.epoch

	switch {
	case anchorEpoch < trustedEpoch:
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"accepted epoch %d must not be older than trusted epoch %d",
			anchorEpoch,
			trustedEpoch,
		)
	case anchorEpoch == trustedEpoch:
		if header.NewEpochContext != nil {
			return errorsmod.Wrap(
				ErrInvalidCurrentEpoch,
				"new_epoch_context must be absent for same-epoch stability updates",
			)
		}
	case anchorEpoch == trustedEpoch+1:
		if header.NewEpochContext == nil {
			return errorsmod.Wrap(
				ErrInvalidCurrentEpoch,
				"new_epoch_context must be present for adjacent epoch rollover",
			)
		}
		if header.NewEpochContext.Epoch != anchorEpoch {
			return errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"new_epoch_context epoch %d must match accepted epoch %d",
				header.NewEpochContext.Epoch,
				anchorEpoch,
			)
		}
	default:
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"stability rollover currently supports only adjacent epoch transitions; trusted epoch %d, accepted epoch %d",
			trustedEpoch,
			anchorEpoch,
		)
	}

	for _, block := range authenticatedHeader.bridgeBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated bridge block missing")
		}
		if block.epoch != trustedEpoch && block.epoch != anchorEpoch {
			return errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"bridge block %d crosses unsupported epoch %d for transition %d -> %d",
				block.height,
				block.epoch,
				trustedEpoch,
				anchorEpoch,
			)
		}
	}

	for _, block := range authenticatedHeader.descendantBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated descendant block missing")
		}
		if block.epoch != anchorEpoch {
			return errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"descendant block %d must remain in accepted epoch %d, got epoch %d",
				block.height,
				anchorEpoch,
				block.epoch,
			)
		}
	}

	return nil
}

func verifyBridgeContinuity(
	trustedHeight *Height,
	authenticatedHeader *authenticatedStabilityHeader,
	trustedConsensus *ConsensusState,
) error {
	if trustedConsensus == nil {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "trusted consensus state missing")
	}
	if trustedHeight == nil {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "trusted height missing")
	}
	if authenticatedHeader == nil || authenticatedHeader.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}

	expectedPrevHash := trustedConsensus.AcceptedBlockHash
	expectedHeight := trustedHeight.RevisionHeight + 1

	for _, block := range authenticatedHeader.bridgeBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated bridge block missing")
		}
		if block.prevHash != expectedPrevHash {
			return errorsmod.Wrapf(
				ErrInvalidAcceptedBlock,
				"bridge block %s does not connect to trusted chain",
				block.hash,
			)
		}
		if block.height != expectedHeight {
			return errorsmod.Wrapf(
				ErrInvalidAcceptedBlock,
				"bridge height gap at block %s: got %d expected %d",
				block.hash,
				block.height,
				expectedHeight,
			)
		}

		expectedPrevHash = block.hash
		expectedHeight++
	}

	if authenticatedHeader.anchorBlock.prevHash != expectedPrevHash {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"anchor block %s does not connect to trusted chain",
			authenticatedHeader.anchorBlock.hash,
		)
	}
	if authenticatedHeader.anchorBlock.height != expectedHeight {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"anchor height mismatch: got %d expected %d",
			authenticatedHeader.anchorBlock.height,
			expectedHeight,
		)
	}

	return nil
}

func (cs *ClientState) computeHeaderSecurityMetrics(
	header *authenticatedStabilityHeader,
	epochContext *EpochContext,
) (uint64, uint64, uint64, error) {
	seenPools := make(map[string]struct{})
	uniquePools := uint64(0)
	uniqueStake := uint64(0)
	totalStake := uint64(0)
	stakeByPool := make(map[string]uint64)

	if epochContext == nil {
		return 0, 0, 0, errorsmod.Wrap(ErrInvalidCurrentEpoch, "anchor epoch context must be present")
	}

	if len(epochContext.StakeDistribution) == 0 {
		return 0, 0, 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution must not be empty", epochContext.Epoch)
	}

	for _, entry := range epochContext.StakeDistribution {
		if entry == nil {
			continue
		}
		stakeByPool[strings.ToLower(entry.PoolId)] = entry.Stake
		totalStake += entry.Stake
	}
	if totalStake == 0 {
		return 0, 0, 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution must have positive total stake", epochContext.Epoch)
	}

	if header == nil || header.anchorBlock == nil {
		return 0, 0, 0, errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}

	anchorEpoch := header.anchorBlock.epoch
	prevHash := header.anchorBlock.hash
	prevHeight := header.anchorBlock.height
	for _, block := range header.descendantBlocks {
		if block == nil {
			return 0, 0, 0, errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated descendant block missing")
		}
		if block.prevHash != prevHash {
			return 0, 0, 0, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "descendant chain is not contiguous at block %s", block.hash)
		}
		if block.height != prevHeight+1 {
			return 0, 0, 0, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "descendant height gap at block %s", block.hash)
		}
		if block.epoch != anchorEpoch {
			return 0, 0, 0, errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"descendant block %d must remain in accepted epoch %d, got %d",
				block.height,
				anchorEpoch,
				block.epoch,
			)
		}

		poolID := strings.ToLower(block.slotLeader)
		if poolID != "" {
			if _, exists := seenPools[poolID]; !exists {
				seenPools[poolID] = struct{}{}
				uniquePools++
				uniqueStake += stakeByPool[poolID]
			}
		}

		prevHash = block.hash
		prevHeight = block.height
	}

	uniqueStakeBps := uint64(0)
	uniqueStakeBps = min((uniqueStake*10_000)/totalStake, 10_000)

	score := cs.computeSecurityScore(uint64(len(header.descendantBlocks)), uniquePools, uniqueStakeBps)
	return uniquePools, uniqueStakeBps, score, nil
}

func (cs *ClientState) computeSecurityScore(depth, uniquePools, uniqueStakeBps uint64) uint64 {
	params := cs.HeuristicParams
	depthScore := minBps(depth, params.ThresholdDepth)
	poolsScore := minBps(uniquePools, params.ThresholdUniquePools)
	stakeScore := minBps(uniqueStakeBps, params.ThresholdUniqueStakeBps)
	return min(
		(params.DepthWeightBps*depthScore+
			params.PoolsWeightBps*poolsScore+
			params.StakeWeightBps*stakeScore)/10_000,
		10_000,
	)
}

func minBps(value, target uint64) uint64 {
	if target == 0 {
		return 10_000
	}
	if value >= target {
		return 10_000
	}
	return (value * 10_000) / target
}

func min(a, b uint64) uint64 {
	if a < b {
		return a
	}
	return b
}

func (cs *ClientState) UpdateState(
	ctx sdk.Context,
	cdc codec.BinaryCodec,
	clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) []exported.Height {
	header, ok := clientMsg.(*StabilityHeader)
	if !ok {
		panic(fmt.Errorf("expected type %T, got %T", &StabilityHeader{}, clientMsg))
	}
	currentEpochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		panic(fmt.Errorf("failed to normalize epoch contexts for verified StabilityHeader: %w", err))
	}
	epochContexts, err := mergeEpochContexts(currentEpochContexts, header.NewEpochContext)
	if err != nil {
		panic(fmt.Errorf("failed to merge epoch contexts for verified StabilityHeader: %w", err))
	}
	authenticatedHeader, err := cs.authenticateHeaderBlocksWithContexts(header, epochContexts)
	if err != nil {
		panic(fmt.Errorf("failed to authenticate verified StabilityHeader blocks: %w", err))
	}

	trustedConsensus, found := GetConsensusState(clientStore, cdc, header.TrustedHeight)
	if !found {
		panic(fmt.Errorf("trusted consensus state missing for verified StabilityHeader at height %s", header.TrustedHeight.String()))
	}
	if err := verifyHeaderEpochTransition(header, trustedConsensus, authenticatedHeader); err != nil {
		panic(fmt.Errorf("verified StabilityHeader violated epoch transition rules: %w", err))
	}

	anchorEpochContext := epochContextByEpoch(epochContexts, authenticatedHeader.anchorBlock.epoch)
	if anchorEpochContext == nil {
		panic(fmt.Errorf("missing anchor epoch context for verified StabilityHeader epoch %d", authenticatedHeader.anchorBlock.epoch))
	}

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)
	height := NewHeight(0, header.AnchorBlock.Height.RevisionHeight)

	ibcStateRoot, err := cs.ExtractIbcStateRootFromHostStateTx(header)
	if err != nil {
		panic(fmt.Errorf("failed to extract ibc_state_root from verified StabilityHeader: %w", err))
	}
	uniquePools, uniqueStakeBps, securityScoreBps, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, anchorEpochContext)
	if err != nil {
		panic(fmt.Errorf("failed to recompute stability metrics from verified StabilityHeader: %w", err))
	}
	consensusTimestamp := authenticatedHeader.anchorBlock.timestamp

	newConsensusState := &ConsensusState{
		Timestamp:         consensusTimestamp,
		IbcStateRoot:      ibcStateRoot,
		AcceptedBlockHash: authenticatedHeader.anchorBlock.hash,
		AcceptedEpoch:     authenticatedHeader.anchorBlock.epoch,
		UniquePoolsCount:  uniquePools,
		UniqueStakeBps:    uniqueStakeBps,
		SecurityScoreBps:  securityScoreBps,
	}

	setConsensusState(clientStore, cdc, newConsensusState, header.GetHeight())
	setConsensusMetadata(ctx, clientStore, header.GetHeight())
	clientStore.Set(StabilityScoreKey(height.RevisionHeight), sdk.Uint64ToBigEndian(securityScoreBps))
	clientStore.Set(UniquePoolsKey(height.RevisionHeight), sdk.Uint64ToBigEndian(uniquePools))
	clientStore.Set(UniqueStakeKey(height.RevisionHeight), sdk.Uint64ToBigEndian(uniqueStakeBps))
	clientStore.Set(AcceptedBlockHashKey(height.RevisionHeight), []byte(authenticatedHeader.anchorBlock.hash))

	keepEpochs := collectReferencedConsensusEpochs(clientStore, cdc)
	keepEpochs[authenticatedHeader.anchorBlock.epoch] = struct{}{}
	retainedEpochContexts := retainEpochContexts(epochContexts, keepEpochs)
	if err := syncLegacyEpochContextFields(cs, retainedEpochContexts, authenticatedHeader.anchorBlock.epoch); err != nil {
		panic(fmt.Errorf("failed to persist rollover epoch contexts after verified StabilityHeader: %w", err))
	}
	cs.LatestHeight = height
	setClientState(clientStore, cdc, cs)
	return []exported.Height{height}
}

func (cs ClientState) pruneOldestConsensusState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore) {
	var pruneHeight exported.Height
	pruneCb := func(height exported.Height) bool {
		consState, found := GetConsensusState(clientStore, cdc, height)
		if !found {
			panic(errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "failed to retrieve consensus state at height: %s", height))
		}
		if cs.IsExpired(consState.GetTimestamp(), ctx.BlockTime()) {
			pruneHeight = height
		}
		return true
	}
	IterateConsensusStateAscending(clientStore, pruneCb)
	if pruneHeight != nil {
		deleteConsensusState(clientStore, pruneHeight)
		deleteConsensusMetadata(clientStore, pruneHeight)
	}
}

func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, _ exported.ClientMessage) {
	clientStore.Set(host.ClientStateKey(), clienttypes.MustMarshalClientState(cdc, &cs))
}
