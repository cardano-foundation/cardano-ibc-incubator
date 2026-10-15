import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';
import { YaciRestHistory } from '../../shared/helpers/yaci-rest-history';
import { reconstructHistoricalIbcTree } from '../services/historical-ibc-tree';
import { YaciHistoryService } from '../services/yaci-history.service';
import { YaciRestClient } from '../../shared/helpers/yaci-rest';

jest.mock('../services/historical-ibc-tree', () => ({ reconstructHistoricalIbcTree: jest.fn() }));

const host = { txHash: '11'.repeat(32), outputIndex: 0 };
const blockHash = '22'.repeat(32);
function fixture() {
  const tree = new ICS23MerkleTree();
  tree.set('clients/client-0/clientState', Buffer.from('old'));
  const snapshot = { root: tree.getRoot(), tree, hostState: host, blockHash };
  const query = jest.fn(async (sql: string) => sql.startsWith('SELECT') ? [{ number: '100', hash: blockHash }] : []);
  const remote = jest.spyOn(YaciRestClient.prototype, 'block').mockResolvedValue({ number: 100, hash: blockHash } as never);
  const database = {
    transaction: jest.fn(async (_isolation, read) => read({ query })),
    query: jest.fn(async () => [{ hash: blockHash }]),
  };
  const config = { get: () => 'https://yaci.example', getOrThrow: jest.fn((name) => name === 'cardanoNetwork' ? 'Custom' : {}) };
  const service = new YaciHistoryService(config as unknown as ConfigService, {} as never, database as unknown as EntityManager);
  (reconstructHistoricalIbcTree as jest.Mock).mockResolvedValue(snapshot);
  return { service, database, query, snapshot, remote };
}

describe('Yaci historical tree snapshot lifecycle', () => {
  beforeEach(() => jest.resetAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('reads REST history and rechecks its anchor without leasing a database connection', async () => {
    const { service, database, query, snapshot } = fixture();
    const result = await service.rebuildIbcStateTreeAtBlock(100n, host);
    expect(database.transaction).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(reconstructHistoricalIbcTree).toHaveBeenCalledWith(expect.any(YaciRestHistory), expect.anything(), 'Custom', expect.anything(), 100n, host);
    expect(YaciRestClient.prototype.block).toHaveBeenCalledWith(100n);
    expect(database.query).not.toHaveBeenCalled();
    expect(result.root).toBe(snapshot.root);
    expect(result.tree).not.toBe(snapshot.tree);
  });

  it('rejects a block rolled back while rebuilding and allows a later retry', async () => {
    const { service, database, snapshot, remote } = fixture();
    remote.mockResolvedValueOnce({ number: 100, hash: blockHash } as never).mockResolvedValueOnce({ number: 100, hash: 'ff'.repeat(32) } as never);
    await expect(service.rebuildIbcStateTreeAtBlock(100n, host)).rejects.toThrow(YaciRestHistoryChangedError);
    await expect(service.rebuildIbcStateTreeAtBlock(100n, host)).resolves.toMatchObject({ root: snapshot.root });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('coalesces concurrent requests while returning independent tree copies', async () => {
    const { service, snapshot } = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    (reconstructHistoricalIbcTree as jest.Mock).mockImplementation(async () => { await waiting; return snapshot; });
    const first = service.rebuildIbcStateTreeAtBlock(100n, host);
    const second = service.rebuildIbcStateTreeAtBlock(100n, host);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(reconstructHistoricalIbcTree).toHaveBeenCalledTimes(1);
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
