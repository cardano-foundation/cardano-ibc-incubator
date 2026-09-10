import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import type { UTxO } from '@lucid-evolution/lucid';
import { ConsensusHistoryRecovery } from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';
import { createYaciHistorySource, discoverYaciHistoryBootstrap } from '@cardano-ibc/tx-builder-runtime/consensusHistoryYaci';
import { ConsensusHistoryService } from './consensus-history.service';
import { ClientDatum } from '../../types/client-datum';

jest.mock('node:fs/promises', () => ({ mkdir: jest.fn(async () => undefined) }));
jest.mock('@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery', () => ({ ConsensusHistoryRecovery: jest.fn() }));
jest.mock('@cardano-ibc/tx-builder-runtime/consensusHistoryYaci', () => ({
  createYaciHistorySource: jest.fn(),
  discoverYaciHistoryBootstrap: jest.fn(),
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(sequence = 0) {
  const client = {
    token: { policyId: '11'.repeat(28), name: '22'.repeat(24) + Buffer.from(String(sequence)).toString('hex') },
    history_root: '33'.repeat(32),
  } as ClientDatum;
  const utxo: UTxO = {
    txHash: '44'.repeat(32), outputIndex: sequence, address: 'client-address',
    datum: 'datum', assets: { [client.token.policyId + client.token.name]: 1n },
  };
  return { client, utxo, readLive: jest.fn(async () => structuredClone(utxo)) };
}

function context(settings: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = {
    deployment: { hostStateNFT: { policyId: '55'.repeat(28), name: '01' } },
    cardanoNetwork: 'Preview', CONSENSUS_HISTORY_CACHE_DIR: '/unused-test-history-cache', ...settings,
  };
  const runners: any[] = [];
  const indexes: any[] = [];
  let beforeRecover: ((source: any) => Promise<void>) | undefined;
  const runnerFactory = jest.fn(() => {
    const connection = new EventEmitter();
    const runner = {
      connection,
      connect: jest.fn(async () => connection),
      query: jest.fn(async (_query: string) => []),
      release: jest.fn(async () => undefined),
      releasePostgresConnection: jest.fn(async (_error: Error) => undefined),
    };
    runners.push(runner);
    return runner;
  });
  (discoverYaciHistoryBootstrap as jest.Mock).mockImplementation(async (sql) => {
    await sql.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await sql.query('COMMIT');
    return { txHash: '66'.repeat(32), outputIndex: 0 };
  });
  (createYaciHistorySource as jest.Mock).mockImplementation((sql, deployment, readLive) => ({ sql, deployment, currentState: readLive }));
  (ConsensusHistoryRecovery as jest.Mock).mockImplementation((path, deployment) => {
    let anchor: UTxO;
    const index = {
      path, deployment,
      recover: jest.fn(async (source) => {
        if (beforeRecover) await beforeRecover(source);
        await source.currentState();
        anchor = await source.currentState();
      }),
      current: jest.fn(() => ({ utxo: anchor, root: '33'.repeat(32) })),
      insertionWitness: jest.fn(() => ({ root: '33'.repeat(32), newRoot: '77'.repeat(32) })),
      close: jest.fn(),
    };
    indexes.push(index);
    return index;
  });
  const service = new ConsensusHistoryService(
    { connection: { createQueryRunner: runnerFactory } } as unknown as EntityManager,
    { get: (key: string) => config[key], getOrThrow: (key: string) => config[key] } as ConfigService,
  );
  const insertion = (item = fixture()) => service.insertion(item.utxo, item.client, item.readLive);
  return { service, insertion, runners, indexes, runnerFactory, setBeforeRecover: (hook: typeof beforeRecover) => { beforeRecover = hook; } };
}

describe('ConsensusHistoryService bounded authenticated cache lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('reuses a warm client cache but rechecks creation and the supplied live outref/root', async () => {
    const ctx = context();
    const item = fixture();
    await ctx.insertion(item);
    await ctx.insertion(item);
    expect(ctx.indexes).toHaveLength(1);
    expect(discoverYaciHistoryBootstrap).toHaveBeenCalledTimes(2);
    expect(item.readLive).toHaveBeenCalledTimes(4);
    const stale = { ...item, utxo: { ...item.utxo, txHash: '88'.repeat(32) } };
    await expect(ctx.insertion(stale)).rejects.toThrow('Client changed');
    await expect(ctx.insertion({ ...item, client: { ...item.client, history_root: '99'.repeat(32) } })).rejects.toThrow('Client changed');
    expect(ctx.indexes[0].insertionWitness).toHaveBeenCalledTimes(2);
    expect(ctx.runners.every((runner) => runner.release.mock.calls.length === 1)).toBe(true);
    await ctx.service.onModuleDestroy();
  });

  it('switches a replaced creation to a bootstrap-bound file without deleting the old cache', async () => {
    const ctx = context();
    await ctx.insertion();
    (discoverYaciHistoryBootstrap as jest.Mock).mockResolvedValueOnce({ txHash: 'aa'.repeat(32), outputIndex: 1 });
    await ctx.insertion();
    expect(ctx.indexes).toHaveLength(2);
    expect(ctx.indexes[0].close).toHaveBeenCalledTimes(1);
    expect(ctx.indexes[1].path).not.toBe(ctx.indexes[0].path);
    expect(ctx.indexes[1].deployment.bootstrap).toEqual({ txHash: 'aa'.repeat(32), outputIndex: 1 });
    expect(ctx.indexes[1].recover).toHaveBeenCalledTimes(1);
    await ctx.service.onModuleDestroy();
  });

  it('evicts only the least recently used idle index at its configured capacity', async () => {
    const ctx = context({ CONSENSUS_HISTORY_MAX_OPEN_INDEXES: 2 });
    await ctx.insertion(fixture(0));
    await ctx.insertion(fixture(1));
    await ctx.insertion(fixture(0));
    await ctx.insertion(fixture(2));
    expect(ctx.indexes[0].close).not.toHaveBeenCalled();
    expect(ctx.indexes[1].close).toHaveBeenCalledTimes(1);
    await ctx.service.onModuleDestroy();
    expect(ctx.indexes[0].close).toHaveBeenCalledTimes(1);
    expect(ctx.indexes[2].close).toHaveBeenCalledTimes(1);
  });

  it('never evicts an active index and rejects new work while shutdown drains accepted work', async () => {
    const ctx = context({ CONSENSUS_HISTORY_MAX_OPEN_INDEXES: 1 });
    const entered = deferred();
    const release = deferred();
    ctx.setBeforeRecover(async () => { entered.resolve(); await release.promise; });
    const active = ctx.insertion(fixture(0));
    await entered.promise;
    await expect(ctx.insertion(fixture(1))).rejects.toThrow('cache slots are busy');
    const closing = ctx.service.onModuleDestroy();
    await expect(ctx.insertion(fixture(2))).rejects.toThrow('shutting down');
    expect(ctx.indexes[0].close).not.toHaveBeenCalled();
    release.resolve();
    await active;
    await closing;
    expect(ctx.indexes[0].close).toHaveBeenCalledTimes(1);
  });

  it('does not overbook a cache slot when different clients first arrive concurrently', async () => {
    const ctx = context({ CONSENSUS_HISTORY_MAX_OPEN_INDEXES: 1 });
    const entered = deferred();
    const release = deferred();
    ctx.setBeforeRecover(async () => { entered.resolve(); await release.promise; });
    const first = ctx.insertion(fixture(0));
    const rejected = expect(ctx.insertion(fixture(1))).rejects.toThrow('cache slots are busy');
    await entered.promise;
    await rejected;
    expect(ctx.indexes).toHaveLength(1);
    release.resolve();
    await first;
    await ctx.service.onModuleDestroy();
  });

  it('destroys a stalled post-COMMIT canonical recheck lease rather than pooling its active query', async () => {
    jest.useFakeTimers();
    const ctx = context({ CONSENSUS_HISTORY_TIMEOUT_MS: 10 });
    ctx.setBeforeRecover(async (source) => {
      await source.sql.query('COMMIT');
      ctx.runners[0].query.mockImplementationOnce(() => new Promise(() => {}));
      await source.sql.query('SELECT canonical_tip_after_commit');
    });
    const rejected = expect(ctx.insertion()).rejects.toThrow('SQL query exceeded its deadline');
    await jest.advanceTimersByTimeAsync(11);
    await rejected;
    expect(ctx.runners[0].releasePostgresConnection).toHaveBeenCalledWith(expect.any(Error));
    expect(ctx.runners[0].release).not.toHaveBeenCalled();
    expect(ctx.indexes[0].insertionWitness).not.toHaveBeenCalled();
    await ctx.service.onModuleDestroy();
  });

  it('bounds live-provider waits and poisons failed transaction cleanup', async () => {
    jest.useFakeTimers();
    const ctx = context({ CONSENSUS_HISTORY_TIMEOUT_MS: 10 });
    const item = fixture();
    item.readLive.mockImplementation(() => new Promise(() => {}));
    const rejected = expect(ctx.insertion(item)).rejects.toThrow('live client read exceeded its deadline');
    await jest.advanceTimersByTimeAsync(11);
    await rejected;
    expect(ctx.runners[0].releasePostgresConnection).toHaveBeenCalledWith(expect.any(Error));
    expect(ctx.runners[0].release).not.toHaveBeenCalled();
    await ctx.service.onModuleDestroy();

    const cleanup = context();
    cleanup.setBeforeRecover(async (source) => {
      cleanup.runners[0].query.mockRejectedValueOnce(new Error('rollback failed'));
      await source.sql.query('ROLLBACK');
    });
    await expect(cleanup.insertion()).rejects.toThrow('rollback failed');
    expect(cleanup.runners[0].releasePostgresConnection).toHaveBeenCalledWith(expect.any(Error));
    expect(cleanup.runners[0].release).not.toHaveBeenCalled();
    await cleanup.service.onModuleDestroy();
  });

  it('destroys a connection that arrives after its acquisition deadline', async () => {
    jest.useFakeTimers();
    const ctx = context({ CONSENSUS_HISTORY_TIMEOUT_MS: 10 });
    const leased = deferred<EventEmitter>();
    const originalFactory = ctx.runnerFactory.getMockImplementation()!;
    ctx.runnerFactory.mockImplementation(() => {
      const runner = originalFactory();
      runner.connect.mockImplementation(() => leased.promise);
      return runner;
    });
    const rejected = expect(ctx.insertion()).rejects.toThrow('connection acquisition exceeded its deadline');
    await jest.advanceTimersByTimeAsync(11);
    await rejected;
    expect(ctx.runners[0].release).not.toHaveBeenCalled();
    expect(ctx.runners[0].releasePostgresConnection).not.toHaveBeenCalled();
    leased.resolve(ctx.runners[0].connection);
    await jest.advanceTimersByTimeAsync(0);
    expect(ctx.runners[0].releasePostgresConnection).toHaveBeenCalledWith(expect.any(Error));
    expect(ctx.runners[0].query).not.toHaveBeenCalled();
    await ctx.service.onModuleDestroy();
  });

  it('rejects malformed limits before leasing a database connection', async () => {
    const ctx = context({ CONSENSUS_HISTORY_MAX_OPEN_INDEXES: 0 });
    await expect(ctx.insertion()).rejects.toThrow('Invalid CONSENSUS_HISTORY_MAX_OPEN_INDEXES');
    expect(ctx.runnerFactory).not.toHaveBeenCalled();
    await ctx.service.onModuleDestroy();
  });
});
