import {
  CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_MAX_ENTRIES,
  EPOCH_LOOKUP_MAX_ENTRIES,
  EPOCH_PARAMS_CACHE_MAX_ENTRIES,
  HISTORICAL_EPOCH_CONTEXT_CACHE_MAX_ENTRIES,
  YaciHistoryService,
} from '../services/yaci-history.service';

describe('YaciHistoryService cache bounds', () => {
  const makeService = (metrics?: { setCacheEntries: jest.Mock }) =>
    new YaciHistoryService({ get: jest.fn() } as any, {} as any, { query: jest.fn() } as any, metrics as any);

  it('bounds retained epoch data and concurrent lookup maps', () => {
    const caches = makeService() as any;
    const cases: Array<[string, number, (index: number) => unknown]> = [
      ['epochNonceCache', EPOCH_PARAMS_CACHE_MAX_ENTRIES, (index) => `nonce-${index}`],
      ['epochNonceLookups', EPOCH_LOOKUP_MAX_ENTRIES, (index) => Promise.resolve(`nonce-${index}`)],
      [
        'historicalEpochContextCache',
        HISTORICAL_EPOCH_CONTEXT_CACHE_MAX_ENTRIES,
        (index) => ({ epoch: index, stakeDistribution: [], verificationContext: {} }),
      ],
      [
        'historicalEpochContextLookups',
        EPOCH_LOOKUP_MAX_ENTRIES,
        (index) => Promise.resolve({ epoch: index, stakeDistribution: [], verificationContext: {} }),
      ],
      ['currentEpochStakeSnapshotCache', CURRENT_EPOCH_STAKE_SNAPSHOT_CACHE_MAX_ENTRIES, () => []],
      ['currentEpochStakeSnapshotLookups', EPOCH_LOOKUP_MAX_ENTRIES, () => Promise.resolve([])],
    ];

    for (const [cacheName, maxEntries, value] of cases) {
      const cache = caches[cacheName];
      for (let index = 0; index <= maxEntries; index += 1) {
        cache.set(`key-${index}`, value(index));
      }
      expect(cache.size).toBe(maxEntries);
      expect(cache.get('key-0')).toBeUndefined();
    }
  });

  it('reports epoch cache sizes through the shared cache gauge', () => {
    const metrics = { setCacheEntries: jest.fn() };
    const service = makeService(metrics) as any;

    service.historicalEpochContextCache.set('epoch-7', {
      epoch: 7,
      stakeDistribution: [],
      verificationContext: {},
    });

    expect(metrics.setCacheEntries).toHaveBeenCalledWith('historical_epoch_context', 1);
    expect(metrics.setCacheEntries).toHaveBeenCalledWith('current_epoch_stake_snapshot', 0);
    expect(metrics.setCacheEntries).toHaveBeenCalledWith('epoch_nonce_lookups', 0);
  });
});
