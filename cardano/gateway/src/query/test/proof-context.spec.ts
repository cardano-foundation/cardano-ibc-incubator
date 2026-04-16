import { Logger } from '@nestjs/common';
import { resolveProofHeightForCurrentRoot } from '../services/proof-context';

describe('proof-context stability fallback', () => {
  it('reuses the live HostState tx height when the current root was created in a prior epoch', async () => {
    const logger = {
      warn: jest.fn(),
    } as unknown as Logger;

    const proofHeight = await resolveProofHeightForCurrentRoot({
      logger,
      lucidService: {
        findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({
          txHash: 'live-host-state-tx',
          outputIndex: 0,
        }),
      } as any,
      mithrilService: {} as any,
      historyService: {
        findTransactionEvidenceByHash: jest.fn().mockResolvedValue({
          txHash: 'live-host-state-tx',
          blockNo: 1228,
        }),
        findTxByHash: jest.fn(),
        findBlockByHeight: jest.fn().mockResolvedValue({
          height: 1228,
          hash: 'anchor-hash',
          prevHash: 'prev-hash',
          slotNo: 1228n,
          epochNo: 0,
          timestampUnixNs: 1228n,
          slotLeader: 'pool1',
        }),
        findDescendantBlocks: jest.fn().mockResolvedValue([]),
        findEpochContextAtBlock: jest
          .fn()
          .mockRejectedValue(new Error('Failed to acquire requested point. Target point is too old.')),
        findLatestBlock: jest.fn().mockResolvedValue({
          height: 2000,
          hash: 'latest-hash',
          prevHash: 'prev-hash',
          slotNo: 2000n,
          epochNo: 1,
          timestampUnixNs: 2000n,
          slotLeader: 'pool1',
        }),
      } as any,
      context: 'queryChannel',
      lightClientMode: 'stake-weighted-stability',
      maxAttempts: 1,
      delayMs: 0,
    });

    expect(proofHeight).toBe(1228n);
    expect((logger.warn as jest.Mock).mock.calls[0][0]).toContain(
      'reusing its tx height 1228 for proof serving',
    );
  });
});
