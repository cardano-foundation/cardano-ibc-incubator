import zlib from 'zlib';
import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';
import { IbcTreeCacheService, ibcTreeCacheIdForHostState } from './ibc-tree-cache.service';

describe('IbcTreeCacheService snapshot persistence', () => {
  it('keeps separate historical snapshots for HostState outputs sharing a root', async () => {
    const rows = new Map<string, { root: string; leaves_gzip: Buffer }>();
    const entityManager = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO')) {
          const [id, root, payload] = params as [string, string, Buffer];
          rows.set(id, { root, leaves_gzip: payload });
          return [];
        }
        const row = rows.get(params[0] as string);
        return row ? [row] : [];
      }),
    };
    const cache = new IbcTreeCacheService(entityManager as any);
    const tree = new ICS23MerkleTree();
    tree.set('ports/transfer', '01');
    const first = { txHash: 'aa'.repeat(32), outputIndex: 0 };
    const heartbeat = { txHash: 'bb'.repeat(32), outputIndex: 1 };
    for (const ref of [first, heartbeat]) {
      await cache.saveAliases(tree, [ibcTreeCacheIdForHostState(ref)], ref);
    }
    expect(rows.size).toBe(2);
    for (const ref of [first, heartbeat]) {
      const id = ibcTreeCacheIdForHostState(ref);
      const payload = JSON.parse(zlib.gunzipSync(rows.get(id)!.leaves_gzip).toString('utf8'));
      expect(payload.hostState).toEqual(ref);
      const loaded = await cache.load(id);
      expect(loaded!.root).toBe(tree.getRoot());
      expect(loaded!.tree.toJSON()).toEqual(tree.toJSON());
    }
  });
});
