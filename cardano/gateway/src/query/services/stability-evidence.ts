import { Logger } from '@nestjs/common';
import { HeuristicParams } from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import {
  GrpcInternalException,
  GrpcNotFoundException,
} from '~@/exception/grpc_exceptions';
import {
  HistoryBlock,
  HistoryEpochVerificationContext,
  HistoryService,
  HistoryStakeDistributionEntry,
  HistoryTxEvidence,
} from './history.service';
import {
  assertEpochStakeDistributionAvailable,
  getStabilityThresholdFailure,
  assertStabilityThresholds,
  computeStabilityMetrics,
  getStabilityHeuristicParams,
  getStabilityLookaheadDepth,
  scoreDescendantBlocks,
  StabilityMetrics,
} from './stability-scoring';

declare const cardanoHeightBrand: unique symbol;
declare const epochNumberBrand: unique symbol;

export type CardanoHeight = bigint & { readonly [cardanoHeightBrand]: 'CardanoHeight' };
export type EpochNumber = number & { readonly [epochNumberBrand]: 'EpochNumber' };

export type StakeWeightedStabilityEvidence = {
  anchorHeight: CardanoHeight;
  anchorEpoch: EpochNumber;
  anchorBlock: HistoryBlock;
  descendantBlocks: HistoryBlock[];
  epochStakeDistribution: HistoryStakeDistributionEntry[];
  epochVerificationContext: HistoryEpochVerificationContext;
  heuristicParams: HeuristicParams;
  metrics: StabilityMetrics;
};

export type StakeWeightedStabilityTxEvidence = StakeWeightedStabilityEvidence & {
  hostStateTxEvidence: HistoryTxEvidence;
};

export type StakeWeightedStabilityHeaderEvidence = StakeWeightedStabilityEvidence & {
  trustedHeight: CardanoHeight;
  bridgeBlocks: HistoryBlock[];
};

function assertBlocksRemainInEpoch(
  blocks: HistoryBlock[],
  expectedEpoch: number,
  context: string,
): void {
  const mismatchedBlock = blocks.find((block) => block.epochNo !== expectedEpoch);
  if (mismatchedBlock) {
    throw new GrpcInternalException(
      `${context} crosses epoch boundary at height ${mismatchedBlock.height}: expected epoch ${expectedEpoch}, got ${mismatchedBlock.epochNo}`,
    );
  }
}

function assertBlocksRemainWithinEpochSlotBounds(
  blocks: HistoryBlock[],
  epochVerificationContext: HistoryEpochVerificationContext,
  context: string,
): void {
  const violatingBlock = blocks.find(
    (block) =>
      block.slotNo < epochVerificationContext.currentEpochStartSlot ||
      block.slotNo >= epochVerificationContext.currentEpochEndSlotExclusive,
  );
  if (violatingBlock) {
    throw new GrpcInternalException(
      `${context} crosses trusted epoch slot bounds at height ${violatingBlock.height}: slot ${violatingBlock.slotNo.toString()} not in [${epochVerificationContext.currentEpochStartSlot.toString()}, ${epochVerificationContext.currentEpochEndSlotExclusive.toString()})`,
    );
  }
}

function findFirstEpochBoundaryViolation(
  blocks: HistoryBlock[],
  expectedEpoch: number,
  epochVerificationContext: HistoryEpochVerificationContext,
): number {
  return blocks.findIndex(
    (block) =>
      block.epochNo !== expectedEpoch ||
      block.slotNo < epochVerificationContext.currentEpochStartSlot ||
      block.slotNo >= epochVerificationContext.currentEpochEndSlotExclusive,
  );
}

function throwDescendantBoundaryViolation(
  violatingBlock: HistoryBlock,
  expectedEpoch: number,
  epochVerificationContext: HistoryEpochVerificationContext,
  anchorHeight: number,
): never {
  if (violatingBlock.epochNo !== expectedEpoch) {
    throw new GrpcInternalException(
      `Stake-weighted stability descendant window for anchor height ${anchorHeight} crosses epoch boundary at height ${violatingBlock.height}: expected epoch ${expectedEpoch}, got ${violatingBlock.epochNo}`,
    );
  }

  throw new GrpcInternalException(
    `Stake-weighted stability descendant window for anchor height ${anchorHeight} crosses trusted epoch slot bounds at height ${violatingBlock.height}: slot ${violatingBlock.slotNo.toString()} not in [${epochVerificationContext.currentEpochStartSlot.toString()}, ${epochVerificationContext.currentEpochEndSlotExclusive.toString()})`,
  );
}

function assertEpochVerificationContextAvailable(
  epochVerificationContext: HistoryEpochVerificationContext | null,
  epoch: number,
  context: string,
): asserts epochVerificationContext is HistoryEpochVerificationContext {
  if (!epochVerificationContext) {
    throw new GrpcInternalException(
      `Epoch verification context unavailable for ${context} in epoch ${epoch}`,
    );
  }
  if (!epochVerificationContext.epochNonce) {
    throw new GrpcInternalException(
      `Epoch nonce unavailable for ${context} in epoch ${epoch}`,
    );
  }
  if (epochVerificationContext.slotsPerKesPeriod <= 0) {
    throw new GrpcInternalException(
      `Slots-per-KES-period unavailable for ${context} in epoch ${epoch}`,
    );
  }
  if (
    epochVerificationContext.currentEpochEndSlotExclusive <=
    epochVerificationContext.currentEpochStartSlot
  ) {
    throw new GrpcInternalException(
      `Invalid epoch slot bounds for ${context} in epoch ${epoch}`,
    );
  }
}

function assertStakeVerificationContextAvailable(
  epochStakeDistribution: HistoryStakeDistributionEntry[],
  epoch: number,
  context: string,
): void {
  const missingVrfKey = epochStakeDistribution.find((entry) => !entry.vrfKeyHash);
  if (missingVrfKey) {
    throw new GrpcInternalException(
      `VRF key hash unavailable for pool ${missingVrfKey.poolId} in ${context} for epoch ${epoch}`,
    );
  }
}

type LoadStakeWeightedStabilityEvidenceByHeightParams = {
  historyService: HistoryService;
  height: bigint;
  logger?: Logger;
  heuristicParams?: HeuristicParams;
  requireThresholds?: boolean;
  missingAnchorBlockMessage?: string;
};

type LoadStakeWeightedStabilityEvidenceForTxHashParams = {
  historyService: HistoryService;
  txHash: string;
  logger?: Logger;
  heuristicParams?: HeuristicParams;
  requireThresholds?: boolean;
  missingTxEvidenceMessage?: string;
  missingAnchorBlockMessage?: string;
};

type LoadStakeWeightedStabilityHeaderEvidenceParams = LoadStakeWeightedStabilityEvidenceByHeightParams & {
  trustedHeight: bigint;
};

export async function loadStakeWeightedStabilityEvidenceByHeight({
  historyService,
  height,
  logger,
  heuristicParams = getStabilityHeuristicParams(),
  requireThresholds = true,
  missingAnchorBlockMessage,
}: LoadStakeWeightedStabilityEvidenceByHeightParams): Promise<StakeWeightedStabilityEvidence> {
  const anchorBlock = await historyService.findBlockByHeight(height);
  if (!anchorBlock) {
    throw new GrpcNotFoundException(
      missingAnchorBlockMessage ?? `Not found: "height" ${height.toString()} not found`,
    );
  }

  const descendantBlocks = await historyService.findDescendantBlocks(
    BigInt(anchorBlock.height),
    getStabilityLookaheadDepth(heuristicParams),
  );
  const epochStakeDistribution = await historyService.findEpochStakeDistribution(anchorBlock.epochNo);
  const epochVerificationContext = await historyService.findEpochVerificationContext(anchorBlock.epochNo);
  assertEpochStakeDistributionAvailable(
    epochStakeDistribution,
    `anchor height ${anchorBlock.height} in epoch ${anchorBlock.epochNo}`,
  );
  assertStakeVerificationContextAvailable(
    epochStakeDistribution,
    anchorBlock.epochNo,
    `anchor height ${anchorBlock.height}`,
  );
  assertEpochVerificationContextAvailable(
    epochVerificationContext,
    anchorBlock.epochNo,
    `anchor height ${anchorBlock.height}`,
  );
  assertBlocksRemainWithinEpochSlotBounds(
    [anchorBlock],
    epochVerificationContext,
    `Stake-weighted stability anchor block for height ${anchorBlock.height}`,
  );
  const scoredDescendantBlocks = scoreDescendantBlocks(descendantBlocks, epochStakeDistribution, logger);
  const firstInvalidDescendantIndex = findFirstEpochBoundaryViolation(
    scoredDescendantBlocks,
    anchorBlock.epochNo,
    epochVerificationContext,
  );
  const eligibleDescendantBlocks =
    firstInvalidDescendantIndex >= 0
      ? scoredDescendantBlocks.slice(0, firstInvalidDescendantIndex)
      : scoredDescendantBlocks;

  let acceptedDescendantBlocks = eligibleDescendantBlocks;
  let metrics = computeStabilityMetrics(eligibleDescendantBlocks, epochStakeDistribution, heuristicParams);

  const thresholdDepth = Number(heuristicParams.threshold_depth || 0n);
  if (requireThresholds) {
    for (
      let prefixLength = Math.max(thresholdDepth, 1);
      prefixLength <= eligibleDescendantBlocks.length;
      prefixLength += 1
    ) {
      const candidateDescendantBlocks = eligibleDescendantBlocks.slice(0, prefixLength);
      const candidateMetrics = computeStabilityMetrics(
        candidateDescendantBlocks,
        epochStakeDistribution,
        heuristicParams,
      );

      if (
        !getStabilityThresholdFailure(
          candidateMetrics,
          heuristicParams,
          anchorBlock.height.toString(),
          candidateDescendantBlocks.length,
        )
      ) {
        acceptedDescendantBlocks = candidateDescendantBlocks;
        metrics = candidateMetrics;
        break;
      }
    }
  }

  if (requireThresholds) {
    const thresholdFailure = getStabilityThresholdFailure(
      metrics,
      heuristicParams,
      anchorBlock.height.toString(),
      acceptedDescendantBlocks.length,
    );
    if (thresholdFailure) {
      if (firstInvalidDescendantIndex >= 0) {
        throwDescendantBoundaryViolation(
          scoredDescendantBlocks[firstInvalidDescendantIndex],
          anchorBlock.epochNo,
          epochVerificationContext,
          anchorBlock.height,
        );
      }

      assertStabilityThresholds(
        metrics,
        heuristicParams,
        anchorBlock.height.toString(),
        acceptedDescendantBlocks.length,
      );
    }
  }

  return {
    anchorHeight: BigInt(anchorBlock.height) as CardanoHeight,
    anchorEpoch: anchorBlock.epochNo as EpochNumber,
    anchorBlock,
    descendantBlocks: acceptedDescendantBlocks,
    epochStakeDistribution,
    epochVerificationContext,
    heuristicParams,
    metrics,
  };
}

export async function loadStakeWeightedStabilityEvidenceForTxHash({
  historyService,
  txHash,
  logger,
  heuristicParams = getStabilityHeuristicParams(),
  requireThresholds = true,
  missingTxEvidenceMessage,
  missingAnchorBlockMessage,
}: LoadStakeWeightedStabilityEvidenceForTxHashParams): Promise<StakeWeightedStabilityTxEvidence> {
  const hostStateTxEvidence = await historyService.findTransactionEvidenceByHash(txHash);
  if (!hostStateTxEvidence) {
    throw new GrpcInternalException(
      missingTxEvidenceMessage ?? `Historical tx evidence unavailable for tx ${txHash}`,
    );
  }

  const evidence = await loadStakeWeightedStabilityEvidenceByHeight({
    historyService,
    height: BigInt(hostStateTxEvidence.blockNo),
    logger,
    heuristicParams,
    requireThresholds,
    missingAnchorBlockMessage,
  });

  return {
    ...evidence,
    hostStateTxEvidence,
  };
}

export async function loadStakeWeightedStabilityHeaderEvidence({
  historyService,
  height,
  trustedHeight,
  logger,
  heuristicParams = getStabilityHeuristicParams(),
  requireThresholds = true,
  missingAnchorBlockMessage,
}: LoadStakeWeightedStabilityHeaderEvidenceParams): Promise<StakeWeightedStabilityHeaderEvidence> {
  if (trustedHeight <= 0n) {
    throw new GrpcInternalException(`Invalid trusted height ${trustedHeight.toString()} for stability header`);
  }
  if (trustedHeight >= height) {
    throw new GrpcInternalException(
      `Invalid stability header request: trusted height ${trustedHeight.toString()} must be less than anchor height ${height.toString()}`,
    );
  }

  const evidence = await loadStakeWeightedStabilityEvidenceByHeight({
    historyService,
    height,
    logger,
    heuristicParams,
    requireThresholds,
    missingAnchorBlockMessage,
  });

  const bridgeBlocks = await historyService.findBridgeBlocks(trustedHeight, height);
  const expectedBridgeCount = Number(height - trustedHeight - 1n);
  if (bridgeBlocks.length !== expectedBridgeCount) {
    throw new GrpcInternalException(
      `Incomplete stability bridge segment between trusted height ${trustedHeight.toString()} and anchor height ${height.toString()}`,
    );
  }

  for (let index = 0; index < bridgeBlocks.length; index++) {
    const expectedHeight = Number(trustedHeight) + index + 1;
    if (bridgeBlocks[index].height !== expectedHeight) {
      throw new GrpcInternalException(
        `Non-contiguous stability bridge segment at height ${bridgeBlocks[index].height}; expected ${expectedHeight}`,
      );
    }
  }
  assertBlocksRemainInEpoch(
    bridgeBlocks,
    evidence.anchorEpoch,
    `Stake-weighted stability bridge segment for anchor height ${height.toString()}`,
  );
  assertBlocksRemainWithinEpochSlotBounds(
    bridgeBlocks,
    evidence.epochVerificationContext,
    `Stake-weighted stability bridge segment for anchor height ${height.toString()}`,
  );

  return {
    ...evidence,
    trustedHeight: trustedHeight as CardanoHeight,
    bridgeBlocks,
  };
}
