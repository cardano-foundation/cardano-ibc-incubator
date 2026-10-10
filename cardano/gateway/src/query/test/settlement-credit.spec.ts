import { ClientState } from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';
import { HistoryService } from '../services/history.service';
import { loadStakeWeightedStabilityEvidenceByHeight } from '../services/stability-evidence';
import { getStabilityPolicy } from '../services/stability-scoring';
import {
  addCredit,
  bootstrapSettlementCredit,
  computeSettlementCredits,
  creditBasisPoints,
  settlementReferenceForEpoch,
} from '../services/settlement-credit';

describe('settlement credit', () => {
  it('clips a large increase and applies a decrease without redistributing the discount', () => {
    const reference = bootstrapSettlementCredit(7n, [
      { poolId: 'a', stake: 2n },
      { poolId: 'b', stake: 9998n },
    ]);
    const credit = computeSettlementCredits(
      [
        { poolId: 'a', stake: 2000n },
        { poolId: 'b', stake: 8000n },
      ],
      reference.reference,
    );
    expect(creditBasisPoints(credit.get('a')!)).toBe(52n);
    expect(creditBasisPoints(credit.get('b')!)).toBe(8000n);
    expect(creditBasisPoints(addCredit(credit.get('a')!, credit.get('b')!))).toBe(8052n);
  });

  it('advances the next reference from capped credit instead of the current claim', () => {
    const client = ClientState.fromPartial({
      current_epoch: 7n,
      latest_checkpoint_settlement_credit: bootstrapSettlementCredit(7n, [
        { poolId: 'a', stake: 2n },
        { poolId: 'b', stake: 9998n },
      ]),
      epoch_contexts: [
        {
          epoch: 7n,
          stake_distribution: [
            { pool_id: 'a', stake: 2000n },
            { pool_id: 'b', stake: 8000n },
          ],
        },
      ],
    });
    const decoded = ClientState.decode(ClientState.encode(client).finish());
    const reference = settlementReferenceForEpoch(decoded, 8n);
    const credit = computeSettlementCredits(
      [
        { poolId: 'a', stake: 2000n },
        { poolId: 'b', stake: 8000n },
      ],
      reference,
    );
    expect(creditBasisPoints(credit.get('a')!)).toBe(102n);
    expect(settlementReferenceForEpoch(decoded, 7n)).toEqual(client.latest_checkpoint_settlement_credit!.reference);
    expect(() => settlementReferenceForEpoch(decoded, 9n)).toThrow('adjacent');
  });

  it('rounds after summing exact shares', () => {
    const entries = [
      { poolId: 'a', stake: 511n },
      { poolId: 'b', stake: 511n },
      { poolId: 'c', stake: 511n },
      { poolId: 'other', stake: 28467n },
    ];
    const credits = computeSettlementCredits(entries, bootstrapSettlementCredit(7n, entries).reference);
    expect(creditBasisPoints(addCredit(addCredit(credits.get('a')!, credits.get('b')!), credits.get('c')!))).toBe(511n);
  });

  it('waits for another producer when a 24-block prefix has insufficient capped credit', async () => {
    const anchor = {
      height: 100,
      hash: 'anchor',
      prevHash: 'parent',
      slotNo: 1000n,
      epochNo: 7,
      timestampUnixNs: 1_700_000_000_000_000_000n,
      slotLeader: 'other',
    };
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({ poolId: `pool-${i}`, stake: 20n })),
      { poolId: 'other', stake: 900n },
    ].map((row) => ({
      ...row,
      firstRegistrationSlot: 0n,
      relativeStakeNumerator: row.stake,
      relativeStakeDenominator: 1000n,
      vrfKeyHash: '11'.repeat(32),
    }));
    const descendants = Array.from({ length: 25 }, (_, i) => ({
      ...anchor,
      height: 101 + i,
      hash: `block-${i}`,
      prevHash: i ? `block-${i - 1}` : 'anchor',
      slotNo: 1001n + BigInt(i),
      slotLeader: i === 24 ? 'other' : `pool-${i % 5}`,
    }));
    const history = {
      findBlockByHeight: jest.fn().mockResolvedValue(anchor),
      findDescendantBlocks: jest.fn().mockResolvedValue(descendants),
      findBridgeBlocks: jest.fn().mockResolvedValue([]),
      findObservedPoolProductionAtBlock: jest.fn().mockResolvedValue({ epoch: 7n, pools: entries.map((entry) => ({ pool_id: entry.poolId, completed_epochs_bitmap: 1, produced_current_epoch: false })) }),
      findEpochContextAtBlock: jest.fn().mockResolvedValue({
        stakeDistribution: entries,
        verificationContext: {
          epochNonce: '22'.repeat(32),
          slotsPerKesPeriod: 129600,
          maxKesEvolutions: 62,
          activeSlotCoefficientNumerator: 1n,
          activeSlotCoefficientDenominator: 20n,
          currentEpochStartSlot: 900n,
          currentEpochEndSlotExclusive: 5000n,
        },
      }),
    } as unknown as HistoryService;
    const client = ClientState.fromPartial({
      current_epoch: 7n,
      latest_checkpoint_pool_production: { epoch: 7n, pools: entries.map((entry) => ({ pool_id: entry.poolId, completed_epochs_bitmap: 1, produced_current_epoch: false })) },
      latest_checkpoint_height: { revision_height: 99n },
      latest_checkpoint_settlement_credit: bootstrapSettlementCredit(7n, [{ poolId: 'other', stake: 1n }]),
    });
    const uncapped = await loadStakeWeightedStabilityEvidenceByHeight({
      historyService: history,
      height: 100n,
      stabilityPolicy: getStabilityPolicy(),
    });
    expect(uncapped.descendantBlocks).toHaveLength(24);
    const capped = await loadStakeWeightedStabilityEvidenceByHeight({
      historyService: history,
      height: 100n,
      settlementCreditClient: client,
    });
    expect(capped.descendantBlocks).toHaveLength(25);
    expect(capped.metrics.qualifiedUniqueStakeBps).toBe(9250);
    (history.findDescendantBlocks as jest.Mock).mockResolvedValue(descendants.slice(0, 24));
    await expect(
      loadStakeWeightedStabilityEvidenceByHeight({
        historyService: history,
        height: 100n,
        settlementCreditClient: client,
      }),
    ).rejects.toThrow('qualified unique stake');
  });
});
