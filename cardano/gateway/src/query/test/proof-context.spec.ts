import { Logger } from '@nestjs/common';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { ibcTreeCacheIdForRoot } from '../../shared/services/ibc-tree-cache.service';
import { resolveProofContextForQuery, resolveProofHeightForCurrentRoot } from '../services/proof-context';

function makeTree(seed: string): ICS23MerkleTree {
  const tree = new ICS23MerkleTree();
  tree.set(`clients/${seed}/clientState`, Buffer.from(seed, 'utf8'));
  return tree;
}

function makeDeps(root: string, cached?: { tree: ICS23MerkleTree; root: string }) {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  const lucidService = {
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({
      txHash: 'live-host-state',
      outputIndex: 0,
      datum: 'live-datum',
    }),
    decodeDatum: jest.fn().mockResolvedValue({
      state: {
        ibc_state_root: root,
      },
    }),
  };

  const historyService = {
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn().mockImplementation(async (height: bigint) => ({
      txHash: height === 200n ? 'live-host-state' : 'historical-host-state',
      outputIndex: 0,
      datum: height === 200n ? 'live-datum' : 'historical-datum',
    })),
  };

  const mithrilService = {
    getCardanoTransactionsSetSnapshot: jest.fn().mockResolvedValue([{ block_number: '200' }]),
  };

  const ibcTreeCacheService = {
    load: jest.fn().mockResolvedValue(cached ?? null),
  };

  return {
    logger,
    lucidService: lucidService as any,
    mithrilService: mithrilService as any,
    historyService: historyService as any,
    ibcTreeCacheService: ibcTreeCacheService as any,
    mocks: {
      historyService,
      ibcTreeCacheService,
    },
  };
}

describe('proof-context stability fallback', () => {
  it('reuses the live HostState tx height when the current root was created in a prior epoch', async () => {
    const logger = {
      debug: jest.fn(),
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
    expect((logger.warn as jest.Mock).mock.calls[0][0]).toContain('reusing its tx height 1228 for proof serving');
  });
});

describe('resolveProofContextForQuery', () => {
  it('loads an exact-height proof tree by the historical HostState root', async () => {
    const tree = makeTree('client-0');
    const root = tree.getRoot();
    const deps = makeDeps(root, { tree, root });

    const context = await resolveProofContextForQuery({
      ...deps,
      context: 'test',
      requestedHeight: 123n,
      lightClientMode: 'mithril',
      maxAttempts: 1,
      delayMs: 0,
    });

    expect(context).toMatchObject({
      historical: true,
      proofHeight: 123n,
      root,
    });
    expect(deps.mocks.ibcTreeCacheService.load).toHaveBeenCalledWith(ibcTreeCacheIdForRoot(root));
  });

  it('rejects historical proof context when the cached tree root does not match the HostState root', async () => {
    const expectedTree = makeTree('client-0');
    const cachedTree = makeTree('client-1');
    const deps = makeDeps(expectedTree.getRoot(), {
      tree: cachedTree,
      root: cachedTree.getRoot(),
    });

    await expect(
      resolveProofContextForQuery({
        ...deps,
        context: 'test',
        requestedHeight: 123n,
        lightClientMode: 'mithril',
        maxAttempts: 1,
        delayMs: 0,
      }),
    ).rejects.toThrow('Cached IBC state tree root mismatch');
  });

  it('rejects requested proof heights newer than the latest accepted proof height', async () => {
    const tree = makeTree('client-0');
    const deps = makeDeps(tree.getRoot(), { tree, root: tree.getRoot() });

    await expect(
      resolveProofContextForQuery({
        ...deps,
        context: 'test',
        requestedHeight: 201n,
        lightClientMode: 'mithril',
        maxAttempts: 1,
        delayMs: 0,
      }),
    ).rejects.toThrow('is newer than latest accepted proof height 200');
  });
});
