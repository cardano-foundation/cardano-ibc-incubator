import { readFileSync } from 'fs';
import { resolve } from 'path';
import { computePoolRegistrationCutoffSlot, computeStabilityMetrics, getStabilityPolicy } from '../services/stability-scoring';
import { HistoryBlock } from '../services/history.service';

type PoolAgeFixture = {
  name: string;
  system_start_unix_ns: string;
  slot_length_ns: string;
  anchor_slot: string;
  anchor_timestamp_unix_ns: string;
  expected_cutoff_slot: string;
  registration_slots: string[];
  expected_pools: number;
  expected_credit_bps: number;
};

const cases: PoolAgeFixture[] = JSON.parse(readFileSync(resolve(
  __dirname, '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/pool-age.json',
), 'utf8'));

describe('rolling pool registration age', () => {
  it.each(cases)('matches Go calendar and settlement rules: $name', (fixture) => {
    const anchor = {
      slotNo: BigInt(fixture.anchor_slot),
      timestampUnixNs: BigInt(fixture.anchor_timestamp_unix_ns),
    };
    const cutoff = computePoolRegistrationCutoffSlot(anchor, BigInt(fixture.slot_length_ns));
    expect(cutoff).toBe(BigInt(fixture.expected_cutoff_slot));
    const distribution = fixture.registration_slots.map((registration, i) => ({
      poolId: String.fromCharCode(97 + i), stake: 100n,
      relativeStakeNumerator: 1n, relativeStakeDenominator: 3n,
      vrfKeyHash: 'aa'.repeat(32), firstRegistrationSlot: BigInt(registration),
    }));
    // Later descendants and wall-clock time cannot move this anchor's cutoff.
    const descendants: HistoryBlock[] = distribution.map((entry, i) => ({
      height: 11 + i, hash: entry.poolId, prevHash: i ? distribution[i - 1].poolId : 'anchor',
      slotNo: anchor.slotNo + BigInt(i + 1), epochNo: 7, timestampUnixNs: 18_446_744_073_709_551_615n,
      slotLeader: entry.poolId,
    }));
    const metrics = computeStabilityMetrics(descendants, distribution, getStabilityPolicy(), {
      poolRegistrationCutoffSlot: cutoff,
      settlementCreditReference: distribution.map((entry) => ({ pool_id: entry.poolId, numerator: Uint8Array.of(1), denominator: Uint8Array.of(3) })),
      poolProduction: { epoch: 7n, pools: distribution.map((entry) => ({ pool_id: entry.poolId, completed_epochs_bitmap: 1, produced_current_epoch: false })) },
    });
    expect(metrics.qualifiedUniquePoolsCount).toBe(fixture.expected_pools);
    expect(metrics.qualifiedUniqueStakeBps).toBe(fixture.expected_credit_bps);
  });

  it('rejects invalid timing instead of granting qualification', () => {
    const valid = { slotNo: 1n, timestampUnixNs: 2_000_000_000n };
    expect(() => computePoolRegistrationCutoffSlot(valid, 0n)).toThrow('slot length');
    expect(() => computePoolRegistrationCutoffSlot({ ...valid, slotNo: -1n })).toThrow('supported range');
    expect(() => computePoolRegistrationCutoffSlot({ ...valid, timestampUnixNs: -1n })).toThrow('supported range');
    expect(() => computePoolRegistrationCutoffSlot({ ...valid, timestampUnixNs: 18_446_744_073_709_551_616n })).toThrow('supported range');
    expect(() => computePoolRegistrationCutoffSlot({ ...valid, slotNo: 2n })).toThrow('system start');
  });
});
