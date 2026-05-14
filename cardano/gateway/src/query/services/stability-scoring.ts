import { Logger } from '@nestjs/common';
import { HeuristicParams } from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import {
  GATEWAY_GRPC_ERROR_CODE,
  GrpcFailedPreconditionException,
  gatewayGrpcError,
} from '~@/exception/grpc_exceptions';
import { HistoryBlock, HistoryStakeDistributionEntry } from './history.service';

export type StabilityMetrics = {
  qualifiedUniquePoolsCount: number;
  qualifiedUniqueStakeBps: number;
  securityScoreBps: number;
};

type StabilityScoringOptions = {
  poolRegistrationCutoffSlot?: bigint;
};

const STABILITY_POOL_REGISTRATION_CUTOFF_UNIX_NS = 1_767_225_600_000_000_000n; // 2026-01-01T00:00:00Z
const DEFAULT_CARDANO_SLOT_LENGTH_NS = 1_000_000_000n;

export function assertEpochStakeDistributionAvailable(
  epochStakeDistribution: HistoryStakeDistributionEntry[],
  context: string,
): void {
  if (epochStakeDistribution.length === 0) {
    throw new GrpcFailedPreconditionException(
      gatewayGrpcError(
        GATEWAY_GRPC_ERROR_CODE.HISTORY_NOT_READY,
        `Epoch stake distribution unavailable for ${context}`,
      ),
    );
  }

  const totalActiveStake = epochStakeDistribution.reduce((sum, entry) => sum + entry.stake, 0n);
  if (totalActiveStake <= 0n) {
    throw new GrpcFailedPreconditionException(
      gatewayGrpcError(
        GATEWAY_GRPC_ERROR_CODE.HISTORY_NOT_READY,
        `Epoch stake distribution has zero total stake for ${context}`,
      ),
    );
  }
}

export function getStabilityHeuristicParams(env: NodeJS.ProcessEnv = process.env): HeuristicParams {
  const getBigInt = (name: string, fallback: bigint) => {
    const value = env[name];
    return value ? BigInt(value) : fallback;
  };

  return {
    threshold_depth: getBigInt('CARDANO_STABILITY_THRESHOLD_DEPTH', 24n),
    threshold_unique_pools: getBigInt('CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS', 5n),
    threshold_unique_stake_bps: getBigInt('CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS', 8000n),
    depth_weight_bps: getBigInt('CARDANO_STABILITY_DEPTH_WEIGHT_BPS', 2000n),
    pools_weight_bps: getBigInt('CARDANO_STABILITY_POOLS_WEIGHT_BPS', 2000n),
    stake_weight_bps: getBigInt('CARDANO_STABILITY_STAKE_WEIGHT_BPS', 6000n),
  };
}

export function computePoolRegistrationCutoffSlot(
  anchorBlock: Pick<HistoryBlock, 'slotNo' | 'timestampUnixNs'>,
  slotLengthNs: bigint = DEFAULT_CARDANO_SLOT_LENGTH_NS,
): bigint {
  if (slotLengthNs <= 0n) {
    throw new Error('Cardano slot length must be greater than zero');
  }
  const systemStartUnixNs = anchorBlock.timestampUnixNs - anchorBlock.slotNo * slotLengthNs;
  if (STABILITY_POOL_REGISTRATION_CUTOFF_UNIX_NS <= systemStartUnixNs) {
    return 0n;
  }
  const delta = STABILITY_POOL_REGISTRATION_CUTOFF_UNIX_NS - systemStartUnixNs;
  return (delta + slotLengthNs - 1n) / slotLengthNs;
}

export function getStabilityLookaheadDepth(
  heuristicParams: HeuristicParams,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const configured = env.CARDANO_STABILITY_MAX_LOOKAHEAD_DEPTH;
  const fallback = heuristicParams.threshold_depth > 0n ? heuristicParams.threshold_depth * 4n : 96n;
  const lookahead = configured ? BigInt(configured) : fallback;
  const minimum = heuristicParams.threshold_depth > 0n ? heuristicParams.threshold_depth : 1n;
  const normalized = lookahead >= minimum ? lookahead : minimum;

  if (normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`CARDANO_STABILITY_MAX_LOOKAHEAD_DEPTH is too large: ${normalized.toString()}`);
  }

  return Number(normalized);
}

export function scoreDescendantBlocks(
  descendants: HistoryBlock[],
  epochStakeDistribution: HistoryStakeDistributionEntry[],
  logger?: Logger,
): HistoryBlock[] {
  void logger;
  assertEpochStakeDistributionAvailable(epochStakeDistribution, 'stake-weighted stability scoring');

  return descendants;
}

export function computeStabilityMetrics(
  descendants: HistoryBlock[],
  epochStakeDistribution: HistoryStakeDistributionEntry[],
  heuristicParams: HeuristicParams,
  options: StabilityScoringOptions = {},
): StabilityMetrics {
  assertEpochStakeDistributionAvailable(epochStakeDistribution, 'stake-weighted stability scoring');

  const qualifiedUniquePools = new Set<string>();
  const seenSlotLeaders = new Set<string>();
  const stakeEntryByPool = new Map(epochStakeDistribution.map((entry) => [entry.poolId, entry]));
  const totalActiveStake = epochStakeDistribution.reduce((sum, entry) => sum + entry.stake, 0n);

  let qualifiedUniqueStake = 0n;

  for (const descendant of descendants) {
    if (!descendant.slotLeader || seenSlotLeaders.has(descendant.slotLeader)) {
      continue;
    }

    seenSlotLeaders.add(descendant.slotLeader);
    const entry = stakeEntryByPool.get(descendant.slotLeader);
    if (!poolRegisteredBeforeCutoff(entry, options.poolRegistrationCutoffSlot)) {
      continue;
    }

    qualifiedUniquePools.add(descendant.slotLeader);
    qualifiedUniqueStake += entry.stake;
  }

  const qualifiedUniqueStakeBps =
    qualifiedUniqueStake >= totalActiveStake ? 10_000n : (qualifiedUniqueStake * 10_000n) / totalActiveStake;

  const depthScore = minBps(BigInt(descendants.length), heuristicParams.threshold_depth);
  const poolsScore = minBps(BigInt(qualifiedUniquePools.size), heuristicParams.threshold_unique_pools);
  const qualifiedStakeScore = minBps(qualifiedUniqueStakeBps, heuristicParams.threshold_unique_stake_bps);
  const rawScore =
    (heuristicParams.depth_weight_bps * depthScore +
      heuristicParams.pools_weight_bps * poolsScore +
      heuristicParams.stake_weight_bps * qualifiedStakeScore) /
    10_000n;

  return {
    qualifiedUniquePoolsCount: qualifiedUniquePools.size,
    qualifiedUniqueStakeBps: Number(qualifiedUniqueStakeBps),
    securityScoreBps: Number(rawScore > 10_000n ? 10_000n : rawScore),
  };
}

export function assertStabilityThresholds(
  metrics: StabilityMetrics,
  heuristicParams: HeuristicParams,
  height: string,
  descendantDepth: number,
): void {
  const failure = getStabilityThresholdFailure(metrics, heuristicParams, height, descendantDepth);
  if (failure) {
    throw new GrpcFailedPreconditionException(
      gatewayGrpcError(GATEWAY_GRPC_ERROR_CODE.HEIGHT_NOT_ACCEPTED, failure, {
        height,
        descendantDepth,
      }),
    );
  }
}

export function getStabilityThresholdFailure(
  metrics: StabilityMetrics,
  heuristicParams: HeuristicParams,
  height: string,
  descendantDepth: number,
): string | null {
  if (BigInt(descendantDepth) < heuristicParams.threshold_depth) {
    return `Not found: stability thresholds not met at height ${height} (depth ${descendantDepth} < ${heuristicParams.threshold_depth})`;
  }
  if (BigInt(metrics.qualifiedUniquePoolsCount) < heuristicParams.threshold_unique_pools) {
    return `Not found: stability thresholds not met at height ${height} (qualified unique pools ${metrics.qualifiedUniquePoolsCount} < ${heuristicParams.threshold_unique_pools})`;
  }
  if (BigInt(metrics.qualifiedUniqueStakeBps) < heuristicParams.threshold_unique_stake_bps) {
    return `Not found: stability thresholds not met at height ${height} (qualified unique stake ${metrics.qualifiedUniqueStakeBps} < ${heuristicParams.threshold_unique_stake_bps})`;
  }

  return null;
}

function minBps(value: bigint, target: bigint): bigint {
  if (target === 0n || value >= target) {
    return 10_000n;
  }
  return (value * 10_000n) / target;
}

function poolRegisteredBeforeCutoff(
  entry: HistoryStakeDistributionEntry | undefined,
  poolRegistrationCutoffSlot?: bigint,
): entry is HistoryStakeDistributionEntry {
  if (poolRegistrationCutoffSlot === undefined) {
    throw new Error('Pool registration cutoff slot is required for stake-weighted stability scoring');
  }
  if (!entry) {
    throw new Error('Descendant slot leader missing from epoch stake distribution');
  }
  if (!entry.firstRegistrationSlot || entry.firstRegistrationSlot <= 0n) {
    throw new Error(`First registration slot missing for pool ${entry.poolId}`);
  }
  return entry.firstRegistrationSlot < poolRegistrationCutoffSlot;
}
