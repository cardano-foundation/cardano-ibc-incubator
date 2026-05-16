import { Logger } from '@nestjs/common';
import { HeuristicParams } from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import {
  GATEWAY_GRPC_ERROR_CODE,
  GrpcFailedPreconditionException,
  GrpcInternalException,
  GrpcInvalidArgumentException,
  GrpcNotFoundException,
  gatewayGrpcError,
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
  computePoolRegistrationCutoffSlot,
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

export type StakeWeightedStabilityHeaderEvidence = {
  anchorHeight: CardanoHeight;
  anchorEpoch: EpochNumber;
  anchorBlock: HistoryBlock;
  descendantBlocks: HistoryBlock[];
  epochStakeDistribution: HistoryStakeDistributionEntry[];
  epochVerificationContext: HistoryEpochVerificationContext;
  trustedHeight: CardanoHeight;
  trustedEpoch: EpochNumber;
  bridgeBlocks: HistoryBlock[];
};

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
    throw new GrpcInternalException(`Epoch verification context unavailable for ${context} in epoch ${epoch}`);
  }
  if (!epochVerificationContext.epochNonce) {
    throw new GrpcInternalException(`Epoch nonce unavailable for ${context} in epoch ${epoch}`);
  }
  if (epochVerificationContext.slotsPerKesPeriod <= 0) {
    throw new GrpcInternalException(`Slots-per-KES-period unavailable for ${context} in epoch ${epoch}`);
  }
  if (epochVerificationContext.currentEpochEndSlotExclusive <= epochVerificationContext.currentEpochStartSlot) {
    throw new GrpcInternalException(`Invalid epoch slot bounds for ${context} in epoch ${epoch}`);
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
  requireFullEpochVerificationContext?: boolean;
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

function heightNotFound(height: bigint, message?: string): GrpcNotFoundException {
  return new GrpcNotFoundException(
    gatewayGrpcError(GATEWAY_GRPC_ERROR_CODE.HEIGHT_NOT_FOUND, message ?? `Height ${height.toString()} not found`, {
      height: height.toString(),
    }),
  );
}

function heightNotAccepted(height: bigint, message: string): GrpcFailedPreconditionException {
  return new GrpcFailedPreconditionException(
    gatewayGrpcError(GATEWAY_GRPC_ERROR_CODE.HEIGHT_NOT_ACCEPTED, message, {
      height: height.toString(),
    }),
  );
}

function historyNotReady(message: string): GrpcFailedPreconditionException {
  return new GrpcFailedPreconditionException(gatewayGrpcError(GATEWAY_GRPC_ERROR_CODE.HISTORY_NOT_READY, message));
}

function invalidTrustedHeight(trustedHeight: bigint, height: bigint, message: string): GrpcInvalidArgumentException {
  return new GrpcInvalidArgumentException(
    gatewayGrpcError(GATEWAY_GRPC_ERROR_CODE.INVALID_TRUSTED_HEIGHT, message, {
      trustedHeight: trustedHeight.toString(),
      height: height.toString(),
    }),
  );
}

async function hydrateDescendantProducerRegistrationSlots(
  historyService: HistoryService,
  stakeDistribution: HistoryStakeDistributionEntry[],
  descendantBlocks: HistoryBlock[],
  anchorBlock: Pick<HistoryBlock, 'slotNo' | 'timestampUnixNs'>,
): Promise<HistoryStakeDistributionEntry[]> {
  const entriesByPoolId = new Map(stakeDistribution.map((entry) => [entry.poolId, entry]));
  const missingProducerPoolIds = Array.from(
    new Set(
      descendantBlocks
        .map((block) => block.slotLeader)
        .filter((poolId) => {
          if (!poolId) {
            return false;
          }
          const entry = entriesByPoolId.get(poolId);
          return Boolean(entry && (!entry.firstRegistrationSlot || entry.firstRegistrationSlot <= 0n));
        }),
    ),
  );

  if (missingProducerPoolIds.length === 0) {
    return stakeDistribution;
  }

  const firstRegistrationSlots = await historyService.findFirstPoolRegistrationSlots(missingProducerPoolIds, anchorBlock);
  if (firstRegistrationSlots.size === 0) {
    return stakeDistribution;
  }

  return stakeDistribution.map((entry) => {
    const firstRegistrationSlot = firstRegistrationSlots.get(entry.poolId);
    return firstRegistrationSlot === undefined ? entry : { ...entry, firstRegistrationSlot };
  });
}

export async function loadStakeWeightedStabilityEvidenceByHeight({
  historyService,
  height,
  logger,
  heuristicParams = getStabilityHeuristicParams(),
  requireThresholds = true,
  requireFullEpochVerificationContext = true,
  missingAnchorBlockMessage,
}: LoadStakeWeightedStabilityEvidenceByHeightParams): Promise<StakeWeightedStabilityEvidence> {
  const anchorBlock = await historyService.findBlockByHeight(height);
  if (!anchorBlock) {
    throw heightNotFound(height, missingAnchorBlockMessage ?? `Height ${height.toString()} not found`);
  }

  const descendantBlocks = await historyService.findDescendantBlocks(
    BigInt(anchorBlock.height),
    getStabilityLookaheadDepth(heuristicParams),
  );
  const anchorEpochContext = await historyService.findEpochContextAtBlock(anchorBlock);
  if (!anchorEpochContext) {
    throw new GrpcInternalException(
      `Epoch context unavailable for anchor height ${anchorBlock.height} in epoch ${anchorBlock.epochNo}`,
    );
  }
  const { stakeDistribution: epochStakeDistribution, verificationContext: epochVerificationContext } =
    anchorEpochContext;
  assertEpochStakeDistributionAvailable(
    epochStakeDistribution,
    `anchor height ${anchorBlock.height} in epoch ${anchorBlock.epochNo}`,
  );
  assertStakeVerificationContextAvailable(
    epochStakeDistribution,
    anchorBlock.epochNo,
    `anchor height ${anchorBlock.height}`,
  );
  if (!epochVerificationContext) {
    throw new GrpcInternalException(
      `Epoch verification context unavailable for anchor height ${anchorBlock.height} in epoch ${anchorBlock.epochNo}`,
    );
  }
  if (requireFullEpochVerificationContext) {
    assertEpochVerificationContextAvailable(
      epochVerificationContext,
      anchorBlock.epochNo,
      `anchor height ${anchorBlock.height}`,
    );
  }
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
  const hydratedEpochStakeDistribution = await hydrateDescendantProducerRegistrationSlots(
    historyService,
    epochStakeDistribution,
    eligibleDescendantBlocks,
    anchorBlock,
  );

  let acceptedDescendantBlocks = eligibleDescendantBlocks;
  const poolRegistrationCutoffSlot = computePoolRegistrationCutoffSlot(anchorBlock);
  let metrics = computeStabilityMetrics(eligibleDescendantBlocks, hydratedEpochStakeDistribution, heuristicParams, {
    poolRegistrationCutoffSlot,
  });

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
        hydratedEpochStakeDistribution,
        heuristicParams,
        { poolRegistrationCutoffSlot },
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
    epochStakeDistribution: hydratedEpochStakeDistribution,
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
  const hostStateTxEvidence =
    (await historyService.findTransactionEvidenceByHash(txHash)) ??
    (await (async () => {
      const tx = await historyService.findTxByHash(txHash);
      if (!tx) {
        return null;
      }
      return {
        txHash: tx.hash,
        blockNo: tx.height,
        txIndex: 0,
        txCborHex: '',
        txBodyCborHex: '',
        redeemers: [],
      };
    })());
  if (!hostStateTxEvidence) {
    throw new GrpcInternalException(missingTxEvidenceMessage ?? `Historical tx evidence unavailable for tx ${txHash}`);
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
  logger: _logger,
  heuristicParams = getStabilityHeuristicParams(),
  requireThresholds = true,
  missingAnchorBlockMessage,
}: LoadStakeWeightedStabilityHeaderEvidenceParams): Promise<StakeWeightedStabilityHeaderEvidence> {
  if (trustedHeight <= 0n) {
    throw invalidTrustedHeight(
      trustedHeight,
      height,
      `Invalid trusted height ${trustedHeight.toString()} for stability header`,
    );
  }
  if (trustedHeight >= height) {
    throw invalidTrustedHeight(
      trustedHeight,
      height,
      `Invalid stability header request: trusted height ${trustedHeight.toString()} must be less than anchor height ${height.toString()}`,
    );
  }

  const trustedBlock = await historyService.findBlockByHeight(trustedHeight);
  if (!trustedBlock) {
    throw invalidTrustedHeight(
      trustedHeight,
      height,
      `Trusted height ${trustedHeight.toString()} not found for stability header`,
    );
  }

  const anchorBlock = await historyService.findBlockByHeight(height);
  if (!anchorBlock) {
    throw heightNotFound(height, missingAnchorBlockMessage ?? `Height ${height.toString()} not found`);
  }

  if (anchorBlock.epochNo < trustedBlock.epochNo) {
    throw invalidTrustedHeight(
      trustedHeight,
      height,
      `Invalid stability header request: trusted epoch ${trustedBlock.epochNo} must not be greater than anchor epoch ${anchorBlock.epochNo}`,
    );
  }
  if (anchorBlock.epochNo > trustedBlock.epochNo + 1) {
    throw invalidTrustedHeight(
      trustedHeight,
      height,
      `Stability rollover currently supports only adjacent epoch transitions; trusted epoch ${trustedBlock.epochNo}, anchor epoch ${anchorBlock.epochNo}`,
    );
  }

  const anchorEpochContext = await historyService.findEpochContextAtBlock(anchorBlock);
  if (!anchorEpochContext) {
    throw historyNotReady(
      `Epoch context unavailable for anchor height ${anchorBlock.height} in epoch ${anchorBlock.epochNo}`,
    );
  }
  const epochVerificationContext = anchorEpochContext.verificationContext;
  assertBlocksRemainWithinEpochSlotBounds(
    [anchorBlock],
    epochVerificationContext,
    `Stake-weighted stability anchor block for height ${anchorBlock.height}`,
  );

  const trustedEpochContext =
    trustedBlock.epochNo === anchorBlock.epochNo
      ? anchorEpochContext
      : await historyService.findEpochContextAtBlock(trustedBlock);
  if (!trustedEpochContext) {
    throw historyNotReady(
      `Epoch context unavailable for trusted height ${trustedBlock.height} in epoch ${trustedBlock.epochNo}`,
    );
  }

  const bridgeBlocks = await historyService.findBridgeBlocks(trustedHeight, height);
  const expectedBridgeCount = Number(height - trustedHeight - 1n);
  if (bridgeBlocks.length !== expectedBridgeCount) {
    throw historyNotReady(
      `Incomplete stability bridge segment between trusted height ${trustedHeight.toString()} and anchor height ${height.toString()}`,
    );
  }

  for (let index = 0; index < bridgeBlocks.length; index++) {
    const expectedHeight = Number(trustedHeight) + index + 1;
    if (bridgeBlocks[index].height !== expectedHeight) {
      throw historyNotReady(
        `Non-contiguous stability bridge segment at height ${bridgeBlocks[index].height}; expected ${expectedHeight}`,
      );
    }
  }
  for (const block of bridgeBlocks) {
    if (block.epochNo === trustedBlock.epochNo) {
      assertBlocksRemainWithinEpochSlotBounds(
        [block],
        trustedEpochContext.verificationContext,
        `Stake-weighted stability bridge segment for anchor height ${height.toString()}`,
      );
      continue;
    }

    if (block.epochNo === anchorBlock.epochNo) {
      assertBlocksRemainWithinEpochSlotBounds(
        [block],
        anchorEpochContext.verificationContext,
        `Stake-weighted stability bridge segment for anchor height ${height.toString()}`,
      );
      continue;
    }

    throw historyNotReady(
      `Stake-weighted stability bridge segment for anchor height ${height.toString()} crosses unsupported epoch ${block.epochNo}`,
    );
  }

  const descendantBlocks = await historyService.findDescendantBlocks(
    BigInt(anchorBlock.height),
    getStabilityLookaheadDepth(heuristicParams),
  );
  const firstInvalidDescendantIndex = findFirstEpochBoundaryViolation(
    descendantBlocks,
    anchorBlock.epochNo,
    epochVerificationContext,
  );
  const eligibleDescendantBlocks =
    firstInvalidDescendantIndex >= 0 ? descendantBlocks.slice(0, firstInvalidDescendantIndex) : descendantBlocks;
  const hydratedAnchorStakeDistribution = await hydrateDescendantProducerRegistrationSlots(
    historyService,
    anchorEpochContext.stakeDistribution,
    eligibleDescendantBlocks,
    anchorBlock,
  );

  const acceptedDescendantBlocks = eligibleDescendantBlocks;
  const poolRegistrationCutoffSlot = computePoolRegistrationCutoffSlot(anchorBlock);
  const metrics = computeStabilityMetrics(
    eligibleDescendantBlocks,
    hydratedAnchorStakeDistribution,
    heuristicParams,
    { poolRegistrationCutoffSlot },
  );

  if (requireThresholds) {
    const thresholdFailure = getStabilityThresholdFailure(
      metrics,
      heuristicParams,
      anchorBlock.height.toString(),
      acceptedDescendantBlocks.length,
    );
    if (thresholdFailure) {
      throw heightNotAccepted(BigInt(anchorBlock.height), thresholdFailure);
    }
  }

  return {
    anchorHeight: BigInt(anchorBlock.height) as CardanoHeight,
    anchorEpoch: anchorBlock.epochNo as EpochNumber,
    anchorBlock,
    descendantBlocks: acceptedDescendantBlocks,
    epochStakeDistribution: hydratedAnchorStakeDistribution,
    epochVerificationContext: anchorEpochContext.verificationContext,
    trustedHeight: trustedHeight as CardanoHeight,
    trustedEpoch: trustedBlock.epochNo as EpochNumber,
    bridgeBlocks,
  };
}
