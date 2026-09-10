import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import type { UTxO } from '@lucid-evolution/lucid';
import type { ConsensusHistoryRecovery, HistoryDeployment } from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';
import type { ConsensusHistoryRecord } from '@cardano-ibc/tx-builder-runtime/consensusHistory';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ClientDatum } from '../../types/client-datum';
import { ConsensusHistoryWitness, ConsensusStateDatum } from '../../types/consensus-state-datum';
import { Height } from '../../types/height';
import { GrpcFailedPreconditionException, GrpcNotFoundException } from '../../../exception/grpc_exceptions';

function fromHistoryRecord(record: ConsensusHistoryRecord): ConsensusStateDatum {
  return {
    ...record,
    consensusState: {
      timestamp: record.consensusState.timestamp,
      next_validators_hash: record.consensusState.nextValidatorsHash,
      root: { hash: record.consensusState.root },
    },
  };
}

/** One disposable index per deployment/client. Accepted Cardano data is its source. */
@Injectable()
export class ConsensusHistoryService implements OnModuleDestroy {
  private readonly indexes = new Map<string, { index: ConsensusHistoryRecovery; deployment: HistoryDeployment }>();
  private readonly pending = new Map<string, Promise<void>>();
  private stopping = false;

  constructor(
    @InjectEntityManager('history') private readonly database: EntityManager,
    private readonly config: ConfigService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.pending.values());
    const errors: unknown[] = [];
    for (const { index } of this.indexes.values()) {
      try { index.close(); } catch (error) { errors.push(error); }
    }
    this.indexes.clear();
    if (errors.length) throw new AggregateError(errors, 'Consensus history caches could not all be closed');
  }

  async witnesses(utxo: UTxO, client: ClientDatum, readLive: () => Promise<UTxO>, heights: Height[]): Promise<ConsensusHistoryWitness[]> {
    return this.withIndex(utxo, client, readLive, async (index) => heights.map((height) => {
      try {
        const witness = index.witness(client.token, height);
        return { record: fromHistoryRecord(witness.record), siblings: witness.siblings };
      } catch (error) {
        if (error instanceof Error && error.message === 'historical record not found') {
          throw new GrpcNotFoundException(`Consensus state not found at ${height.revisionNumber}-${height.revisionHeight}`);
        }
        throw error;
      }
    }));
  }

  async insertion(utxo: UTxO, client: ClientDatum, readLive: () => Promise<UTxO>) {
    return this.withIndex(utxo, client, readLive, async (index) => index.insertionWitness());
  }

  async records(utxo: UTxO, client: ClientDatum, readLive: () => Promise<UTxO>) {
    return this.withIndex(utxo, client, readLive, async (index) => {
      const result: Array<{ datum: ConsensusStateDatum; consensusValue: string; archived: boolean }> = [];
      for await (const item of index.records()) {
        result.push({ datum: fromHistoryRecord(item.record), consensusValue: item.consensusValue, archived: item.archived });
      }
      return result;
    });
  }

  private withIndex<T>(utxo: UTxO, client: ClientDatum, readLive: () => Promise<UTxO>, operation: (index: ConsensusHistoryRecovery) => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new GrpcFailedPreconditionException('Consensus history service is shutting down'));
    utxo = structuredClone(utxo);
    client = structuredClone(client);
    const deployment = this.config.getOrThrow('deployment');
    const identity = JSON.stringify({
      network: this.config.getOrThrow<string>('cardanoNetwork'),
      host: deployment.hostStateNFT,
      address: utxo.address,
      token: client.token,
    });
    const key = createHash('sha256').update(identity).digest('hex');
    const run = (this.pending.get(key) ?? Promise.resolve()).then(async () => {
      const timeout = this.positiveConfig('CONSENSUS_HISTORY_TIMEOUT_MS', 30_000);
      const capacity = this.positiveConfig('CONSENSUS_HISTORY_MAX_OPEN_INDEXES', 64);
      const [{ ConsensusHistoryRecovery }, { createYaciHistorySource, discoverYaciHistoryBootstrap }] = await Promise.all([
        import('@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery'),
        import('@cardano-ibc/tx-builder-runtime/consensusHistoryYaci'),
      ]);
      const runner = this.database.connection.createQueryRunner();
      // TypeORM's PostgreSQL runner passes this error to pg PoolClient.release,
      // which destroys the connection instead of pooling an active timed-out query.
      // Feature-check the implementation before acquiring a lease on upgrades.
      const releaseBroken = Reflect.get(runner, 'releasePostgresConnection');
      if (typeof releaseBroken !== 'function') throw new Error('Consensus history requires a PostgreSQL query runner with error-aware release');
      let connection: Awaited<ReturnType<typeof runner.connect>> | undefined;
      let failure: Error | undefined;
      let discarded: Promise<void> | undefined;
      let rejectFailure!: (error: Error) => void;
      const failed = new Promise<never>((_, reject) => { rejectFailure = reject; });
      void failed.catch(() => {});
      const discard = () => {
        if (!connection) return;
        discarded ??= Promise.resolve().then(() => releaseBroken.call(runner, failure)).finally(() => connection.removeListener('error', onError));
        void discarded.catch(() => {});
      };
      const poison = (error: Error) => {
        failure ??= error;
        rejectFailure(failure);
        discard();
      };
      const onError = (cause: Error) => poison(new Error('Consensus history database connection failed', { cause }));
      const wait = async <V>(start: () => Promise<V>, label: string): Promise<V> => {
        if (failure) throw failure;
        const timer = setTimeout(() => poison(new Error(`Consensus history ${label} exceeded its deadline`)), timeout);
        try { return await Promise.race([Promise.resolve().then(start), failed]); }
        finally { clearTimeout(timer); }
      };
      const sql = {
        query: async (text: string, values?: unknown[]) => {
          try {
            const rows = await wait(() => runner.query(text, values), 'SQL query');
            if (text.startsWith('BEGIN ')) await wait(() => runner.query(`SET LOCAL statement_timeout = ${timeout}`), 'SQL timeout setup');
            return { rows };
          } catch (error) {
            if (/^\s*(?:COMMIT|ROLLBACK)\b/i.test(text)) {
              poison(new Error('Consensus history transaction cleanup failed', { cause: error }));
            }
            throw error;
          }
        },
      };
      let result: T;
      try {
        // Pool acquisition is not cancellable through QueryRunner. A late lease
        // is immediately destroyed; pg's own connectionTimeoutMillis also bounds
        // the underlying queue. Never release the runner before connect resolves.
        await wait(() => runner.connect().then((leased) => {
          connection = leased;
          connection.on('error', onError);
          if (failure) discard();
          return leased;
        }), 'connection acquisition');
        const bootstrap = await discoverYaciHistoryBootstrap(sql, { clientToken: client.token, stateAddress: utxo.address });
        let cached = this.indexes.get(key);
        if (cached && (cached.deployment.bootstrap.txHash !== bootstrap.txHash ||
          cached.deployment.bootstrap.outputIndex !== bootstrap.outputIndex)) {
          cached.index.close();
          this.indexes.delete(key);
          cached = undefined;
        }
        if (!cached) {
          const directory = resolve(this.config.get<string>('CONSENSUS_HISTORY_CACHE_DIR') || '.consensus-history');
          await wait(() => mkdir(directory, { recursive: true }), 'cache directory setup');
          // Do not await between checking capacity and inserting the new index:
          // concurrent first requests must not all reserve the same free slot.
          while (this.indexes.size >= capacity) {
            const idle = [...this.indexes.keys()].find((candidate) => !this.pending.has(candidate));
            if (idle === undefined) throw new GrpcFailedPreconditionException('All consensus history cache slots are busy, retry later');
            this.indexes.get(idle)!.index.close();
            this.indexes.delete(idle);
          }
          const historyDeployment: HistoryDeployment = {
            clientToken: client.token,
            stateAddress: utxo.address,
            bootstrap,
            layout: 'production',
          };
          const cacheKey = createHash('sha256').update(JSON.stringify({ identity, bootstrap })).digest('hex');
          cached = { index: new ConsensusHistoryRecovery(resolve(directory, `${cacheKey}.sqlite`), historyDeployment), deployment: historyDeployment };
          this.indexes.set(key, cached);
        }
        // Insertion order is the LRU order; pending clients are never evicted.
        this.indexes.delete(key);
        this.indexes.set(key, cached);
        const { index } = cached;
        await index.recover(createYaciHistorySource(sql, cached.deployment, () => wait(readLive, 'live client read')));
        const current = index.current();
        if (current.utxo.txHash !== utxo.txHash || current.utxo.outputIndex !== utxo.outputIndex ||
          current.utxo.datum !== utxo.datum || current.root !== client.history_root) {
          throw new GrpcFailedPreconditionException('Client changed while resolving consensus history, retry with the current client output');
        }
        result = await operation(index);
        if (failure) throw failure;
      } finally {
        if (connection) {
          try {
            if (failure) { discard(); await discarded; }
            else await runner.release();
          } finally { connection.removeListener('error', onError); }
        }
      }
      if (failure) throw failure;
      return result;
    });
    const completed = run.then(() => {}, () => {});
    this.pending.set(key, completed);
    void completed.then(() => { if (this.pending.get(key) === completed) this.pending.delete(key); });
    return run;
  }

  private positiveConfig(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error(`Invalid ${name}`);
    return value;
  }
}
