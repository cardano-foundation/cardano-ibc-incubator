import { EntityManager } from 'typeorm';

import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';
import { IbcTreeCacheService } from './ibc-tree-cache.service';

describe('IbcTreeCacheService persisted transaction events', () => {
  const events = [
    {
      type: 'update_client',
      attributes: [
        { key: 'client_id', value: '07-tendermint-0' },
        { key: 'client_message_any_hex', value: '0a03616263' },
      ],
    },
  ];

  it('persists events under a normalized expected root and unsigned hash', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'pending-tx:ccdd' }]);
    const service = new IbcTreeCacheService({ query } as unknown as EntityManager);
    const tree = new ICS23MerkleTree();
    tree.set('clients/07-tendermint-0/clientState', Buffer.from('client'));
    const expectedRoot = tree.getRoot();
    const expiresAtMs = Date.now() + 60_000;

    await service.savePendingProofState(expectedRoot.toUpperCase(), 'CCDD', events, tree, expiresAtMs);

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[2][0]).toContain('DELETE FROM ibc_gateway_tx_events');
    expect(query.mock.calls[2][0]).toContain('confirmed_tx_hash IS NULL');
    expect(query.mock.calls[2][0]).toContain('expires_at <= NOW()');
    expect(query.mock.calls[3][0]).toContain('WITH saved_event AS');
    expect(query.mock.calls[3][0]).toContain('ON CONFLICT (unsigned_tx_hash)');
    expect(query.mock.calls[3][1]).toEqual([
      'pending-tx:ccdd',
      expectedRoot,
      expect.any(Buffer),
      'ccdd',
      JSON.stringify(events),
      new Date(expiresAtMs).toISOString(),
    ]);
  });

  it('binds and reloads events by the confirmed transaction hash', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ expected_root: 'aabb' }])
      .mockResolvedValueOnce([{ events_json: JSON.stringify(events) }]);
    const service = new IbcTreeCacheService({ query } as unknown as EntityManager);

    await expect(service.bindTxEventsToConfirmedTransaction('CCDD', 'AABB', 'EEFF')).resolves.toBe(true);
    await expect(service.loadTxEventsByConfirmedHash('EEFF')).resolves.toEqual(events);

    expect(query.mock.calls[1][1]).toEqual(['ccdd', 'aabb', 'eeff']);
    expect(query.mock.calls[2][1]).toEqual(['eeff']);
  });

  it('refuses root fallback when more than one unsigned transaction has the same root', async () => {
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const service = new IbcTreeCacheService({ query } as unknown as EntityManager);

    await expect(service.bindTxEventsToConfirmedTransaction('missing', 'same-root', 'confirmed')).resolves.toBe(false);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toContain('HAVING COUNT(*) = 1');
    expect(query.mock.calls[2][0]).toContain('expires_at > NOW()');
  });

  it('replays an unbound event by the unsigned Cardano transaction id after restart', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ events_json: events }]);
    const service = new IbcTreeCacheService({ query } as unknown as EntityManager);

    await expect(service.loadTxEventsByConfirmedHash('AABB')).resolves.toEqual(events);

    expect(query.mock.calls[1][0]).toContain('unsigned_tx_hash = $1');
    expect(query.mock.calls[1][1]).toEqual(['aabb']);
  });

  it('rejects malformed persisted event data', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ events_json: [{ type: 'update_client', attributes: [{}] }] }]);
    const service = new IbcTreeCacheService({ query } as unknown as EntityManager);

    await expect(service.loadTxEventsByConfirmedHash('eeff')).rejects.toThrow(
      'Persisted transaction events have an invalid shape',
    );
  });
});
