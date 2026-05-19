import {
  assertStabilityThresholds,
  computePoolRegistrationCutoffSlot,
  computeStabilityMetrics,
  getStabilityPolicy,
  StabilityPolicy,
} from '../services/stability-scoring';
import { HistoryBlock, HistoryStakeDistributionEntry } from '../services/history.service';

describe('stability-scoring', () => {
  const poolRegistrationCutoffSlot = 10_000n;
  const policy = (overrides: Partial<StabilityPolicy> = {}): StabilityPolicy => ({
    ...getStabilityPolicy(),
    ...overrides,
  });
  const makeBlock = (height: number, prevHash: string, slotLeader: string): HistoryBlock => ({
    height,
    hash: `hash-${height}`,
    prevHash,
    slotNo: BigInt(height * 10),
    epochNo: 1,
    timestampUnixNs: BigInt(height) * 1_000_000_000n,
    slotLeader,
  });

  it('computes qualified pool stake and score from epoch stake distribution', () => {
    const stabilityPolicy = policy({
      threshold_depth: 3n,
      threshold_unique_pools: 3n,
      threshold_unique_stake_bps: 6000n,
    });

    const descendants = [
      makeBlock(101, 'anchor', 'pool-a'),
      makeBlock(102, 'hash-101', 'pool-b'),
      makeBlock(103, 'hash-102', 'pool-c'),
    ];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      {
        poolId: 'pool-a',
        stake: 500n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 300n,
        vrfKeyHash: 'bb'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-c',
        stake: 200n,
        vrfKeyHash: 'cc'.repeat(32),
        firstRegistrationSlot: 1n,
      },
    ];

    const metrics = computeStabilityMetrics(descendants, epochStakeDistribution, stabilityPolicy, {
      poolRegistrationCutoffSlot,
    });

    expect(metrics.qualifiedUniquePoolsCount).toBe(3);
    expect(metrics.qualifiedUniqueStakeBps).toBe(10000);
    expect(metrics.securityScoreBps).toBe(10000);
    expect(() => assertStabilityThresholds(metrics, stabilityPolicy, '100', descendants.length)).not.toThrow();
  });

  it('fails threshold checks when depth and qualified unique stake are too low', () => {
    const stabilityPolicy = policy({
      threshold_depth: 4n,
      threshold_unique_pools: 2n,
      threshold_unique_stake_bps: 7000n,
    });

    const descendants = [
      makeBlock(201, 'anchor', 'pool-a'),
      makeBlock(202, 'hash-201', 'pool-a'),
      makeBlock(203, 'hash-202', 'pool-b'),
    ];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      {
        poolId: 'pool-a',
        stake: 400n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 200n,
        vrfKeyHash: 'bb'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-c',
        stake: 400n,
        vrfKeyHash: 'cc'.repeat(32),
        firstRegistrationSlot: 1n,
      },
    ];

    const metrics = computeStabilityMetrics(descendants, epochStakeDistribution, stabilityPolicy, {
      poolRegistrationCutoffSlot,
    });

    expect(metrics.qualifiedUniquePoolsCount).toBe(2);
    expect(metrics.qualifiedUniqueStakeBps).toBe(6000);
    expect(() => assertStabilityThresholds(metrics, stabilityPolicy, '200', descendants.length)).toThrow(
      'stability thresholds not met',
    );
  });

  it('computes qualified unique stake bps from summed raw stake instead of summing rounded per-pool bps', () => {
    const stabilityPolicy = policy({
      threshold_depth: 3n,
      threshold_unique_pools: 3n,
      threshold_unique_stake_bps: 10000n,
    });

    const descendants = [
      makeBlock(401, 'anchor', 'pool-a'),
      makeBlock(402, 'hash-401', 'pool-b'),
      makeBlock(403, 'hash-402', 'pool-c'),
    ];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      {
        poolId: 'pool-a',
        stake: 2n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 2n,
        vrfKeyHash: 'bb'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-c',
        stake: 2n,
        vrfKeyHash: 'cc'.repeat(32),
        firstRegistrationSlot: 1n,
      },
    ];

    const metrics = computeStabilityMetrics(descendants, epochStakeDistribution, stabilityPolicy, {
      poolRegistrationCutoffSlot,
    });

    expect(metrics.qualifiedUniquePoolsCount).toBe(3);
    expect(metrics.qualifiedUniqueStakeBps).toBe(10000);
    expect(metrics.securityScoreBps).toBe(10000);
  });

  it('fails closed when epoch stake distribution is missing', () => {
    const stabilityPolicy = policy({
      threshold_depth: 3n,
      threshold_unique_pools: 2n,
      threshold_unique_stake_bps: 6000n,
    });

    const descendants = [
      makeBlock(301, 'anchor', 'pool-a'),
      makeBlock(302, 'hash-301', 'pool-b'),
      makeBlock(303, 'hash-302', 'pool-c'),
    ];

    expect(() => computeStabilityMetrics(descendants, [], stabilityPolicy)).toThrow(
      'Epoch stake distribution unavailable',
    );
  });

  it('excludes pools first registered after the cutoff while keeping total stake denominator', () => {
    const stabilityPolicy = policy({
      threshold_depth: 2n,
      threshold_unique_pools: 2n,
      threshold_unique_stake_bps: 7000n,
    });

    const descendants = [makeBlock(501, 'anchor', 'pool-a'), makeBlock(502, 'hash-501', 'pool-b')];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      {
        poolId: 'pool-a',
        stake: 500n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 500n,
        vrfKeyHash: 'bb'.repeat(32),
        firstRegistrationSlot: poolRegistrationCutoffSlot,
      },
    ];

    const metrics = computeStabilityMetrics(descendants, epochStakeDistribution, stabilityPolicy, {
      poolRegistrationCutoffSlot,
    });

    expect(metrics.qualifiedUniquePoolsCount).toBe(1);
    expect(metrics.qualifiedUniqueStakeBps).toBe(5000);
  });

  it('allows local devnets to override the pool registration cutoff slot', () => {
    const anchorBlock = makeBlock(701, 'anchor', 'pool-a');

    expect(
      computePoolRegistrationCutoffSlot(anchorBlock, 1_000_000_000n, {
        CARDANO_STABILITY_POOL_REGISTRATION_CUTOFF_SLOT: '18446744073709551615',
      } as NodeJS.ProcessEnv),
    ).toBe(18446744073709551615n);
  });

  it('fails closed when a producing pool has no first registration slot', () => {
    const stabilityPolicy = policy({
      threshold_depth: 1n,
      threshold_unique_pools: 1n,
      threshold_unique_stake_bps: 1n,
    });

    const descendants = [makeBlock(601, 'anchor', 'pool-a')];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      { poolId: 'pool-a', stake: 1000n, vrfKeyHash: 'aa'.repeat(32) },
    ];

    expect(() =>
      computeStabilityMetrics(descendants, epochStakeDistribution, stabilityPolicy, { poolRegistrationCutoffSlot }),
    ).toThrow('First registration slot missing');
  });
});
