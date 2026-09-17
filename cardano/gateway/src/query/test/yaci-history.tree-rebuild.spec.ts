import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { StaleIbcTreeStateError } from '../../shared/helpers/ibc-state-root';
import { reconstructHistoricalIbcTree } from '../services/historical-ibc-tree';
import { YaciHistoryService } from '../services/yaci-history.service';

jest.mock('../services/historical-ibc-tree', () => ({ reconstructHistoricalIbcTree: jest.fn() }));

const host = { txHash: '11'.repeat(32), outputIndex: 0 };
const blockHash = '22'.repeat(32);
function fixture() {
  const tree = new ICS23MerkleTree();
  tree.set('clients/client-0/clientState', Buffer.from('old'));
  const snapshot = { root: tree.getRoot(), tree, hostState: host, blockHash };
  const query = jest.fn(async () => []);
  const database = {
    transaction: jest.fn(async (_isolation, read) => read({ query })),
    query: jest.fn(async () => [{ hash: blockHash }]),
  };
  const config = { getOrThrow: jest.fn((name) => name === 'cardanoNetwork' ? 'Custom' : {}) };
  const service = new YaciHistoryService(config as unknown as ConfigService, {} as never, database as unknown as EntityManager);
  (reconstructHistoricalIbcTree as jest.Mock).mockResolvedValue(snapshot);
  return { service, database, query, snapshot };
}

describe('Yaci historical tree snapshot lifecycle', () => {
  beforeEach(() => jest.resetAllMocks());

  it('uses a read-only repeatable snapshot and checks canonicality again after committing it', async () => {
    const { service, database, query, snapshot } = fixture();
    const result = await service.rebuildIbcStateTreeAtBlock(100n, host);
    expect(database.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(query.mock.calls).toEqual([['SET TRANSACTION READ ONLY'], ['SET LOCAL statement_timeout = 30000']]);
    expect(database.query).toHaveBeenCalledWith('SELECT hash FROM block WHERE number = $1', ['100']);
    expect(result.root).toBe(snapshot.root);
    expect(result.tree).not.toBe(snapshot.tree);
  });

  it('rejects a block rolled back while rebuilding and allows a later retry', async () => {
    const { service, database, snapshot } = fixture();
    database.query.mockResolvedValueOnce([{ hash: 'ff'.repeat(32) }]);
    await expect(service.rebuildIbcStateTreeAtBlock(100n, host)).rejects.toThrow(StaleIbcTreeStateError);
    await expect(service.rebuildIbcStateTreeAtBlock(100n, host)).resolves.toMatchObject({ root: snapshot.root });
    expect(database.transaction).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests while returning independent tree copies', async () => {
    const { service, database, snapshot } = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    (reconstructHistoricalIbcTree as jest.Mock).mockImplementation(async () => { await waiting; return snapshot; });
    const first = service.rebuildIbcStateTreeAtBlock(100n, host);
    const second = service.rebuildIbcStateTreeAtBlock(100n, host);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    a.tree.set('extra', Buffer.from('mutation'));
    expect(b.tree.getRoot()).toBe(snapshot.root);
  });

  it('bounds parallel rebuilds and releases capacity after failures', async () => {
    const { service, snapshot } = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    (reconstructHistoricalIbcTree as jest.Mock).mockImplementation(async () => { await waiting; throw new Error('history unavailable'); });
    const pending = [1n, 2n, 3n, 4n].map((height) => service.rebuildIbcStateTreeAtBlock(height, host));
    const settled = Promise.allSettled(pending);
    await expect(service.rebuildIbcStateTreeAtBlock(5n, host)).rejects.toThrow('capacity');
    release();
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
    (reconstructHistoricalIbcTree as jest.Mock).mockResolvedValue(snapshot);
    await expect(service.rebuildIbcStateTreeAtBlock(5n, host)).resolves.toMatchObject({ root: snapshot.root });
  });
});
