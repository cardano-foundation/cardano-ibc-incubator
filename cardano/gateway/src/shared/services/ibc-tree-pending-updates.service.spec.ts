import {
  IbcTreePendingUpdatesService,
  PENDING_TREE_UPDATE_CACHE_MAX_ENTRIES,
  PENDING_TREE_UPDATE_CACHE_TTL_MS,
} from './ibc-tree-pending-updates.service';

describe('IbcTreePendingUpdatesService cache lifecycle', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the cache bounded and evicts the oldest abandoned update', () => {
    const service = new IbcTreePendingUpdatesService();
    for (let index = 0; index <= PENDING_TREE_UPDATE_CACHE_MAX_ENTRIES; index += 1) {
      service.register(`tx-${index}`, {
        expectedNewRoot: `root-${index}`,
        commit: jest.fn(),
      });
    }

    expect((service as any).pendingByTxHash.size).toBe(PENDING_TREE_UPDATE_CACHE_MAX_ENTRIES);
    expect(service.peek('tx-0')).toBeUndefined();
    expect(service.peek(`tx-${PENDING_TREE_UPDATE_CACHE_MAX_ENTRIES}`)).toBeDefined();
  });

  it('expires an abandoned update and updates its cache gauge', async () => {
    jest.useFakeTimers();
    const metrics = { setCacheEntries: jest.fn() };
    const service = new IbcTreePendingUpdatesService(metrics as any);

    service.register('ABC', { expectedNewRoot: 'root', commit: jest.fn() });
    expect(service.peek('abc')).toBeDefined();
    await jest.advanceTimersByTimeAsync(PENDING_TREE_UPDATE_CACHE_TTL_MS);

    expect(service.peek('abc')).toBeUndefined();
    expect(metrics.setCacheEntries).toHaveBeenLastCalledWith('ibc_tree_pending_updates', 0);
  });

  it('retains an update when commit fails and removes it after a successful retry', async () => {
    const service = new IbcTreePendingUpdatesService();
    const hostState = { txHash: 'ab'.repeat(32), outputIndex: 0 };
    const publication = { published: false, snapshot: { root: 'root', hostState } };
    const commit = jest.fn().mockImplementationOnce(() => {
      throw new Error('transient failure');
    }).mockResolvedValue(publication);
    const update = { expectedNewRoot: 'root', commit };
    service.register('tx', update);

    await expect(service.commit('tx', update, hostState)).rejects.toThrow('transient failure');
    expect(service.peek('tx')).toBe(update);
    await expect(service.commit('tx', update, hostState)).resolves.toBe(publication);
    expect(service.peek('tx')).toBeUndefined();
  });

  it('returns a completed confirmation even if the pending entry expires while it waits', async () => {
    jest.useFakeTimers();
    const service = new IbcTreePendingUpdatesService();
    const hostState = { txHash: 'ab'.repeat(32), outputIndex: 0 };
    const publication = { published: false, snapshot: { root: 'root', hostState } };
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const update = { expectedNewRoot: 'root', commit: jest.fn(async () => { await wait; return publication; }) };
    service.register('tx', update as any);
    const confirmation = service.commit('tx', update as any, hostState);
    await jest.advanceTimersByTimeAsync(PENDING_TREE_UPDATE_CACHE_TTL_MS);
    expect(service.peek('tx')).toBeUndefined();
    release();
    await expect(confirmation).resolves.toBe(publication);
  });
  it('does not match a tree-neutral update through the expected-root fallback', () => {
    const service = new IbcTreePendingUpdatesService();
    const neutralUpdate = { kind: 'tree_neutral' as const, expectedNewRoot: 'root', commit: jest.fn() };
    const treeUpdate = { kind: 'tree_update' as const, expectedNewRoot: 'root', commit: jest.fn() };
    service.register('neutral-tx', neutralUpdate);
    service.register('tree-tx', treeUpdate);

    expect(service.takeByExpectedRoot('root')).toBe(treeUpdate);
    expect(service.peek('neutral-tx')).toBe(neutralUpdate);
  });

  it('retains a neutral update after failure and acknowledges its exact successful retry', async () => {
    const service = new IbcTreePendingUpdatesService();
    const update = {
      kind: 'tree_neutral' as const,
      expectedNewRoot: '',
      commit: jest.fn().mockRejectedValueOnce(new Error('transient failure')).mockResolvedValue(undefined),
    };
    service.register('tx', update);

    await expect(service.commitNeutral('tx', { ...update })).resolves.toBe(false);
    expect(update.commit).not.toHaveBeenCalled();
    await expect(service.commitNeutral('tx', update)).rejects.toThrow('transient failure');
    expect(service.peek('tx')).toBe(update);
    await expect(service.commitNeutral('tx', update)).resolves.toBe(true);
    expect(service.peek('tx')).toBeUndefined();
  });

  it('waits for neutral acknowledgement and preserves a replacement registration', async () => {
    const service = new IbcTreePendingUpdatesService();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const update = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn(() => wait) };
    const replacement = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn() };
    service.register('tx', update);
    const confirmation = service.commitNeutral('tx', update);
    expect(service.peek('tx')).toBe(update);
    service.register('tx', replacement);
    release();

    await expect(confirmation).resolves.toBe(true);
    expect(service.peek('tx')).toBe(replacement);
  });
});
