import { Logger } from '@nestjs/common';
import { BridgeMigrationInProgressError } from '@cardano-ibc/tx-builder-runtime/migrationRuntime';
import { GrpcFailedPreconditionException } from '../../exception/grpc_exceptions';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { ibcTreeCacheIdForRoot } from '../../shared/services/ibc-tree-cache.service';
import { resolveProofContextForQuery, resolveProofHeightForCurrentRoot } from '../services/proof-context';
import { IbcTreeStateStore, StaleIbcTreeStateError, type IbcTreeStateSnapshot } from '../../shared/helpers/ibc-state-root';
import * as stabilityEvidence from '../services/stability-evidence';
import { createTestTreeContext } from '../../shared/testing/ibc-tree-test-store';

function makeTree(seed: string): ICS23MerkleTree {
  const tree = new ICS23MerkleTree();
  tree.set(`clients/${seed}/clientState`, Buffer.from(seed, 'utf8'));
  return tree;
}

function makeDeps(tree: ICS23MerkleTree, cached?: { tree: ICS23MerkleTree; root: string }) {
  const root = tree.getRoot();
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
    findBlockByHeight: jest.fn().mockResolvedValue({ height: 123, hash: 'anchor-123' }),
    rebuildIbcStateTreeAtBlock: jest.fn(async () => ({
      tree: tree.clone(), root, hostState: { txHash: 'historical-host-state', outputIndex: 0 },
    })),
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn().mockImplementation(async (height: bigint) => ({
      txHash: height === 200n ? 'live-host-state' : 'historical-host-state',
      outputIndex: 0,
      blockNo: Number(height),
      datum: height === 200n ? 'live-datum' : 'historical-datum',
    })),
  };

  const mithrilService = {
    getCardanoTransactionsSetSnapshot: jest.fn().mockResolvedValue([{ block_number: '200' }]),
  };

  const ibcTreeCacheService = {
    saveAliases: jest.fn(async () => ({ root })),
    load: jest.fn().mockResolvedValue(cached ?? null),
  };
  const ibcTreeStore = {
    getAlignedSnapshot: jest.fn(async (): Promise<IbcTreeStateSnapshot> => ({
      version: 1,
      root,
      tree: tree.clone(),
      hostState: { txHash: 'live-host-state', outputIndex: 0 },
    })),
  };

  return {
    logger,
    lucidService: lucidService as any,
    mithrilService: mithrilService as any,
    historyService: historyService as any,
    ibcTreeCacheService: ibcTreeCacheService as any,
    ibcTreeStore: ibcTreeStore as unknown as IbcTreeStateStore,
    mocks: {
      lucidService,
      mithrilService,
      ibcTreeStore,
      historyService,
      ibcTreeCacheService,
    },
  };
}

describe('proof-context stability acceptance', () => {
  it('does not advertise a live HostState tx height when the root was not accepted by stability policy', async () => {
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;

    await expect(
      resolveProofHeightForCurrentRoot({
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
      }),
    ).rejects.toThrow(/stability|accepted/i);
  });
});

describe('resolveProofContextForQuery', () => {
  it('reports the current migration pause as an actionable RPC precondition failure', async () => {
    const deps = makeDeps(makeTree('moving'));
    deps.mocks.ibcTreeStore.getAlignedSnapshot.mockRejectedValue(new BridgeMigrationInProgressError());
    await expect(resolveProofContextForQuery({ ...deps, context: 'packet-list' }))
      .rejects.toThrow(GrpcFailedPreconditionException);
    expect(deps.mocks.historyService.findHostStateUtxoAtOrBeforeBlockNo).not.toHaveBeenCalled();
  });
  const historical = (deps: ReturnType<typeof makeDeps>) => resolveProofContextForQuery({
    ...deps, context: 'test', requestedHeight: 123n, lightClientMode: 'mithril', maxAttempts: 1, delayMs: 0,
  });

  it.each(['Bridge migration is in progress', 'Stale implementation manifest', 'Current root is not yet accepted'])(
    'serves an independently accepted historical anchor while the live path rejects: %s', async (reason) => {
      const tree = makeTree('before-migration');
      const deps = makeDeps(tree);
      deps.mocks.lucidService.findUtxoAtHostStateNFT.mockRejectedValue(new Error(reason));
      deps.mocks.ibcTreeStore.getAlignedSnapshot.mockRejectedValue(new Error(reason));
      const acceptance = jest.spyOn(stabilityEvidence, 'loadStakeWeightedStabilityEvidenceByHeight')
        .mockResolvedValue({ anchorHeight: 123n, anchorBlock: { hash: 'anchor-123' } } as never);
      try {
        const context = await resolveProofContextForQuery({
          ...deps, context: 'historical-settlement', requestedHeight: 123n,
          lightClientMode: 'stake-weighted-stability', maxAttempts: 1, delayMs: 0,
        });
        expect(acceptance).toHaveBeenCalledWith(expect.objectContaining({ height: 123n }));
        expect(context.tree.verifyProof(context.tree.generateProof('clients/before-migration/clientState'))).toBe(true);
        expect(context.proofHeight).toBe(123n);
        expect(deps.mocks.lucidService.findUtxoAtHostStateNFT).not.toHaveBeenCalled();
        expect(deps.mocks.ibcTreeStore.getAlignedSnapshot).not.toHaveBeenCalled();
      } finally { acceptance.mockRestore(); }
    },
  );

  it('rejects an unstable historical anchor before loading a cached proof even when current state is unavailable', async () => {
    const tree = makeTree('old');
    const deps = makeDeps(tree, { tree, root: tree.getRoot() });
    deps.mocks.lucidService.findUtxoAtHostStateNFT.mockRejectedValue(new Error('Bridge migration is in progress'));
    const acceptance = jest.spyOn(stabilityEvidence, 'loadStakeWeightedStabilityEvidenceByHeight')
      .mockRejectedValue(new Error('stability thresholds not met at requested height'));
    try {
      await expect(resolveProofContextForQuery({
        ...deps, context: 'historical-settlement', requestedHeight: 123n,
        lightClientMode: 'stake-weighted-stability', maxAttempts: 1, delayMs: 0,
      })).rejects.toThrow('stability thresholds not met');
      expect(deps.mocks.ibcTreeCacheService.load).not.toHaveBeenCalled();
      expect(deps.mocks.historyService.findHostStateUtxoAtOrBeforeBlockNo).not.toHaveBeenCalled();
    } finally { acceptance.mockRestore(); }
  });

  it('rejects a stable block that has no exact HostState transaction for a root-bearing header', async () => {
    const tree = makeTree('old');
    const deps = makeDeps(tree, { tree, root: tree.getRoot() });
    deps.mocks.historyService.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'older-host', outputIndex: 0, blockNo: 122, datum: 'older-datum',
    });
    const acceptance = jest.spyOn(stabilityEvidence, 'loadStakeWeightedStabilityEvidenceByHeight')
      .mockResolvedValue({ anchorHeight: 123n, anchorBlock: { hash: 'anchor-123' } } as never);
    try {
      await expect(resolveProofContextForQuery({
        ...deps, context: 'historical-settlement', requestedHeight: 123n,
        lightClientMode: 'stake-weighted-stability', maxAttempts: 1, delayMs: 0,
      })).rejects.toThrow('not a HostState tx block height');
      expect(deps.mocks.ibcTreeCacheService.load).not.toHaveBeenCalled();
    } finally { acceptance.mockRestore(); }
  });

  it('rejects a warm historical cache when its accepted anchor is rolled back during the query', async () => {
    const tree = makeTree('old');
    const deps = makeDeps(tree, { tree, root: tree.getRoot() });
    deps.mocks.historyService.findBlockByHeight.mockResolvedValue({ height: 123, hash: 'replacement-anchor' });
    const acceptance = jest.spyOn(stabilityEvidence, 'loadStakeWeightedStabilityEvidenceByHeight')
      .mockResolvedValue({ anchorHeight: 123n, anchorBlock: { hash: 'anchor-123' } } as never);
    try {
      await expect(resolveProofContextForQuery({
        ...deps, context: 'historical-settlement', requestedHeight: 123n,
        lightClientMode: 'stake-weighted-stability', maxAttempts: 1, delayMs: 0,
      })).rejects.toThrow('Canonical anchor changed');
      expect(deps.mocks.historyService.rebuildIbcStateTreeAtBlock).not.toHaveBeenCalled();
    } finally { acceptance.mockRestore(); }
  });

  it('reconstructs a missing snapshot, serves a valid proof and caches only historical aliases', async () => {
    const tree = makeTree('old');
    const deps = makeDeps(tree);
    const context = await historical(deps);
    expect(context.tree.verifyProof(context.tree.generateProof('clients/old/clientState'))).toBe(true);
    expect(context.root).toBe(tree.getRoot());
    expect(deps.mocks.ibcTreeStore.getAlignedSnapshot).not.toHaveBeenCalled();
    expect(deps.mocks.ibcTreeCacheService.saveAliases).toHaveBeenCalledWith(
      expect.anything(), [ibcTreeCacheIdForRoot(tree.getRoot()), 'host-state:historical-host-state#0'],
      { txHash: 'historical-host-state', outputIndex: 0 },
    );
    deps.mocks.ibcTreeCacheService.load.mockResolvedValue({ tree: context.tree, root: context.root });
    await historical(deps);
    expect(deps.mocks.historyService.rebuildIbcStateTreeAtBlock).toHaveBeenCalledTimes(1);
  });

  it('fails on incomplete history without caching or using the current tree', async () => {
    const deps = makeDeps(makeTree('old'));
    deps.mocks.historyService.rebuildIbcStateTreeAtBlock.mockRejectedValue(new Error('required history is missing'));
    await expect(historical(deps)).rejects.toThrow('required history is missing');
    expect(deps.mocks.ibcTreeCacheService.saveAliases).not.toHaveBeenCalled();
    expect(deps.mocks.ibcTreeStore.getAlignedSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a reconstructed tree whose contents disagree with the claimed root', async () => {
    const deps = makeDeps(makeTree('old'));
    deps.mocks.historyService.rebuildIbcStateTreeAtBlock.mockResolvedValue({
      root: makeTree('old').getRoot(), tree: makeTree('wrong'),
      hostState: { txHash: 'historical-host-state', outputIndex: 0 },
    });
    await expect(historical(deps)).rejects.toThrow('Reconstructed IBC tree does not match');
    expect(deps.mocks.ibcTreeCacheService.saveAliases).not.toHaveBeenCalled();
  });

  it('rejects rollback of the historical HostState before caching the rebuilt tree', async () => {
    const tree = makeTree('old');
    const deps = makeDeps(tree);
    deps.mocks.historyService.rebuildIbcStateTreeAtBlock.mockImplementation(async () => {
      deps.mocks.historyService.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
        txHash: 'replacement', outputIndex: 0, datum: 'same-root',
      });
      return { root: tree.getRoot(), tree, hostState: { txHash: 'historical-host-state', outputIndex: 0 } };
    });
    await expect(historical(deps)).rejects.toThrow(StaleIbcTreeStateError);
    expect(deps.mocks.ibcTreeCacheService.saveAliases).not.toHaveBeenCalled();
  });

  it('can serve the authenticated proof if saving its disposable snapshot fails', async () => {
    const tree = makeTree('old');
    const deps = makeDeps(tree);
    deps.mocks.ibcTreeCacheService.saveAliases.mockRejectedValue(new Error('cache unavailable'));
    expect((await historical(deps)).root).toBe(tree.getRoot());
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('loads an exact-height proof tree by the historical HostState root', async () => {
    const tree = makeTree('client-0');
    const root = tree.getRoot();
    const deps = makeDeps(tree, { tree, root });
    deps.mocks.ibcTreeStore.getAlignedSnapshot.mockRejectedValue(new Error('latest tree rebuild unavailable'));

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
    expect(deps.mocks.ibcTreeStore.getAlignedSnapshot).not.toHaveBeenCalled();
    expect(context.tree).not.toBe(tree);
  });

  it('rebuilds when a height alias belongs to another historical root', async () => {
    const expectedTree = makeTree('client-0');
    const cachedTree = makeTree('client-1');
    const deps = makeDeps(expectedTree, {
      tree: cachedTree,
      root: cachedTree.getRoot(),
    });

    const context = await resolveProofContextForQuery({
      ...deps, context: 'test', requestedHeight: 123n, lightClientMode: 'mithril', maxAttempts: 1, delayMs: 0,
    });
    expect(context.root).toBe(expectedTree.getRoot());
    expect(deps.mocks.historyService.rebuildIbcStateTreeAtBlock).toHaveBeenCalledTimes(1);

  });

  it('rejects requested proof heights newer than the latest accepted proof height', async () => {
    const tree = makeTree('client-0');
    const deps = makeDeps(tree, { tree, root: tree.getRoot() });

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

  it('keeps the captured tree and height together when a newer snapshot is published while certification waits', async () => {
    const firstTree = makeTree('first');
    const laterTree = makeTree('later');
    const deps = makeDeps(firstTree);
    const treeContext = createTestTreeContext();
    const firstRef = { txHash: 'aa'.repeat(32), outputIndex: 0 };
    await treeContext.restore(firstTree, firstRef);
    const capture = jest.spyOn(treeContext.store, 'getAlignedSnapshot');
    deps.mocks.historyService.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      ...firstRef, datum: 'first-datum',
    });
    let releaseCertification!: () => void;
    let markWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => { markWaiting = resolve; });
    deps.mocks.mithrilService.getCardanoTransactionsSetSnapshot.mockImplementationOnce(async () => {
      markWaiting();
      await new Promise<void>((resolve) => { releaseCertification = resolve; });
      return [{ block_number: '200' }];
    });

    const pending = resolveProofContextForQuery({
      ...deps, ibcTreeStore: treeContext.store, context: 'test', lightClientMode: 'mithril', maxAttempts: 1, delayMs: 0,
    });
    await waiting;
    await treeContext.restore(laterTree, { txHash: 'bb'.repeat(32), outputIndex: 1 });
    releaseCertification();

    const context = await pending;
    expect(context.proofHeight).toBe(200n);
    expect(context.root).toBe(firstTree.getRoot());
    expect(context.hostState).toEqual(firstRef);
    expect(context.tree.getRoot()).toBe(firstTree.getRoot());
    expect(context.tree.generateProof('clients/first/clientState').value).toEqual(Buffer.from('first'));
    expect(context.tree).not.toBe(firstTree);
    expect(treeContext.store.getSnapshot().root).toBe(laterTree.getRoot());
    expect(capture).toHaveBeenCalledTimes(1);
    expect(deps.mocks.lucidService.findUtxoAtHostStateNFT).not.toHaveBeenCalled();
  });

  it('rejects a different HostState output at the accepted height even when a heartbeat leaves the root unchanged', async () => {
    const deps = makeDeps(makeTree('first'));
    deps.mocks.historyService.findHostStateUtxoAtOrBeforeBlockNo
      .mockResolvedValueOnce({ txHash: 'live-host-state', outputIndex: 0, datum: 'first-datum' })
      .mockResolvedValueOnce({ txHash: 'heartbeat', outputIndex: 1, datum: 'same-root-datum' });

    await expect(resolveProofContextForQuery({
      ...deps, context: 'test', lightClientMode: 'mithril', maxAttempts: 1, delayMs: 0,
    })).rejects.toThrow(StaleIbcTreeStateError);
  });

  it('binds stability acceptance to the captured HostState transaction', async () => {
    const tree = makeTree('first');
    const deps = makeDeps(tree);
    deps.mocks.historyService.findBlockByHeight.mockResolvedValue({ height: 200, hash: 'anchor-200' });
    const acceptance = jest.spyOn(stabilityEvidence, 'loadStakeWeightedStabilityEvidenceForTxHash')
      .mockResolvedValue({ anchorHeight: 200n, anchorBlock: { hash: 'anchor-200' } } as never);
    try {
      const context = await resolveProofContextForQuery({
        ...deps, context: 'test', lightClientMode: 'stake-weighted-stability', maxAttempts: 1, delayMs: 0,
      });
      expect(acceptance).toHaveBeenCalledWith(expect.objectContaining({ txHash: 'live-host-state' }));
      expect(context.tree.getRoot()).toBe(tree.getRoot());
      expect(context.proofHeight).toBe(200n);
      expect(context.anchorBlockHash).toBe('anchor-200');
      expect(deps.mocks.lucidService.findUtxoAtHostStateNFT).not.toHaveBeenCalled();
    } finally {
      acceptance.mockRestore();
    }
  });

  it('rejects an accepted HostState datum whose root differs from the captured tree', async () => {
    const deps = makeDeps(makeTree('first'));
    deps.mocks.lucidService.decodeDatum.mockResolvedValue({ state: { ibc_state_root: makeTree('other').getRoot() } });
    await expect(resolveProofContextForQuery({
      ...deps, context: 'test', lightClientMode: 'mithril', maxAttempts: 1, delayMs: 0,
    })).rejects.toThrow(/does not match the captured tree/);
  });
});
