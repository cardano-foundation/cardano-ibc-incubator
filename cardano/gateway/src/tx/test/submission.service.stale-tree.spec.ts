import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { IbcTreeSnapshot } from '../../shared/helpers/ibc-state-root';
import { IbcTreePendingUpdatesService } from '../../shared/services/ibc-tree-pending-updates.service';
import { createTestTreeContext } from '../../shared/testing/ibc-tree-test-store';
import { SubmissionService } from '../submission.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  return { promise, resolve };
}

describe('SubmissionService stale tree publication', () => {
  let cacheSetting: string | undefined;
  beforeEach(() => {
    cacheSetting = process.env.IBC_TREE_CACHE_ENABLED;
    process.env.IBC_TREE_CACHE_ENABLED = 'true';
  });
  afterEach(() => {
    if (cacheSetting === undefined) delete process.env.IBC_TREE_CACHE_ENABLED;
    else process.env.IBC_TREE_CACHE_ENABLED = cacheSetting;
  });

  async function setup() {
    const fixture = createTestTreeContext();
    await fixture.restore(new ICS23MerkleTree());
    const refA = { txHash: 'aa'.repeat(32), outputIndex: 0 };
    const refB = { txHash: 'bb'.repeat(32), outputIndex: 1 };
    const updateA = fixture.store.computeRootWithPortBind(fixture.store.getCurrentRoot(), 'a', Buffer.from('01', 'hex'));
    const treeA = new ICS23MerkleTree();
    treeA.set('ports/a', '01');
    // A was indexed and rebuilt while its confirmation response was delayed.
    await fixture.restore(treeA, refA);
    const updateB = fixture.store.computeRootWithPortBind(updateA.newRoot, 'b', Buffer.from('02', 'hex'));
    const publishedB = await fixture.commit(updateB, refB);
    expect(publishedB.published).toBe(true);
    const pending = new IbcTreePendingUpdatesService();
    pending.register(refA.txHash, { expectedNewRoot: updateA.newRoot, commit: updateA.commit });
    const cache = { saveAliases: jest.fn().mockResolvedValue(undefined) };
    const service = new SubmissionService(
      {} as any, {} as any,
      { take: jest.fn(() => []), takeByExpectedRoot: jest.fn(() => []) } as any,
      pending, cache as any, {} as any,
      { queryPacketEventsByTxHash: jest.fn().mockResolvedValue({ events: [] }) } as any, fixture.store,
    );
    return { fixture, refA, refB, updateA, treeA, publishedB, pending, cache, service };
  }

  it('acknowledges a late A confirmation and caches A without replacing current B', async () => {
    const { fixture, refA, refB, updateA, treeA, publishedB, pending, cache, service } = await setup();
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockResolvedValue({ blockNo: 100 });
    jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockReturnValue('body-a');
    jest.spyOn(service as any, 'readConfirmedHostStateFromBody').mockResolvedValue({
      root: updateA.newRoot, outputIndex: refA.outputIndex, datumCborHex: 'd87980',
    });

    await expect(service.observeTransaction({ tx_hash: refA.txHash })).resolves.toEqual({
      tx_hash: refA.txHash, height: '0-100', events: [],
    });

    expect(pending.peek(refA.txHash)).toBeUndefined();
    expect(fixture.store.getSnapshot().hostState).toEqual(refB);
    expect(fixture.store.getCurrentRoot()).toBe(publishedB.snapshot.root);
    const [historicalTree, historicalIds, historicalRef] = cache.saveAliases.mock.calls[0];
    expect(historicalTree.toJSON()).toEqual(treeA.toJSON());
    expect(historicalIds).toEqual([`root:${updateA.newRoot}`, `host-state:${refA.txHash}#0`]);
    expect(historicalRef).toEqual(refA);
    const [currentTree, currentIds, currentRef] = cache.saveAliases.mock.calls[1];
    expect(currentTree.getRoot()).toBe(publishedB.snapshot.root);
    expect(currentIds).toEqual(['current']);
    expect(currentRef).toEqual(refB);
  });

  it('serializes cache writes and reads current state after an older write finishes', async () => {
    const { fixture, refA, refB, treeA, publishedB, cache, service } = await setup();
    const entered = deferred();
    const release = deferred();
    cache.saveAliases.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const historicalA: IbcTreeSnapshot = { tree: treeA, root: treeA.getRoot(), hostState: refA };
    const first = (service as any).persistIbcTreeUpdate(historicalA, refA.txHash, 100n);
    await entered.promise;
    const second = (service as any).persistIbcTreeUpdate(publishedB.snapshot, refB.txHash, 101n);
    expect(cache.saveAliases).toHaveBeenCalledTimes(1);
    release.resolve();
    await Promise.all([first, second]);

    const currentWrites = cache.saveAliases.mock.calls.filter(([, ids]) => ids.includes('current'));
    expect(currentWrites).toHaveLength(2);
    for (const [tree, , hostState] of currentWrites) {
      expect(tree.getRoot()).toBe(fixture.store.getCurrentRoot());
      expect(hostState).toEqual(refB);
    }
  });

  it('refreshes the current cache if a rollback is published while its database write waits', async () => {
    const { fixture, refA, refB, treeA, publishedB, cache, service } = await setup();
    const entered = deferred();
    const release = deferred();
    let pauseCurrent = true;
    cache.saveAliases.mockImplementation(async (_tree, ids) => {
      if (ids.includes('current') && pauseCurrent) {
        pauseCurrent = false;
        entered.resolve();
        await release.promise;
      }
    });
    const write = (service as any).persistIbcTreeUpdate(publishedB.snapshot, refB.txHash, 101n);
    await entered.promise;
    await fixture.restore(treeA, refA);
    release.resolve();
    await write;

    const [tree, ids, hostState] = cache.saveAliases.mock.calls.at(-1)!;
    expect(tree.getRoot()).toBe(treeA.getRoot());
    expect(ids).toEqual(['current']);
    expect(hostState).toEqual(refA);
  });
});
