import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ClientState,
  PoolProductionHistory,
  PoolProductionRecord,
} from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';
import { productionAtAnchor, productionRecords } from '../services/pool-production';
import { bootstrapSettlementCredit } from '../services/settlement-credit';
import { computeStabilityMetrics, getStabilityPolicy } from '../services/stability-scoring';
import { HistoryBlock, HistoryService } from '../services/history.service';
import { loadStakeWeightedStabilityEvidenceByHeight } from '../services/stability-evidence';

const block = (epoch: number, pool: string, height = 10): HistoryBlock => ({
  height,
  hash: `block-${height}`,
  prevHash: `block-${height - 1}`,
  slotNo: BigInt(height),
  epochNo: epoch,
  timestampUnixNs: 1_700_000_000_000_000_000n,
  slotLeader: pool,
});
const history = (epoch: bigint, pools: string[], bitmap = 1): PoolProductionHistory => ({
  epoch,
  pools: pools.map((pool_id) => ({ pool_id, completed_epochs_bitmap: bitmap, produced_current_epoch: false })),
});

describe('pool production history', () => {
  const cases: {
    name: string;
    saved_epoch: number;
    pools: PoolProductionRecord[];
    bridge: { epoch: number; pool: string }[];
    anchor: { epoch: number; pool: string };
    descendants: string[];
    expected_pools: number;
    expected_credit_bps: number;
  }[] = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/pool-production-settlement.json',
      ),
      'utf8',
    ),
  );
  it.each(cases)('matches the shared Go fixture: $name', (fixture) => {
    const client = ClientState.fromPartial({
      current_epoch: BigInt(fixture.saved_epoch),
      latest_checkpoint_pool_production: { epoch: BigInt(fixture.saved_epoch), pools: fixture.pools },
    });
    const saved = ClientState.decode(ClientState.encode(client).finish());
    const anchor = block(fixture.anchor.epoch, fixture.anchor.pool);
    const poolProduction = productionAtAnchor(
      saved,
      fixture.bridge.map((row) => block(row.epoch, row.pool)),
      anchor,
    );
    const entries = [
      { poolId: 'pool-a', stake: 2000n },
      { poolId: 'other', stake: 8000n },
    ].map((row) => ({
      ...row,
      vrfKeyHash: '11'.repeat(32),
      firstRegistrationSlot: 0n,
      relativeStakeNumerator: row.stake,
      relativeStakeDenominator: 10000n,
    }));
    const reference = bootstrapSettlementCredit(BigInt(anchor.epochNo), [
      { poolId: 'pool-a', stake: 2n },
      { poolId: 'other', stake: 9998n },
    ]);
    const metrics = computeStabilityMetrics(
      fixture.descendants.map((pool, i) => block(anchor.epochNo, pool, 11 + i)),
      entries,
      getStabilityPolicy(),
      {
        poolProduction,
        settlementCreditReference: reference.reference,
        poolRegistrationCutoffSlot: 1000n,
      },
    );
    expect(metrics.qualifiedUniquePoolsCount).toBe(fixture.expected_pools);
    expect(metrics.qualifiedUniqueStakeBps).toBe(fixture.expected_credit_bps);
    expect(saved).toEqual(client);
  });

  it('never treats missing history or current-only observations as qualification', () => {
    const entries = [
      {
        poolId: 'pool-a',
        stake: 1n,
        vrfKeyHash: '11'.repeat(32),
        firstRegistrationSlot: 0n,
        relativeStakeNumerator: 1n,
        relativeStakeDenominator: 1n,
      },
    ];
    const metrics = computeStabilityMetrics([block(10, 'pool-a')], entries, getStabilityPolicy(), {
      poolRegistrationCutoffSlot: 1000n,
    });
    expect(metrics.qualifiedUniquePoolsCount).toBe(0);
    expect(metrics.qualifiedUniqueStakeBps).toBe(0);
    expect(() => productionAtAnchor(ClientState.fromPartial({ current_epoch: 10n }), [], block(10, 'pool-a'))).toThrow(
      'unavailable',
    );
    expect(() =>
      productionRecords(
        { epoch: 10n, pools: [{ pool_id: 'pool-a', completed_epochs_bitmap: 32, produced_current_epoch: false }] },
        10n,
      ),
    ).toThrow('bitmap');
  });

  it('collects more descendants when a producer has only current-epoch production', async () => {
    const pools = ['pool-a', 'pool-b', 'pool-c', 'pool-d', 'pool-e', 'pool-f'];
    const anchor = block(10, 'pool-f', 100);
    anchor.slotNo = 1000n;
    const descendants = Array.from({ length: 25 }, (_, i) => ({
      ...block(10, i === 24 ? 'pool-f' : pools[i % 5], 101 + i),
      hash: `descendant-${i}`,
      prevHash: i ? `descendant-${i - 1}` : anchor.hash,
      slotNo: 1001n + BigInt(i),
    }));
    const entries = pools.map((poolId) => ({
      poolId,
      stake: 100n,
      relativeStakeNumerator: 1n,
      relativeStakeDenominator: 6n,
      firstRegistrationSlot: 0n,
      vrfKeyHash: '11'.repeat(32),
    }));
    const client = ClientState.fromPartial({
      current_epoch: 10n,
      latest_checkpoint_height: { revision_height: 99n },
      latest_checkpoint_pool_production: history(
        10n,
        pools.filter((pool) => pool !== 'pool-e'),
      ),
      latest_checkpoint_settlement_credit: bootstrapSettlementCredit(10n, entries),
    });
    client.latest_checkpoint_pool_production!.pools.push({
      pool_id: 'pool-e',
      completed_epochs_bitmap: 0,
      produced_current_epoch: true,
    });
    const provider = {
      findBlockByHeight: jest
        .fn()
        .mockImplementation(async (height) => (height === 100n ? anchor : block(10, 'pool-a', 99))),
      findBridgeBlocks: jest.fn().mockResolvedValue([]),
      findDescendantBlocks: jest.fn().mockResolvedValue(descendants),
      findObservedPoolProductionAtBlock: jest.fn().mockResolvedValue(history(10n, pools)),
      findEpochContextAtBlock: jest.fn().mockResolvedValue({
        stakeDistribution: entries,
        verificationContext: {
          epochNonce: '11'.repeat(32),
          slotsPerKesPeriod: 129600,
          maxKesEvolutions: 62,
          activeSlotCoefficientNumerator: 1n,
          activeSlotCoefficientDenominator: 20n,
          currentEpochStartSlot: 900n,
          currentEpochEndSlotExclusive: 5000n,
        },
      }),
    } as unknown as HistoryService;
    const publicEstimate = await loadStakeWeightedStabilityEvidenceByHeight({ historyService: provider, height: 100n });
    expect(publicEstimate.descendantBlocks).toHaveLength(24);
    (provider.findObservedPoolProductionAtBlock as jest.Mock).mockClear();
    const selected = await loadStakeWeightedStabilityEvidenceByHeight({
      historyService: provider,
      height: 100n,
      settlementCreditClient: client,
    });
    expect(selected.descendantBlocks).toHaveLength(25);
    expect(provider.findObservedPoolProductionAtBlock).not.toHaveBeenCalled();
    (provider.findDescendantBlocks as jest.Mock).mockResolvedValue(descendants.slice(0, 24));
    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: provider,
        height: 100n,
        settlementCreditClient: client,
      }),
    ).rejects.toThrow('qualified unique pools');
    // Earlier descendants never modify the client to grant qualification to pool-e.
    expect(
      client.latest_checkpoint_pool_production?.pools.find((row) => row.pool_id === 'pool-e')?.completed_epochs_bitmap,
    ).toBe(0);
    client.latest_checkpoint_height = undefined;
    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: provider,
        height: 100n,
        settlementCreditClient: client,
      }),
    ).rejects.toThrow('checkpoint');
    client.latest_checkpoint_height = { revision_number: 0n, revision_height: 98n };
    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: provider,
        height: 100n,
        settlementCreditClient: client,
      }),
    ).rejects.toThrow('bridge segment');
  });
});
