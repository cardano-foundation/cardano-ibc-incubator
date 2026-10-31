import { PacketLaneTree } from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';
import { PacketStateService } from './packet-state.service';

function fixture() {
  const trees = Array.from({ length: 4 }, () => new PacketLaneTree());
  for (let sequence = 1n; sequence <= 64n; sequence++) {
    const tree = trees[Number(sequence % 4n)];
    tree.set(`acks/ports/transfer/channels/channel-0/sequences/${sequence}`, 'ab'.repeat(32));
    if (sequence <= 32n) tree.set(`receipts/ports/transfer/channels/channel-0/sequences/${sequence}`, '01');
  }
  const history = { findBlockByHeight: jest.fn(async () => ({ hash: 'canonical' })) };
  const service = new PacketStateService(
    { getOrThrow: () => ({ packetState: { laneCount: 4 } }) } as any, {} as any, history as any, {} as any,
  );
  jest.spyOn(service, 'height').mockResolvedValue(42n);
  const lane = jest.spyOn(service, 'lane').mockImplementation(async (_port, _channel, index) => ({ tree: trees[index].tree }) as any);
  const pages = trees.map(tree => jest.spyOn(tree.tree, 'entriesPage'));
  for (const tree of trees) jest.spyOn(tree.tree, 'getKeys').mockImplementation(() => { throw new Error('whole-history enumeration'); });
  return { service, lane, pages, history, trees, close: () => trees.forEach(tree => tree.tree.store.db.close()) };
}

describe('indexed packet sequence queries', () => {
  it('paginates before materialization in sequence order across lanes', async () => {
    const f = fixture();
    try {
      const page = await f.service.entries('transfer', 'channel-0', 'acks', 42n, { offset: 31, limit: 4 });
      expect([...page.entries.keys()]).toEqual([32n, 33n, 34n, 35n]);
      expect(page.total).toBe(64);
      expect(page.hasMore).toBe(true);
      expect(f.pages.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBeLessThanOrEqual(7);
      expect(f.pages.flatMap(spy => spy.mock.calls).every(args => args[2] === 1)).toBe(true);
    } finally { f.close(); }
  });

  it('supports reverse pages, past-end offsets and an incomplete final page', async () => {
    const f = fixture();
    try {
      expect([...(await f.service.entries('transfer', 'channel-0', 'acks', 42n, { offset: 5, limit: 3, reverse: true })).entries.keys()]).toEqual([59n, 58n, 57n]);
      expect([...(await f.service.entries('transfer', 'channel-0', 'acks', 42n, { offset: 62, limit: 5 })).entries.keys()]).toEqual([63n, 64n]);
      expect((await f.service.entries('transfer', 'channel-0', 'acks', 42n, { offset: 64, limit: 5 })).entries.size).toBe(0);
    } finally { f.close(); }
  });

  it('looks up only requested sequences and their lanes without enumerating entries', async () => {
    const f = fixture();
    try {
      const page = await f.service.entries('transfer', 'channel-0', 'receipts', 42n, { sequences: [1n, 17n, 33n, 101n] });
      expect([...page.entries.keys()]).toEqual([1n, 17n]);
      expect(f.lane).toHaveBeenCalledTimes(1);
      expect(f.lane).toHaveBeenCalledWith('transfer', 'channel-0', 1, 42n);
      expect(f.pages.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally { f.close(); }
  });

  it('rejects a rollback while a page is being constructed', async () => {
    const f = fixture();
    try {
      f.history.findBlockByHeight.mockResolvedValueOnce({ hash: 'canonical' }).mockResolvedValueOnce({ hash: 'rolled-back' });
      await expect(f.service.entries('transfer', 'channel-0', 'acks', 42n, { limit: 1 })).rejects.toThrow('rolled back');
    } finally { f.close(); }
  });

  it('selects cross-lane ranks with gaps from acknowledgements that were pruned', async () => {
    const f = fixture();
    try {
      for (const sequence of [2n, 5n, 7n, 33n, 63n, 64n]) f.trees[Number(sequence % 4n)].set(`acks/ports/transfer/channels/channel-0/sequences/${sequence}`, '');
      const forward = await f.service.entries('transfer', 'channel-0', 'acks', 42n, { offset: 29, limit: 4 });
      expect([...forward.entries.keys()]).toEqual([34n, 35n, 36n, 37n]);
      expect(forward.total).toBe(58);
      expect([...(await f.service.entries('transfer', 'channel-0', 'acks', 42n, { offset: 29, limit: 4, reverse: true })).entries.keys()]).toEqual([32n, 31n, 30n, 29n]);
    } finally { f.close(); }
  });
});
