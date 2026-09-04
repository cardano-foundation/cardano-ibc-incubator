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

  it('retains an update when commit fails and removes it after a successful retry', () => {
    const service = new IbcTreePendingUpdatesService();
    const commit = jest.fn().mockImplementationOnce(() => {
      throw new Error('transient failure');
    });
    const update = { expectedNewRoot: 'root', commit };
    service.register('tx', update);

    expect(() => service.commit('tx', update)).toThrow('transient failure');
    expect(service.peek('tx')).toBe(update);
    expect(service.commit('tx', update)).toBe(true);
    expect(service.peek('tx')).toBeUndefined();
  });
});
