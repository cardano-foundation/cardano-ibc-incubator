import { Logger } from '@nestjs/common';
import { HeuristicParams } from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import {
  GrpcInternalException,
  GrpcNotFoundException,
} from '~@/exception/grpc_exceptions';
import {
  HistoryBlock,
  HistoryService,
  HistoryStakeDistributionEntry,
  HistoryTxEvidence,
} from './history.service';
import {
  assertEpochStakeDistributionAvailable,
  assertStabilityThresholds,
  computeStabilityMetrics,
  getStabilityHeuristicParams,
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
    Number(heuristicParams.threshold_depth || 24n),
  );
  const epochStakeDistribution = await historyService.findEpochStakeDistribution(anchorBlock.epochNo);
  assertEpochStakeDistributionAvailable(
    epochStakeDistribution,
    `anchor height ${anchorBlock.height} in epoch ${anchorBlock.epochNo}`,
  );
  const scoredDescendantBlocks = scoreDescendantBlocks(descendantBlocks, epochStakeDistribution, logger);
  assertBlocksRemainInEpoch(
    scoredDescendantBlocks,
    anchorBlock.epochNo,
    `Stake-weighted stability descendant window for anchor height ${anchorBlock.height}`,
  );
  const metrics = computeStabilityMetrics(scoredDescendantBlocks, epochStakeDistribution, heuristicParams);

  if (requireThresholds) {
    assertStabilityThresholds(metrics, heuristicParams, anchorBlock.height.toString(), scoredDescendantBlocks.length);
  }

  return {
    anchorHeight: BigInt(anchorBlock.height) as CardanoHeight,
    anchorEpoch: anchorBlock.epochNo as EpochNumber,
    anchorBlock,
    descendantBlocks: scoredDescendantBlocks,
    epochStakeDistribution,
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

  return {
    ...evidence,
    trustedHeight: trustedHeight as CardanoHeight,
    bridgeBlocks,
  };
}
