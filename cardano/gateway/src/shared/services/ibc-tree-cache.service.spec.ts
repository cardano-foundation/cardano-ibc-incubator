import { EntityManager } from 'typeorm';
import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';
import {
  DEFAULT_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS,
  IbcTreeCacheService,
  MAX_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS,
  MIN_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS,
  resolveIbcTreeCacheStatementTimeoutMs,
} from './ibc-tree-cache.service';

function makeTree(): ICS23MerkleTree {
  const tree = new ICS23MerkleTree();
  tree.set('ibc/test', Buffer.from('value'));
  return tree;
}

describe('IbcTreeCacheService', () => {
  const originalTimeout = process.env.IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS;
    } else {
      process.env.IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS = originalTimeout;
    }
  });

  it('applies a parameterized transaction-local timeout to cache writes', async () => {
    process.env.IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS = '2500';
    const query = jest.fn().mockResolvedValue([]);
    const entityManager = {
      transaction: jest.fn(async (operation) => operation({ query })),
    } as unknown as EntityManager;
    const service = new IbcTreeCacheService(entityManager);

    await service.save(makeTree(), 'current');

    expect(entityManager.transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(1, `SELECT set_config('statement_timeout', $1, true);`, ['2500ms']);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO ibc_state_tree_cache'),
      expect.arrayContaining(['current']),
    );
  });

  it('attempts every alias before reporting an aggregate write failure', async () => {
    const attemptedIds: string[] = [];
    const query = jest.fn().mockImplementation(async (sql: string, parameters: unknown[]) => {
      if (!sql.includes('INSERT INTO ibc_state_tree_cache')) {
        return [];
      }

      const id = parameters[0] as string;
      attemptedIds.push(id);
      if (id === 'current') {
        throw new Error('canceling statement due to statement timeout');
      }
      return [];
    });
    const entityManager = {
      transaction: jest.fn(async (operation) => operation({ query })),
    } as unknown as EntityManager;
    const service = new IbcTreeCacheService(entityManager);

    await expect(service.saveAliases(makeTree(), ['current', 'root:abc', 'height:123', 'root:abc'])).rejects.toThrow(
      'Failed to persist 1 of 3 IBC state tree cache aliases',
    );

    expect(attemptedIds).toEqual(expect.arrayContaining(['current', 'root:abc', 'height:123']));
    expect(attemptedIds).toHaveLength(3);
  });

  it('validates and clamps the configured statement timeout', () => {
    expect(resolveIbcTreeCacheStatementTimeoutMs()).toBe(DEFAULT_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS);
    expect(resolveIbcTreeCacheStatementTimeoutMs('not-a-number')).toBe(DEFAULT_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS);
    expect(resolveIbcTreeCacheStatementTimeoutMs('0')).toBe(DEFAULT_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS);
    expect(resolveIbcTreeCacheStatementTimeoutMs('1')).toBe(MIN_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS);
    expect(resolveIbcTreeCacheStatementTimeoutMs('999999')).toBe(MAX_IBC_TREE_CACHE_STATEMENT_TIMEOUT_MS);
  });
});
