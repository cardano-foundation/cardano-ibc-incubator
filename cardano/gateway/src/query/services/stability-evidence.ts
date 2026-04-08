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
  const scoredDescendantBlocks = scoreDescendantBlocks(descendantBlocks, epochStakeDistribution, logger);
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
