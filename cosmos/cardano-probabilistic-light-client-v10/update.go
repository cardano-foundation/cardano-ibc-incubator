package probabilistic

import (
	"fmt"
	"math"
	"math/bits"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v10/modules/core/24-host"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

const poolRegistrationCutoffUnixNs uint64 = 1_767_225_600_000_000_000 // 2026-01-01T00:00:00Z

func (cs *ClientState) VerifyClientMessage(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) error {
	switch msg := clientMsg.(type) {
	case *ProbabilisticHeader:
		return cs.verifyHeader(ctx, clientStore, cdc, msg)
	case *Misbehaviour:
		return cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	default:
		return clienttypes.ErrInvalidClientType
	}
}

type headerVerificationMode struct {
	enforceForwardUpdate bool
	authenticateHeader   headerAuthenticator
}

// headerAuthenticator is an internal seam for testing the checks that run
// after cryptographic authentication. A nil value always selects the real
// Cardano block authenticator.
type headerAuthenticator func(
	header *ProbabilisticHeader,
	epochContexts []*EpochContext,
	trustedCounters map[string]uint64,
) (*authenticatedProbabilisticHeader, error)

func (cs *ClientState) verifyHeader(
	ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec,
	header *ProbabilisticHeader,
) error {
	return cs.verifyHeaderWithAuthenticator(ctx, clientStore, cdc, header, nil)
}

func (cs *ClientState) verifyHeaderWithAuthenticator(
	ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec,
	header *ProbabilisticHeader,
	authenticateHeader headerAuthenticator,
) error {
	return cs.verifyHeaderWithMode(ctx, clientStore, cdc, header, headerVerificationMode{
		enforceForwardUpdate: true,
		authenticateHeader:   authenticateHeader,
	})
}

func (cs *ClientState) verifyHeaderAgainstTrustedState(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	header *ProbabilisticHeader,
) error {
	return cs.verifyHeaderAgainstTrustedStateWithAuthenticator(ctx, clientStore, cdc, header, nil)
}

func (cs *ClientState) verifyHeaderAgainstTrustedStateWithAuthenticator(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	header *ProbabilisticHeader,
	authenticateHeader headerAuthenticator,
) error {
	return cs.verifyHeaderWithMode(ctx, clientStore, cdc, header, headerVerificationMode{
		enforceForwardUpdate: false,
		authenticateHeader:   authenticateHeader,
	})
}

func (cs *ClientState) verifyHeaderWithMode(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	header *ProbabilisticHeader,
	mode headerVerificationMode,
) error {
	if err := header.ValidateBasic(); err != nil {
		return err
	}

	anchor := header.AnchorBlock
	if anchor == nil || anchor.Height == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "anchor block missing")
	}

	var trustedBlock *trustedBlockState
	var err error
	if mode.enforceForwardUpdate {
		if err := cs.validateCheckpointFields(); err != nil {
			return err
		}
		expectedTrustedHeight := cs.LatestHeight
		if cs.LatestCheckpointHeight != nil && !cs.LatestCheckpointHeight.IsZero() {
			expectedTrustedHeight = cs.LatestCheckpointHeight
		}
		if expectedTrustedHeight == nil || expectedTrustedHeight.IsZero() {
			return errorsmod.Wrap(ErrInvalidHeaderHeight, "latest authenticated checkpoint must be present")
		}
		if header.GetHeight().LTE(expectedTrustedHeight) {
			return errorsmod.Wrapf(
				ErrInvalidHeaderHeight,
				"expected newer header height than authenticated checkpoint %s, got %s",
				expectedTrustedHeight.String(),
				header.GetHeight().String(),
			)
		}
		if !header.TrustedHeight.EQ(expectedTrustedHeight) {
			return errorsmod.Wrapf(
				ErrInvalidHeaderHeight,
				"trusted height %s must equal latest authenticated checkpoint %s",
				header.TrustedHeight.String(),
				expectedTrustedHeight.String(),
			)
		}
		trustedBlock, err = cs.latestTrustedBlockState(clientStore, cdc)
		if err != nil {
			return err
		}
	} else {
		trustedBlock, err = cs.trustedBlockStateAtHeight(clientStore, cdc, header.TrustedHeight)
		if err != nil {
			return err
		}
	}

	currentEpochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return err
	}
	epochContexts, err := mergeEpochContexts(currentEpochContexts, header.NewEpochContext)
	if err != nil {
		return err
	}

	authenticateHeader := mode.authenticateHeader
	if authenticateHeader == nil {
		authenticateHeader = cs.authenticateHeaderBlocksWithContexts
	}
	authenticatedHeader, err := authenticateHeader(
		header,
		epochContexts,
		trustedBlock.operationalCertificateCounters,
	)
	if err != nil {
		return err
	}

	if err := verifyHeaderEpochTransition(header, trustedBlock, authenticatedHeader); err != nil {
		return err
	}

	if err := verifyBridgeContinuity(authenticatedHeader, trustedBlock); err != nil {
		return err
	}
	if err := cs.verifyHeaderTemporalContinuity(ctx, authenticatedHeader, trustedBlock); err != nil {
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
	if depth < DefaultThresholdDepth {
		return errorsmod.Wrapf(ErrInvalidProbabilisticScore, "insufficient descendant depth: got %d, need %d", depth, DefaultThresholdDepth)
	}

	qualifiedUniquePools, qualifiedUniqueStakeBps, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, anchorEpochContext)
	if err != nil {
		return err
	}

	if qualifiedUniquePools < DefaultThresholdUniquePools {
		return errorsmod.Wrapf(ErrInvalidUniquePools, "insufficient qualified unique pools: got %d, need %d", qualifiedUniquePools, DefaultThresholdUniquePools)
	}
	if qualifiedUniqueStakeBps < DefaultThresholdUniqueStakeBps {
		return errorsmod.Wrapf(ErrInvalidUniqueStake, "insufficient qualified unique stake bps: got %d, need %d", qualifiedUniqueStakeBps, DefaultThresholdUniqueStakeBps)
	}

	if !header.IsCheckpoint {
		if _, err := cs.ExtractIbcStateRootFromHostStateTx(header); err != nil {
			return errorsmod.Wrapf(ErrInvalidHostStateCommitment, "invalid host state tx body: %v", err)
		}
	}

	return nil
}

func verifyHeaderEpochTransition(
	header *ProbabilisticHeader,
	trustedBlock *trustedBlockState,
	authenticatedHeader *authenticatedProbabilisticHeader,
) error {
	if header == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "probabilistic header missing")
	}
	if trustedBlock == nil {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "trusted block state missing")
	}
	if authenticatedHeader == nil || authenticatedHeader.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}

	trustedEpoch := trustedBlock.epoch
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
			if header.NewEpochContext.Epoch != anchorEpoch {
				return errorsmod.Wrapf(
					ErrInvalidCurrentEpoch,
					"same-epoch new_epoch_context epoch %d must match accepted epoch %d",
					header.NewEpochContext.Epoch,
					anchorEpoch,
				)
			}
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
			"probabilistic rollover currently supports only adjacent epoch transitions; trusted epoch %d, accepted epoch %d",
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
	authenticatedHeader *authenticatedProbabilisticHeader,
	trustedBlock *trustedBlockState,
) error {
	if trustedBlock == nil || trustedBlock.height == nil {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "trusted block state missing")
	}
	if authenticatedHeader == nil || authenticatedHeader.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}

	expectedPrevHash := trustedBlock.blockHash
	expectedHeight := trustedBlock.height.RevisionHeight + 1

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
	header *authenticatedProbabilisticHeader,
	epochContext *EpochContext,
) (uint64, uint64, uint64, error) {
	seenPools := make(map[string]struct{})
	qualifiedUniquePools := uint64(0)
	qualifiedUniqueStake := uint64(0)
	totalActiveStake := uint64(0)
	stakeByPool := make(map[string]*StakeDistributionEntry)

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
		stakeByPool[strings.ToLower(entry.PoolId)] = entry
		nextTotalActiveStake, ok := checkedAddStake(totalActiveStake, entry.Stake)
		if !ok {
			return 0, 0, 0, errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"epoch %d stake distribution total overflows uint64",
				epochContext.Epoch,
			)
		}
		totalActiveStake = nextTotalActiveStake
	}
	if totalActiveStake == 0 {
		return 0, 0, 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution must have positive total stake", epochContext.Epoch)
	}

	if header == nil || header.anchorBlock == nil {
		return 0, 0, 0, errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}
	poolRegistrationCutoffSlot, err := cs.poolRegistrationCutoffSlotExclusive()
	if err != nil {
		return 0, 0, 0, err
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
				entry := stakeByPool[poolID]
				eligible, err := poolRegisteredBeforeCutoff(poolRegistrationCutoffSlot, entry)
				if err != nil {
					return 0, 0, 0, err
				}
				if eligible {
					qualifiedUniquePools++
					nextQualifiedUniqueStake, ok := checkedAddStake(qualifiedUniqueStake, entry.Stake)
					if !ok {
						return 0, 0, 0, errorsmod.Wrap(
							ErrInvalidUniqueStake,
							"qualified unique stake total overflows uint64",
						)
					}
					qualifiedUniqueStake = nextQualifiedUniqueStake
				}
			}
		}

		prevHash = block.hash
		prevHeight = block.height
	}

	qualifiedUniqueStakeBps := minBps(qualifiedUniqueStake, totalActiveStake)

	score := cs.computeSecurityScore(uint64(len(header.descendantBlocks)), qualifiedUniquePools, qualifiedUniqueStakeBps)
	return qualifiedUniquePools, qualifiedUniqueStakeBps, score, nil
}

func checkedAddStake(current, addition uint64) (uint64, bool) {
	sum, carry := bits.Add64(current, addition, 0)
	return sum, carry == 0
}

func (cs *ClientState) poolRegistrationCutoffSlotExclusive() (uint64, error) {
	if cs == nil {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "client state missing")
	}
	if cs.SystemStartUnixNs == 0 {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "system_start_unix_ns must be greater than zero")
	}
	if cs.SlotLengthNs == 0 {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "slot_length_ns must be greater than zero")
	}
	if poolRegistrationCutoffUnixNs <= cs.SystemStartUnixNs {
		return 0, nil
	}

	delta := poolRegistrationCutoffUnixNs - cs.SystemStartUnixNs
	if delta > math.MaxUint64-(cs.SlotLengthNs-1) {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "pool registration cutoff slot overflows uint64")
	}
	return (delta + cs.SlotLengthNs - 1) / cs.SlotLengthNs, nil
}

func poolRegisteredBeforeCutoff(cutoffSlotExclusive uint64, entry *StakeDistributionEntry) (bool, error) {
	if entry == nil {
		return false, errorsmod.Wrap(ErrInvalidCurrentEpoch, "descendant slot leader missing from epoch stake distribution")
	}
	if entry.FirstRegistrationSlot == 0 {
		return false, errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"first registration slot missing for pool %s",
			entry.PoolId,
		)
	}
	return entry.FirstRegistrationSlot < cutoffSlotExclusive, nil
}

func (cs *ClientState) computeSecurityScore(depth, qualifiedUniquePools, qualifiedUniqueStakeBps uint64) uint64 {
	depthScore := minBps(depth, DefaultThresholdDepth)
	poolsScore := minBps(qualifiedUniquePools, DefaultThresholdUniquePools)
	qualifiedStakeScore := minBps(qualifiedUniqueStakeBps, DefaultThresholdUniqueStakeBps)
	return min(
		(DefaultDepthWeightBps*depthScore+
			DefaultPoolsWeightBps*poolsScore+
			DefaultStakeWeightBps*qualifiedStakeScore)/10_000,
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

	// value is below target, so the quotient is below 10,000 and fits in
	// uint64. Div64 therefore receives a high word smaller than its divisor.
	high, low := bits.Mul64(value, 10_000)
	quotient, _ := bits.Div64(high, low, target)
	return quotient
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
	header, ok := clientMsg.(*ProbabilisticHeader)
	if !ok {
		panic(fmt.Errorf("expected type %T, got %T", &ProbabilisticHeader{}, clientMsg))
	}
	currentEpochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		panic(fmt.Errorf("failed to normalize epoch contexts for verified ProbabilisticHeader: %w", err))
	}
	epochContexts, err := mergeEpochContexts(currentEpochContexts, header.NewEpochContext)
	if err != nil {
		panic(fmt.Errorf("failed to merge epoch contexts for verified ProbabilisticHeader: %w", err))
	}
	trustedBlock, err := cs.trustedBlockStateAtHeight(clientStore, cdc, header.TrustedHeight)
	if err != nil {
		panic(fmt.Errorf("trusted block state missing for verified ProbabilisticHeader at height %s: %w", header.TrustedHeight.String(), err))
	}
	authenticatedHeader, err := cs.authenticateHeaderBlocksWithContexts(
		header,
		epochContexts,
		trustedBlock.operationalCertificateCounters,
	)
	if err != nil {
		panic(fmt.Errorf("failed to authenticate verified ProbabilisticHeader blocks: %w", err))
	}
	if err := verifyHeaderEpochTransition(header, trustedBlock, authenticatedHeader); err != nil {
		panic(fmt.Errorf("verified ProbabilisticHeader violated epoch transition rules: %w", err))
	}

	anchorEpochContext := epochContextByEpoch(epochContexts, authenticatedHeader.anchorBlock.epoch)
	if anchorEpochContext == nil {
		panic(fmt.Errorf("missing anchor epoch context for verified ProbabilisticHeader epoch %d", authenticatedHeader.anchorBlock.epoch))
	}

	height := NewHeight(0, header.AnchorBlock.Height.RevisionHeight)
	if header.IsCheckpoint {
		if err := cs.persistCheckpoint(clientStore, cdc, epochContexts, authenticatedHeader); err != nil {
			panic(fmt.Errorf("failed to persist verified checkpoint: %w", err))
		}
		return nil
	}

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)

	ibcStateRoot, err := cs.ExtractIbcStateRootFromHostStateTx(header)
	if err != nil {
		panic(fmt.Errorf("failed to extract ibc_state_root from verified ProbabilisticHeader: %w", err))
	}
	qualifiedUniquePools, qualifiedUniqueStakeBps, securityScoreBps, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, anchorEpochContext)
	if err != nil {
		panic(fmt.Errorf("failed to recompute probabilistic metrics from verified ProbabilisticHeader: %w", err))
	}
	setAuthenticatedConsensusState(
		clientStore,
		cdc,
		header.GetHeight(),
		authenticatedHeader,
		ibcStateRoot,
		qualifiedUniquePools,
		qualifiedUniqueStakeBps,
		securityScoreBps,
	)
	setConsensusMetadata(ctx, clientStore, header.GetHeight())
	clientStore.Set(ProbabilisticScoreKey(height.RevisionHeight), sdk.Uint64ToBigEndian(securityScoreBps))
	clientStore.Set(UniquePoolsKey(height.RevisionHeight), sdk.Uint64ToBigEndian(qualifiedUniquePools))
	clientStore.Set(UniqueStakeKey(height.RevisionHeight), sdk.Uint64ToBigEndian(qualifiedUniqueStakeBps))
	clientStore.Set(AcceptedBlockHashKey(height.RevisionHeight), []byte(authenticatedHeader.anchorBlock.hash))

	keepEpochs := collectReferencedConsensusEpochs(clientStore, cdc)
	keepEpochs[authenticatedHeader.anchorBlock.epoch] = struct{}{}
	retainedEpochContexts := retainEpochContexts(epochContexts, keepEpochs)
	if err := syncCurrentEpochFields(cs, retainedEpochContexts, authenticatedHeader.anchorBlock.epoch); err != nil {
		panic(fmt.Errorf("failed to persist rollover epoch contexts after verified ProbabilisticHeader: %w", err))
	}
	cs.LatestHeight = height
	if err := cs.persistOperationalCertificateCounterSnapshot(
		clientStore,
		height,
		authenticatedHeader.anchorOperationalCertificateCounters,
	); err != nil {
		panic(fmt.Errorf("failed to persist operational certificate counter state: %w", err))
	}
	cs.setLatestCheckpoint(
		height,
		authenticatedHeader.anchorBlock.hash,
		authenticatedHeader.anchorBlock.epoch,
		authenticatedHeader.anchorBlock.slot,
		authenticatedHeader.anchorBlock.timestamp,
	)
	if err := cs.compactOperationalCertificateCounterHistory(clientStore, cdc); err != nil {
		panic(fmt.Errorf("failed to compact operational certificate counter history: %w", err))
	}
	setClientState(clientStore, cdc, cs)
	return []exported.Height{height}
}

func setAuthenticatedConsensusState(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
	authenticatedHeader *authenticatedProbabilisticHeader,
	ibcStateRoot []byte,
	qualifiedUniquePools uint64,
	qualifiedUniqueStakeBps uint64,
	securityScoreBps uint64,
) {
	setConsensusState(clientStore, cdc, &ConsensusState{
		Timestamp:         authenticatedHeader.anchorBlock.timestamp,
		IbcStateRoot:      ibcStateRoot,
		AcceptedBlockHash: authenticatedHeader.anchorBlock.hash,
		AcceptedEpoch:     authenticatedHeader.anchorBlock.epoch,
		UniquePoolsCount:  qualifiedUniquePools,
		UniqueStakeBps:    qualifiedUniqueStakeBps,
		SecurityScoreBps:  securityScoreBps,
	}, height)
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
	cs.FrozenHeight = FrozenHeight
	clientStore.Set(host.ClientStateKey(), clienttypes.MustMarshalClientState(cdc, &cs))
}
