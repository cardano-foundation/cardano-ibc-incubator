import {
  IbcTreePendingUpdatesService,
  MAX_PENDING_TREE_UPDATES,
  PENDING_TREE_UPDATE_RETENTION_MS,
} from './ibc-tree-pending-updates.service';

describe('IbcTreePendingUpdatesService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('expires abandoned in-memory updates while durable recovery remains authoritative', () => {
    const service = new IbcTreePendingUpdatesService();
    const now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    service.register('AA', { expectedNewRoot: 'root-a', commit: jest.fn() });

    nowSpy.mockReturnValue(now + PENDING_TREE_UPDATE_RETENTION_MS);

    expect(service.take('aa')).toBeUndefined();
  });

  it('stays bounded without evicting a still-valid cached candidate', () => {
    const service = new IbcTreePendingUpdatesService();
    jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
    for (let index = 0; index < MAX_PENDING_TREE_UPDATES; index += 1) {
      service.register(`tx-${index}`, { expectedNewRoot: `root-${index}`, commit: jest.fn() });
    }

    service.register('overflow', { expectedNewRoot: 'overflow-root', commit: jest.fn() });

    expect(service.take('tx-0')).toMatchObject({ expectedNewRoot: 'root-0' });
    expect(service.take('overflow')).toBeUndefined();
  });
});
