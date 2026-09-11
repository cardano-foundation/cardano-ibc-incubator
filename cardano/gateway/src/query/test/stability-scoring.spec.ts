import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertStabilityThresholds,
  computePoolRegistrationCutoffSlot,
  computeStabilityMetrics,
  getStabilityPolicy,
  StabilityPolicy,
  PoolRegistrationNetworkIdentity,
} from '../services/stability-scoring';
import { HistoryBlock, HistoryStakeDistributionEntry } from '../services/history.service';

describe('pool registration cutoff network binding', () => {
  const cutoff = 1_767_225_600_000_000_000n;
  const devnet = { chainId: 'cardano-devnet', networkMagic: '42', chainNetworkMagic: '42' };
  const anchor = (start: bigint, slotLength = 1_000_000_000n) => ({ slotNo: 1000n, timestampUnixNs: start + 1000n * slotLength });

  it.each([cutoff, cutoff + 1n, cutoff + 86_400_000_000_000n])('admits only bootstrap registrations for a bound fresh devnet starting at %s', (start) => {
    expect(computePoolRegistrationCutoffSlot(anchor(start), undefined, devnet)).toBe(2n);
  });

  const nonDevnets: Array<[string, PoolRegistrationNetworkIdentity | undefined]> = [
    ['missing identity', undefined], ['empty identity', {}],
    ['missing chain ID', { ...devnet, chainId: undefined }],
    ['missing network magic', { ...devnet, networkMagic: undefined }],
    ['missing chain network magic', { ...devnet, chainNetworkMagic: undefined }],
    ['suffixed chain ID', { ...devnet, chainId: 'cardano-devnet-1' }],
    ['case changed chain ID', { ...devnet, chainId: 'Cardano-devnet' }],
    ['padded chain ID', { ...devnet, chainId: 'cardano-devnet ' }],
    ['preprod chain ID', { ...devnet, chainId: 'cardano-preprod' }],
    ['padded network magic', { ...devnet, networkMagic: '042' }],
    ...['1', '2', '764824073'].flatMap((magic): Array<[string, PoolRegistrationNetworkIdentity]> => [
      [`public network ${magic}`, { ...devnet, networkMagic: magic, chainNetworkMagic: magic }],
      [`mismatched network ${magic}/42`, { ...devnet, networkMagic: magic }],
      [`mismatched network 42/${magic}`, { ...devnet, chainNetworkMagic: magic }],
    ]),
  ];
  it.each(nonDevnets)('keeps the existing post-cutoff rule for %s', (_label, identity) => {
    expect(computePoolRegistrationCutoffSlot(anchor(cutoff), undefined, identity)).toBe(0n);
  });

  it('uses system start rather than the anchor date and leaves older networks unchanged', () => {
    const old = anchor(cutoff - 100_000_000_000n);
    expect(old.timestampUnixNs > cutoff).toBe(true);
    for (const identity of [devnet, ...nonDevnets.map(([, value]) => value)]) {
      expect(computePoolRegistrationCutoffSlot(old, undefined, identity)).toBe(100n);
    }
    expect(computePoolRegistrationCutoffSlot(anchor(cutoff - 7_000_000_000n, 2_000_000_000n), 2_000_000_000n, devnet)).toBe(4n);
    expect(() => computePoolRegistrationCutoffSlot(old, 0n, devnet)).toThrow('greater than zero');
  });

  it.each([1n, 2n, 3n, 10_000n, 0n, -1n, undefined])('does not widen registration eligibility beyond slot 1: %s', (slot) => {
    const registration = { poolId: 'pool', stake: 1n, relativeStakeNumerator: 1n, relativeStakeDenominator: 1n,
      vrfKeyHash: '11'.repeat(32), firstRegistrationSlot: slot };
    const metrics = () => computeStabilityMetrics([{ ...anchor(cutoff), height: 1, hash: 'block', prevHash: 'anchor', epochNo: 0, slotLeader: 'pool' }],
      [registration], getStabilityPolicy(), { poolRegistrationCutoffSlot: computePoolRegistrationCutoffSlot(anchor(cutoff), undefined, devnet) });
    if (slot === undefined || slot <= 0n) expect(metrics).toThrow('First registration slot missing');
    else expect(metrics().qualifiedUniquePoolsCount).toBe(slot === 1n ? 1 : 0);
  });
});

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

  it('keeps one stability threshold of local rollback headroom after an anchor is accepted', () => {
    const shelleyGenesis = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../chains/cardano/config/devnet/genesis-shelley.json'), 'utf8'),
    ) as { securityParam: number };
    const byronGenesis = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../chains/cardano/config/devnet/genesis-byron.json'), 'utf8'),
    ) as { protocolConsts: { k: number } };

    expect(byronGenesis.protocolConsts.k).toBe(shelleyGenesis.securityParam);
    expect(BigInt(shelleyGenesis.securityParam) >= getStabilityPolicy().threshold_depth * 2n).toBe(true);
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
        relativeStakeNumerator: 500n,
        relativeStakeDenominator: 1000n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 300n,
        relativeStakeNumerator: 300n,
        relativeStakeDenominator: 1000n,
        vrfKeyHash: 'bb'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-c',
        stake: 200n,
        relativeStakeNumerator: 200n,
        relativeStakeDenominator: 1000n,
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
        relativeStakeNumerator: 400n,
        relativeStakeDenominator: 1000n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 200n,
        relativeStakeNumerator: 200n,
        relativeStakeDenominator: 1000n,
        vrfKeyHash: 'bb'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-c',
        stake: 400n,
        relativeStakeNumerator: 400n,
        relativeStakeDenominator: 1000n,
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
        relativeStakeNumerator: 2n,
        relativeStakeDenominator: 6n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 2n,
        relativeStakeNumerator: 2n,
        relativeStakeDenominator: 6n,
        vrfKeyHash: 'bb'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-c',
        stake: 2n,
        relativeStakeNumerator: 2n,
        relativeStakeDenominator: 6n,
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
        relativeStakeNumerator: 500n,
        relativeStakeDenominator: 1000n,
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1n,
      },
      {
        poolId: 'pool-b',
        stake: 500n,
        relativeStakeNumerator: 500n,
        relativeStakeDenominator: 1000n,
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

  it('fails closed when a producing pool has no first registration slot', () => {
    const stabilityPolicy = policy({
      threshold_depth: 1n,
      threshold_unique_pools: 1n,
      threshold_unique_stake_bps: 1n,
    });

    const descendants = [makeBlock(601, 'anchor', 'pool-a')];
    const epochStakeDistribution: HistoryStakeDistributionEntry[] = [
      {
        poolId: 'pool-a',
        stake: 1000n,
        relativeStakeNumerator: 1n,
        relativeStakeDenominator: 1n,
        vrfKeyHash: 'aa'.repeat(32),
      },
    ];

    expect(() =>
      computeStabilityMetrics(descendants, epochStakeDistribution, stabilityPolicy, { poolRegistrationCutoffSlot }),
    ).toThrow('First registration slot missing');
  });
});
