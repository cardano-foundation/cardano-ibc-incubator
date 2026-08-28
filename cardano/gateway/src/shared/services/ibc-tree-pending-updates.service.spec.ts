import { IbcTreePendingUpdatesService } from './ibc-tree-pending-updates.service';

describe('IbcTreePendingUpdatesService', () => {
  it('uses an expected-root fallback only when it identifies one transaction', () => {
    const service = new IbcTreePendingUpdatesService();
    const first = { expectedNewRoot: 'same-root', commit: jest.fn() };
    const second = { expectedNewRoot: 'same-root', commit: jest.fn() };

    service.register('first-hash', first);
    service.register('second-hash', second);

    expect(service.takeByExpectedRoot('same-root')).toBeUndefined();
    expect(service.take('first-hash')).toBe(first);
    expect(service.takeByExpectedRoot('same-root')).toBe(second);
  });
});
