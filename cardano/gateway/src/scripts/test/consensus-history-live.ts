// Run with the isolated devnet Gateway environment, after a real ICS-20 return
// has settled and its Tendermint client has advanced beyond the chosen height.
// Never submits a transaction, deletes a database or stops a service.
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ClientDatum } from '../../shared/types/client-datum';
import type { HostStateDatum } from '../../shared/types/host-state-datum';
import type { Height } from '../../shared/types/height';
import type { AuthToken } from '../../shared/types/auth-token';
import type { HistorySource, HistoryTransaction } from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';

const HELP = `Usage: ts-node -r tsconfig-paths/register src/scripts/test/consensus-history-live.ts
  --client-id 07-tendermint-N --proof-height REVISION-HEIGHT --report-dir NEW_DIRECTORY
  [--resume-history-cache EXISTING_DIRECTORY | --pause-after-checkpoints N]

Uses the normal Gateway environment and requires cardanoNetwork=Custom.
The report directory must not exist. By default both private SQLite history and
the public tree are rebuilt from live Yaci/Kupo data without previous local caches.
--resume-history-cache instead validates and resumes the specified private cache.
The Gateway database's ibc_state_tree_cache must be empty. The env flag does not
disable historical proof-query cache reads. Use a fresh isolated Gateway DB or
preserve and replace that cache table while Gateway and Hermes are stopped.
For audit-only, leave Gateway stopped until this command finishes, then restart
it with normal caching so freshly reconstructed snapshots remain available.
Run a separate transfer after recovering Gateway.
Stop automatic relaying while selecting the checkpoint and running this test.
For a deterministic crash test, --pause-after-checkpoints writes
checkpoint-barrier.json only after N durable checkpoints and refuses witnesses.
Terminate that exact child PID, then rerun with --resume-history-cache pointing
to its history directory. A resumed run is explicitly not reported as cold.
`;

export function liveTestHeight(value: string): Height {
  const match = /^(0|[1-9][0-9]*)-([1-9][0-9]*)$/.exec(value);
  if (!match) throw new Error('proof-height must be canonical REVISION-HEIGHT with a positive height');
  return { revisionNumber: BigInt(match[1]), revisionHeight: BigInt(match[2]) };
}

export function requireOlderHeight(requested: Height, latest: Height): void {
  assert(requested.revisionNumber === latest.revisionNumber && requested.revisionHeight < latest.revisionHeight,
    'Test requires an explicitly older checkpoint in the same revision, not the current tip');
}

export function requireEmptyPublicTreeCache(count: string | number): void {
  assert.equal(BigInt(count), 0n,
    'Cold recovery requires an empty ibc_state_tree_cache, preserve the old table or use a fresh isolated Gateway database');
}

export function requireSameHistoryDeployment(saved: { clientToken: AuthToken; stateAddress: string }, token: AuthToken, address: string): void {
  assert.deepEqual(saved.clientToken, token, 'Resume cache belongs to another client token');
  assert.equal(saved.stateAddress, address, 'Resume cache belongs to another client address');
}

/** Pause only after the real consumer has committed an actual source record. */
export function checkpointBarrierSource(
  source: HistorySource,
  afterCheckpoint: (transaction: HistoryTransaction) => Promise<void>,
): HistorySource {
  return {
    currentState: () => source.currentState(),
    async *transactions(after) {
      for await (const transaction of source.transactions(after)) {
        yield transaction;
        await afterCheckpoint(transaction);
      }
    },
  };
}

async function savedCheckpoint(directory: string, clientId: string) {
  const { DatabaseSync } = await import('node:sqlite');
  let found: { count: number; txHash: string; outputIndex: number; datum: string;
    clientToken: AuthToken; stateAddress: string; filename: string } | undefined;
  for (const filename of readdirSync(directory).filter((name) => name.endsWith('.sqlite'))) {
    const database = new DatabaseSync(join(directory, filename), { readOnly: true });
    try {
      const deployment = database.prepare('SELECT config FROM history_deployment WHERE id = 1').get();
      if (!deployment) continue;
      const { clientToken, stateAddress } = JSON.parse(String(deployment.config));
      if (`07-tendermint-${Buffer.from(clientToken.name.slice(48), 'hex').toString()}` !== clientId) continue;
      const tip = database.prepare(`SELECT tx_hash, output_index, datum,
        (SELECT count(*) FROM history_journal) AS checkpoint_count
        FROM history_journal ORDER BY sequence DESC LIMIT 1`).get();
      if (tip) {
        assert(!found, 'History directory contains multiple deployments for this client ID');
        found = { count: Number(tip.checkpoint_count), txHash: String(tip.tx_hash),
          outputIndex: Number(tip.output_index), datum: String(tip.datum), clientToken, stateAddress, filename };
      }
    } finally { database.close(); }
  }
  return found;
}

async function installCheckpointBarrier(directory: string, clientId: string, proofHeight: Height, count: number, reportDirectory: string) {
  const { ConsensusHistoryRecovery } = await import('@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery');
  const recover = ConsensusHistoryRecovery.prototype.recover;
  // Test-child-only scheduling hook. All SQL, CBOR, transitions and commits are
  // still production code. No source rows or cryptographic results are replaced.
  ConsensusHistoryRecovery.prototype.recover = function (source, options) {
    return recover.call(this, checkpointBarrierSource(source, async (transaction) => {
      const saved = await savedCheckpoint(directory, clientId);
      if (!saved || saved.count !== count || saved.txHash !== transaction.txHash) return;
      const live = await source.currentState();
      assert.notEqual(saved.txHash, live.txHash, 'Pause point must precede the live client output');
      assert.throws(() => this.witness(saved.clientToken, proofHeight), /not been matched to the live state/);
      await writeFile(join(reportDirectory, 'checkpoint-barrier.json'), json({
        pid: process.pid, checkpoints: saved.count, checkpointTxHash: saved.txHash,
        liveClient: { txHash: live.txHash, outputIndex: live.outputIndex },
        historyDirectory: directory, witnessRefused: true,
      }));
      console.log(`Paused after ${count} durable checkpoints, terminate only child PID ${process.pid}`);
      await new Promise<void>(() => {});
    }), options);
  };
}

function identifier(value: string, prefix: string): bigint {
  assert(value.startsWith(prefix), `Expected ${prefix}N identifier`);
  const suffix = value.slice(prefix.length);
  assert(/^(0|[1-9][0-9]*)$/.test(suffix), `Expected canonical ${prefix}N identifier`);
  return BigInt(suffix);
}

function json(value: unknown): string {
  return JSON.stringify(value, function (key, converted) {
    const original = this[key];
    return typeof original === 'bigint' ? original.toString() : converted;
  }, 2);
}

export async function runLiveHistoryTest(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: {
    help: { type: 'boolean' },
    'client-id': { type: 'string' }, 'proof-height': { type: 'string' }, 'report-dir': { type: 'string' },
    'resume-history-cache': { type: 'string' }, 'pause-after-checkpoints': { type: 'string' },
  } });
  if (values.help) { console.log(HELP); return; }
  const required = (key: keyof typeof values): string => {
    const value = values[key];
    assert(typeof value === 'string' && value.trim().length > 0, `--${key} is required`);
    return value;
  };
  const clientId = required('client-id');
  const clientSequence = identifier(clientId, '07-tendermint-');
  const proofHeight = liveTestHeight(required('proof-height'));
  const directory = resolve(required('report-dir'));
  const resumeDirectory = values['resume-history-cache'] ? resolve(values['resume-history-cache']) : undefined;
  const pauseAt = values['pause-after-checkpoints'] === undefined ? undefined : Number(values['pause-after-checkpoints']);
  if (pauseAt !== undefined) {
    assert(Number.isSafeInteger(pauseAt) && pauseAt > 0, 'pause-after-checkpoints must be a positive safe integer');
    assert(!resumeDirectory, 'The checkpoint barrier requires a fresh audit-only run');
  }
  const resumedCheckpoint = resumeDirectory ? await savedCheckpoint(resumeDirectory, clientId) : undefined;
  assert(!resumeDirectory || resumedCheckpoint, 'Resume directory has no saved checkpoints for this client');
  await mkdir(directory);
  process.env.CONSENSUS_HISTORY_CACHE_DIR = resumeDirectory ?? join(directory, 'history');
  process.env.IBC_TREE_CACHE_ENABLED = 'false';

  // Import only after selecting fresh caches. Configuration modules load .env.
  const [{ NestFactory }, { ConfigService }, { AppModule }, { LucidService }, { IbcTreeStateStore }] = await Promise.all([
    import('@nestjs/core'), import('@nestjs/config'), import('../../app.module'),
    import('../../shared/modules/lucid/lucid.service'), import('../../shared/helpers/ibc-state-root'),
  ]);
  const { default: configuration } = await import('../../config');
  assert.equal(configuration().cardanoNetwork, 'Custom', 'Live acceptance must use the isolated Custom devnet');
  if (pauseAt !== undefined) await installCheckpointBarrier(process.env.CONSENSUS_HISTORY_CACHE_DIR, clientId, proofHeight, pauseAt, directory);
  const startedAt = performance.now();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'], abortOnError: false });
  try {
    const config = app.get(ConfigService);
    assert.equal(config.getOrThrow('cardanoNetwork'), 'Custom', 'Live acceptance must use the isolated Custom devnet');
    const [{ getDataSourceToken }, { IbcTreeCacheService }] = await Promise.all([
      import('@nestjs/typeorm'), import('../../shared/services/ibc-tree-cache.service'),
    ]);
    await app.get(IbcTreeCacheService).ensureSchema();
    const gatewayDatabase = app.get<import('typeorm').DataSource>(getDataSourceToken('gateway'));
    const [cacheCount] = await gatewayDatabase.query('SELECT count(*)::text AS count FROM ibc_state_tree_cache');
    requireEmptyPublicTreeCache(cacheCount.count);
    const lucid = app.get(LucidService);
    const store = app.get(IbcTreeStateStore);
    const unit = lucid.getClientAuthTokenUnit(clientSequence);
    const client = await lucid.findUtxoByUnit(unit);
    assert(client.datum, 'Live client has no inline datum');
    const datum = await lucid.decodeDatum<ClientDatum>(client.datum, 'client');
    if (resumedCheckpoint) requireSameHistoryDeployment(resumedCheckpoint, datum.token, client.address);
    requireOlderHeight(proofHeight, datum.state.clientState.latestHeight);
    assert.equal(datum.state.consensusStates.size, 1, 'Live client datum must retain only its latest checkpoint');

    const { historyWitnesses } = await lucid.resolveClientAtHeights(client, [proofHeight]);
    assert(pauseAt === undefined, 'Requested checkpoint barrier was not reached');
    assert.equal(historyWitnesses.length, 1, 'Older checkpoint must come from recovered history');
    const witness = historyWitnesses[0];
    assert.deepEqual(witness.record.height, proofHeight);
    const [{ consensusHistoryKey, encodeConsensusHistoryRecord }, { verifyIbcTreeWitness }] = await Promise.all([
      import('@cardano-ibc/tx-builder-runtime/consensusHistory'),
      import('@cardano-ibc/tx-builder-runtime/incrementalIbcTree'),
    ]);
    const record = { ...witness.record, consensusState: {
      timestamp: witness.record.consensusState.timestamp,
      nextValidatorsHash: witness.record.consensusState.next_validators_hash,
      root: witness.record.consensusState.root.hash,
    } };
    assert(verifyIbcTreeWitness(consensusHistoryKey(record.clientToken, proofHeight),
      encodeConsensusHistoryRecord(record), witness.siblings, datum.history_root), 'Recovered private witness root mismatch');
    const host = await lucid.findUtxoAtHostStateNFT(0n);
    assert(host?.datum, 'Live HostState has no inline datum');
    const hostDatum = await lucid.decodeDatum<HostStateDatum>(host.datum, 'host_state');
    assert(store.isTreeAligned(hostDatum.state.ibc_state_root, host), 'Cold public tree is not aligned with live HostState');
    const records = await lucid.consensusHistoryRecords(client);
    if (resumeDirectory && resumedCheckpoint) {
      const resumed = await savedCheckpoint(resumeDirectory, clientId);
      assert(resumed, 'Resumed history checkpoint disappeared');
      assert.equal(resumed.filename, resumedCheckpoint.filename, 'Recovery created another cache instead of resuming');
      assert.equal(resumed.txHash, client.txHash, 'Resumed cache did not reach the live client transaction');
      assert.equal(resumed.outputIndex, client.outputIndex, 'Resumed cache did not reach the live client output');
      assert.equal(resumed.datum, client.datum, 'Resumed cache did not reconstruct the live client datum');
    }
    const report: Record<string, unknown> = {
      mode: resumeDirectory ? 'resume' : 'cold', clientId, proofHeight, latestHeight: datum.state.clientState.latestHeight,
      client: { txHash: client.txHash, outputIndex: client.outputIndex, datumBytes: client.datum.length / 2, lovelace: client.assets.lovelace },
      hostState: { txHash: host.txHash, outputIndex: host.outputIndex },
      privateRoot: datum.history_root, publicRoot: hostDatum.state.ibc_state_root,
      recoveredRecords: records.length, applicationRecoveryMilliseconds: Math.round(performance.now() - startedAt),
      ...(resumedCheckpoint ? { resumedFromCheckpoints: resumedCheckpoint.count, resumedFromTxHash: resumedCheckpoint.txHash } : {}),
      publicTreeCacheRowsBefore: Number(cacheCount.count),
      olderCheckpointAuthenticated: true,
    };
    await writeFile(join(directory, 'recovery.json'), json(report));
    await writeFile(join(directory, 'historical-witness.json'), json(witness));

    console.log(json(report));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runLiveHistoryTest(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown live recovery failure';
    console.error(message.replace(/(?:postgres(?:ql)?|https?|wss?):\/\/[^\s"'<>)]*/gi, '[redacted endpoint]'));
    // Startup may fail before Nest returns a closable application, while an
    // initialized database pool or scheduler still keeps this test child alive.
    process.exit(1);
  });
}
