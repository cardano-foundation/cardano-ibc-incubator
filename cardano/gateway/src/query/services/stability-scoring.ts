import { Logger } from '@nestjs/common';
import { HeuristicParams } from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { HistoryBlock, HistoryStakeDistributionEntry } from './history.service';

export type StabilityMetrics = {
  uniquePoolsCount: number;
  uniqueStakeBps: number;
  securityScoreBps: number;
  poolStakeBpsByPool: Record<string, bigint>;
};

export function getStabilityHeuristicParams(env: NodeJS.ProcessEnv = process.env): HeuristicParams {
  const getBigInt = (name: string, fallback: bigint) => {
    const value = env[name];
    return value ? BigInt(value) : fallback;
  };

  return {
    min_depth: getBigInt('CARDANO_STABILITY_MIN_DEPTH', 24n),
    min_unique_pools: getBigInt('CARDANO_STABILITY_MIN_UNIQUE_POOLS', 3n),
    min_unique_stake_bps: getBigInt('CARDANO_STABILITY_MIN_UNIQUE_STAKE_BPS', 6000n),
    target_depth: getBigInt('CARDANO_STABILITY_TARGET_DEPTH', 24n),
    target_unique_pools: getBigInt('CARDANO_STABILITY_TARGET_UNIQUE_POOLS', 5n),
    target_unique_stake_bps: getBigInt('CARDANO_STABILITY_TARGET_UNIQUE_STAKE_BPS', 8000n),
    depth_weight_bps: getBigInt('CARDANO_STABILITY_DEPTH_WEIGHT_BPS', 2000n),
    pools_weight_bps: getBigInt('CARDANO_STABILITY_POOLS_WEIGHT_BPS', 2000n),
    stake_weight_bps: getBigInt('CARDANO_STABILITY_STAKE_WEIGHT_BPS', 6000n),
  };
}

export function scoreDescendantBlocks(
  descendants: HistoryBlock[],
  epochStakeDistribution: HistoryStakeDistributionEntry[],
  logger?: Logger,
): HistoryBlock[] {
  if (epochStakeDistribution.length === 0 && descendants.some((block) => block.slotLeader)) {
    const distinctPools = [...new Set(descendants.map((block) => block.slotLeader).filter(Boolean))];
    logger?.warn(
      `No epoch stake distribution available for stability scoring; falling back to equal weights across ${distinctPools.length} observed pools`,
    );
  }

  return descendants;
}

export function computeStabilityMetrics(
  descendants: HistoryBlock[],
  epochStakeDistribution: HistoryStakeDistributionEntry[],
  heuristicParams: HeuristicParams,
): StabilityMetrics {
  const uniquePools = new Set<string>();
  const stakeByPool = new Map(epochStakeDistribution.map((entry) => [entry.poolId, entry.stake]));
  const totalStake = epochStakeDistribution.reduce((sum, entry) => sum + entry.stake, 0n);
  const distinctPools = [...new Set(descendants.map((block) => block.slotLeader).filter(Boolean))];
  const fallbackStakeBpsPerPool =
    epochStakeDistribution.length === 0 && distinctPools.length > 0 ? 10_000n / BigInt(distinctPools.length) : 0n;

  const poolStakeBpsByPool: Record<string, bigint> = {};
  let uniqueStakeBps = 0n;

  for (const descendant of descendants) {
    if (!descendant.slotLeader || uniquePools.has(descendant.slotLeader)) {
      continue;
    }

    uniquePools.add(descendant.slotLeader);
    let stakeBps = 0n;
    if (totalStake > 0n) {
      stakeBps = ((stakeByPool.get(descendant.slotLeader) || 0n) * 10_000n) / totalStake;
    } else {
      stakeBps = fallbackStakeBpsPerPool;
    }

    poolStakeBpsByPool[descendant.slotLeader] = stakeBps;
    uniqueStakeBps += stakeBps;
  }

  if (uniqueStakeBps > 10_000n) {
    uniqueStakeBps = 10_000n;
  }

  const depthScore = minBps(BigInt(descendants.length), heuristicParams.target_depth);
  const poolsScore = minBps(BigInt(uniquePools.size), heuristicParams.target_unique_pools);
  const stakeScore = minBps(uniqueStakeBps, heuristicParams.target_unique_stake_bps);
  const rawScore =
    (heuristicParams.depth_weight_bps * depthScore +
      heuristicParams.pools_weight_bps * poolsScore +
      heuristicParams.stake_weight_bps * stakeScore) /
    10_000n;

  return {
    uniquePoolsCount: uniquePools.size,
    uniqueStakeBps: Number(uniqueStakeBps),
    securityScoreBps: Number(rawScore > 10_000n ? 10_000n : rawScore),
    poolStakeBpsByPool,
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
  if (BigInt(descendantDepth) < heuristicParams.min_depth) {
    return `Not found: stability thresholds not met at height ${height} (depth ${descendantDepth} < ${heuristicParams.min_depth})`;
  }
  if (BigInt(metrics.uniquePoolsCount) < heuristicParams.min_unique_pools) {
    return `Not found: stability thresholds not met at height ${height} (unique pools ${metrics.uniquePoolsCount} < ${heuristicParams.min_unique_pools})`;
  }
  if (BigInt(metrics.uniqueStakeBps) < heuristicParams.min_unique_stake_bps) {
    return `Not found: stability thresholds not met at height ${height} (unique stake ${metrics.uniqueStakeBps} < ${heuristicParams.min_unique_stake_bps})`;
  }

  return null;
}

function minBps(value: bigint, target: bigint): bigint {
  if (target === 0n || value >= target) {
    return 10_000n;
  }
  return (value * 10_000n) / target;
}
