import {
  IbcTreePendingUpdatesService,
  type PendingTreeUpdate,
} from './ibc-tree-pending-updates.service';

const pendingUpdate = (expectedNewRoot: string): PendingTreeUpdate => ({
  expectedNewRoot,
  commit: jest.fn(),
});

describe('IbcTreePendingUpdatesService', () => {
  it('takes a unique pending update by its expected root', () => {
    const service = new IbcTreePendingUpdatesService();
    const update = pendingUpdate('root-a');
    service.register('tx-a', update);

    expect(service.takeByExpectedRoot('root-a')).toBe(update);
    expect(service.take('tx-a')).toBeUndefined();
  });

  it('does not guess or remove records when the expected root is ambiguous', () => {
    const service = new IbcTreePendingUpdatesService();
    const first = pendingUpdate('unchanged-root');
    const second = pendingUpdate('unchanged-root');
    service.register('tx-a', first);
    service.register('tx-b', second);

    expect(service.takeByExpectedRoot('unchanged-root')).toBeUndefined();
    expect(service.take('tx-a')).toBe(first);
    expect(service.take('tx-b')).toBe(second);
  });
});
