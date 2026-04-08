package stability

import (
	"fmt"

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

func (cs *ClientState) verifyHeader(
	_ sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec,
	header *StabilityHeader,
) error {
	if err := header.ValidateBasic(); err != nil {
		return err
	}

	if cs.LatestHeight != nil && header.GetHeight().LTE(cs.LatestHeight) {
		return errorsmod.Wrapf(ErrInvalidHeaderHeight, "expected newer header height than %s, got %s", cs.LatestHeight.String(), header.GetHeight().String())
	}

	anchor := header.AnchorBlock
	if anchor == nil || anchor.Height == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "anchor block missing")
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

	if err := verifyBridgeContinuity(header, trustedConsensus); err != nil {
		return err
	}

	depth := uint64(len(header.DescendantBlocks))
	if depth < cs.HeuristicParams.ThresholdDepth {
		return errorsmod.Wrapf(ErrInvalidStabilityScore, "insufficient descendant depth: got %d, need %d", depth, cs.HeuristicParams.ThresholdDepth)
	}

	uniquePools, uniqueStakeBps, securityScoreBps, err := cs.computeHeaderSecurityMetrics(header)
	if err != nil {
		return err
	}

	if header.UniquePoolsCount != uniquePools {
		return errorsmod.Wrapf(ErrInvalidUniquePools, "header unique pool count mismatch: got %d, expected %d", header.UniquePoolsCount, uniquePools)
	}
	if header.UniqueStakeBps != uniqueStakeBps {
		return errorsmod.Wrapf(ErrInvalidUniqueStake, "header unique stake bps mismatch: got %d, expected %d", header.UniqueStakeBps, uniqueStakeBps)
	}
	if header.SecurityScoreBps != securityScoreBps {
		return errorsmod.Wrapf(ErrInvalidStabilityScore, "header security score mismatch: got %d, expected %d", header.SecurityScoreBps, securityScoreBps)
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

func verifyBridgeContinuity(header *StabilityHeader, trustedConsensus *ConsensusState) error {
	if trustedConsensus == nil {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "trusted consensus state missing")
	}

	expectedPrevHash := trustedConsensus.AcceptedBlockHash
	expectedHeight := header.TrustedHeight.RevisionHeight + 1

	for _, block := range header.BridgeBlocks {
		if block == nil || block.Height == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "bridge block missing height")
		}
		if block.PrevHash != expectedPrevHash {
			return errorsmod.Wrapf(
				ErrInvalidAcceptedBlock,
				"bridge block %s does not connect to trusted chain",
				block.Hash,
			)
		}
		if block.Height.RevisionHeight != expectedHeight {
			return errorsmod.Wrapf(
				ErrInvalidAcceptedBlock,
				"bridge height gap at block %s: got %d expected %d",
				block.Hash,
				block.Height.RevisionHeight,
				expectedHeight,
			)
		}

		expectedPrevHash = block.Hash
		expectedHeight++
	}

	if header.AnchorBlock.PrevHash != expectedPrevHash {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"anchor block %s does not connect to trusted chain",
			header.AnchorBlock.Hash,
		)
	}
	if header.AnchorBlock.Height.RevisionHeight != expectedHeight {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"anchor height mismatch: got %d expected %d",
			header.AnchorBlock.Height.RevisionHeight,
			expectedHeight,
		)
	}

	return nil
}

func (cs *ClientState) computeHeaderSecurityMetrics(header *StabilityHeader) (uint64, uint64, uint64, error) {
	seenPools := make(map[string]struct{})
	uniquePools := uint64(0)
	uniqueStake := uint64(0)
	totalStake := uint64(0)
	stakeByPool := make(map[string]uint64)

	for _, entry := range cs.EpochStakeDistribution {
		stakeByPool[entry.PoolId] = entry.Stake
		totalStake += entry.Stake
	}

	prevHash := header.AnchorBlock.Hash
	prevHeight := header.AnchorBlock.Height.RevisionHeight
	for _, block := range header.DescendantBlocks {
		if block == nil || block.Height == nil {
			return 0, 0, 0, errorsmod.Wrap(ErrInvalidAcceptedBlock, "descendant block missing height")
		}
		if block.PrevHash != prevHash {
			return 0, 0, 0, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "descendant chain is not contiguous at block %s", block.Hash)
		}
		if block.Height.RevisionHeight != prevHeight+1 {
			return 0, 0, 0, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "descendant height gap at block %s", block.Hash)
		}

		if block.SlotLeader != "" {
			if _, exists := seenPools[block.SlotLeader]; !exists {
				seenPools[block.SlotLeader] = struct{}{}
				uniquePools++
				if totalStake > 0 {
					uniqueStake += stakeByPool[block.SlotLeader]
				} else {
					uniqueStake += min(block.StakeBps, 10_000)
				}
			}
		}

		prevHash = block.Hash
		prevHeight = block.Height.RevisionHeight
	}

	uniqueStakeBps := uint64(0)
	if totalStake > 0 {
		uniqueStakeBps = min((uniqueStake*10_000)/totalStake, 10_000)
	} else {
		uniqueStakeBps = min(uniqueStake, 10_000)
	}

	score := cs.computeSecurityScore(uint64(len(header.DescendantBlocks)), uniquePools, uniqueStakeBps)
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

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)
	height := NewHeight(0, header.AnchorBlock.Height.RevisionHeight)
	cs.LatestHeight = &height
	cs.CurrentEpoch = header.AnchorBlock.Epoch

	ibcStateRoot, err := cs.ExtractIbcStateRootFromHostStateTx(header)
	if err != nil {
		panic(fmt.Errorf("failed to extract ibc_state_root from verified StabilityHeader: %w", err))
	}

	newConsensusState := &ConsensusState{
		Timestamp:         header.GetTimestamp(),
		IbcStateRoot:      ibcStateRoot,
		AcceptedBlockHash: header.AnchorBlock.Hash,
		AcceptedEpoch:     header.AnchorBlock.Epoch,
		UniquePoolsCount:  header.UniquePoolsCount,
		UniqueStakeBps:    header.UniqueStakeBps,
		SecurityScoreBps:  header.SecurityScoreBps,
	}

	setClientState(clientStore, cdc, cs)
	setConsensusState(clientStore, cdc, newConsensusState, header.GetHeight())
	setConsensusMetadata(ctx, clientStore, header.GetHeight())
	clientStore.Set(StabilityScoreKey(height.RevisionHeight), sdk.Uint64ToBigEndian(header.SecurityScoreBps))
	clientStore.Set(UniquePoolsKey(height.RevisionHeight), sdk.Uint64ToBigEndian(header.UniquePoolsCount))
	clientStore.Set(UniqueStakeKey(height.RevisionHeight), sdk.Uint64ToBigEndian(header.UniqueStakeBps))
	clientStore.Set(AcceptedBlockHashKey(height.RevisionHeight), []byte(header.AnchorBlock.Hash))
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
