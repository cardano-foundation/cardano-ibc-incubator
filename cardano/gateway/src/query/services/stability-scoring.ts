import { Logger } from '@nestjs/common';
import { HeuristicParams } from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { HistoryBlock, HistoryStakeDistributionEntry } from './history.service';

export type StabilityMetrics = {
  uniquePoolsCount: number;
  uniqueStakeBps: number;
  securityScoreBps: number;
};

export function assertEpochStakeDistributionAvailable(
  epochStakeDistribution: HistoryStakeDistributionEntry[],
  context: string,
): void {
  if (epochStakeDistribution.length === 0) {
    throw new GrpcNotFoundException(
      `Not found: epoch stake distribution unavailable for ${context}`,
    );
  }

  const totalStake = epochStakeDistribution.reduce((sum, entry) => sum + entry.stake, 0n);
  if (totalStake <= 0n) {
    throw new GrpcNotFoundException(
      `Not found: epoch stake distribution has zero total stake for ${context}`,
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
): StabilityMetrics {
  assertEpochStakeDistributionAvailable(epochStakeDistribution, 'stake-weighted stability scoring');

  const uniquePools = new Set<string>();
  const stakeByPool = new Map(epochStakeDistribution.map((entry) => [entry.poolId, entry.stake]));
  const totalStake = epochStakeDistribution.reduce((sum, entry) => sum + entry.stake, 0n);

  let uniqueStake = 0n;

  for (const descendant of descendants) {
    if (!descendant.slotLeader || uniquePools.has(descendant.slotLeader)) {
      continue;
    }

    uniquePools.add(descendant.slotLeader);
    const stake = stakeByPool.get(descendant.slotLeader) || 0n;
    uniqueStake += stake;
  }

  const uniqueStakeBps = uniqueStake >= totalStake ? 10_000n : (uniqueStake * 10_000n) / totalStake;

  const depthScore = minBps(BigInt(descendants.length), heuristicParams.threshold_depth);
  const poolsScore = minBps(BigInt(uniquePools.size), heuristicParams.threshold_unique_pools);
  const stakeScore = minBps(uniqueStakeBps, heuristicParams.threshold_unique_stake_bps);
  const rawScore =
    (heuristicParams.depth_weight_bps * depthScore +
      heuristicParams.pools_weight_bps * poolsScore +
      heuristicParams.stake_weight_bps * stakeScore) /
    10_000n;

  return {
    uniquePoolsCount: uniquePools.size,
    uniqueStakeBps: Number(uniqueStakeBps),
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
    throw new GrpcNotFoundException(failure);
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
  if (BigInt(metrics.uniquePoolsCount) < heuristicParams.threshold_unique_pools) {
    return `Not found: stability thresholds not met at height ${height} (unique pools ${metrics.uniquePoolsCount} < ${heuristicParams.threshold_unique_pools})`;
  }
  if (BigInt(metrics.uniqueStakeBps) < heuristicParams.threshold_unique_stake_bps) {
    return `Not found: stability thresholds not met at height ${height} (unique stake ${metrics.uniqueStakeBps} < ${heuristicParams.threshold_unique_stake_bps})`;
  }

  return null;
}

function minBps(value: bigint, target: bigint): bigint {
  if (target === 0n || value >= target) {
    return 10_000n;
  }
  return (value * 10_000n) / target;
}
