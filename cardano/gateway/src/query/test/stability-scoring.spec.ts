import {
  assertStabilityThresholds,
  computeStabilityMetrics,
  getStabilityHeuristicParams,
} from '../services/stability-scoring';
import { HistoryBlock, HistoryStakeDistributionEntry } from '../services/history.service';

describe('stability-scoring', () => {
  const makeBlock = (height: number, prevHash: string, slotLeader: string): HistoryBlock => ({
    height,
    hash: `hash-${height}`,
    prevHash,
    slotNo: BigInt(height * 10),
    epochNo: 1,
    timestampUnixNs: BigInt(height) * 1_000_000_000n,
    slotLeader,
  });

  it('computes unique pool stake and score from epoch stake distribution', () => {
    const heuristicParams = getStabilityHeuristicParams({
      CARDANO_STABILITY_THRESHOLD_DEPTH: '3',
      CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS: '3',
      CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS: '6000',
      CARDANO_STABILITY_DEPTH_WEIGHT_BPS: '2000',
      CARDANO_STABILITY_POOLS_WEIGHT_BPS: '2000',
      CARDANO_STABILITY_STAKE_WEIGHT_BPS: '6000',
    } as NodeJS.ProcessEnv);

    const descendants = [
      makeBlock(101, 'anchor', 'pool-a'),
      makeBlock(102, 'hash-101', 'pool-b'),
      makeBlock(103, 'hash-102', 'pool-c'),
    ];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      { poolId: 'pool-a', stake: 500n },
      { poolId: 'pool-b', stake: 300n },
      { poolId: 'pool-c', stake: 200n },
    ];

    const metrics = computeStabilityMetrics(descendants, epochStakeDistribution, heuristicParams);

    expect(metrics.uniquePoolsCount).toBe(3);
    expect(metrics.uniqueStakeBps).toBe(10000);
    expect(metrics.securityScoreBps).toBe(10000);
    expect(metrics.poolStakeBpsByPool['pool-a']).toBe(5000n);
    expect(metrics.poolStakeBpsByPool['pool-b']).toBe(3000n);
    expect(metrics.poolStakeBpsByPool['pool-c']).toBe(2000n);
    expect(() =>
      assertStabilityThresholds(metrics, heuristicParams, '100', descendants.length),
    ).not.toThrow();
  });

  it('fails threshold checks when depth and unique stake are too low', () => {
    const heuristicParams = getStabilityHeuristicParams({
      CARDANO_STABILITY_THRESHOLD_DEPTH: '4',
      CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS: '2',
      CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS: '7000',
    } as NodeJS.ProcessEnv);

    const descendants = [
      makeBlock(201, 'anchor', 'pool-a'),
      makeBlock(202, 'hash-201', 'pool-a'),
      makeBlock(203, 'hash-202', 'pool-b'),
    ];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      { poolId: 'pool-a', stake: 400n },
      { poolId: 'pool-b', stake: 200n },
      { poolId: 'pool-c', stake: 400n },
    ];

    const metrics = computeStabilityMetrics(descendants, epochStakeDistribution, heuristicParams);

    expect(metrics.uniquePoolsCount).toBe(2);
    expect(metrics.uniqueStakeBps).toBe(6000);
    expect(() =>
      assertStabilityThresholds(metrics, heuristicParams, '200', descendants.length),
    ).toThrow('stability thresholds not met');
  });
});
