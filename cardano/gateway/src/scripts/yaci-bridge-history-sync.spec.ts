import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import { encode } from 'cbor';
import { Pool, PoolClient } from 'pg';
import { YaciHistoryService } from '../query/services/yaci-history.service';
import { IbcTreePendingUpdatesService } from '../shared/services/ibc-tree-pending-updates.service';
import { SubmissionService } from '../tx/submission.service';
import {
  BridgeProjectionFilter,
  ensureBridgeHistoryTables,
  getNextRelevantBlock,
  isBlockProjectionComplete,
  reconcileCursor,
  processBlock,
  processNextBlock,
} from './yaci-bridge-history-sync';

const sessionPolicy = '11'.repeat(28);
const sessionAddress = 'addr_test_session';
const sessionTxHash = '22'.repeat(32);
const blockHash = '33'.repeat(32);
const filter: BridgeProjectionFilter = {
  hostStateToken: { policyId: '44'.repeat(28), name: '00' },
  relevantAddresses: [sessionAddress],
  relevantPolicies: [sessionPolicy],
};

// Ledger-shaped cancellation body: consume a session, burn its NFT, return only
// ordinary ADA to a key address. The projection must retain no synthetic UTxO.
const cancellationBody = CML.TransactionBody.from_cbor_bytes(encode(new Map([
  [0, [[Buffer.from(sessionTxHash, 'hex'), 0]]],
  [1, [[Buffer.from('60' + '55'.repeat(28), 'hex'), 3_000_000]]],
  [2, 200_000],
  [9, new Map([[Buffer.from(sessionPolicy, 'hex'), new Map([[Buffer.from('01', 'hex'), -1]])]])],
] as Array<[number, unknown]>)));
const cancellationCbor = cancellationBody.to_cbor_hex();
const cancellationHash = CML.hash_transaction(cancellationBody).to_hex();

describe('bridge history spent-output discovery', () => {
  it('visits transaction-bearing headers even before their watched outputs are indexed', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ block_no: '2' }] });
    await expect(getNextRelevantBlock({ query } as unknown as PoolClient, 1)).resolves.toBe(2);
    const [sql, parameters] = query.mock.calls[0];
    expect(parameters).toEqual([1]);
    expect(sql).toContain('number > $1 AND (no_of_txs > 0 OR no_of_txs IS NULL)');
  });

  it('returns no next block when none of the watched outputs were created or spent', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ block_no: null }] });
    await expect(getNextRelevantBlock({ query } as unknown as PoolClient, 1)).resolves.toBeNull();
  });

  it('projects exact cancellation evidence even when the block has no new watched output', async () => {
    const query = jest.fn().mockImplementation(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('SELECT hash, no_of_txs')) return { rows: [{ hash: blockHash, no_of_txs: 1 }] };
      if (sql.includes('SELECT tx.tx_hash, tx.invalid')) return { rows: [{ tx_hash: cancellationHash, invalid: false, cbor_hex: cancellationCbor }] };
      if (sql.includes('SELECT tx_hash, output_index FROM address_utxo')) return { rows: [{ tx_hash: cancellationHash, output_index: 0 }] };
      if (sql.includes('SELECT tx_hash, output_index, spent_tx_hash')) return { rows: [{ tx_hash: sessionTxHash, output_index: 0, spent_tx_hash: cancellationHash }] };
      if (sql.includes('SELECT DISTINCT spent.spent_tx_hash')) {
        expect(sql).toContain('spent.spent_at_block = $1 AND tx.invalid = false');
        expect(parameters).toEqual([2, [sessionAddress], [sessionPolicy]]);
        return { rows: [{ tx_hash: cancellationHash }] };
      }
      if (sql.includes('SELECT tx.tx_hash, tx.fee')) {
        expect(parameters).toEqual([2, [cancellationHash]]);
        return { rows: [{ tx_hash: cancellationHash, block: 2, block_hash: blockHash, slot: 20, tx_index: 0, fee: 200000 }] };
      }
      if (sql.includes('FROM transaction_cbor')) {
        return { rows: [{ tx_hash: cancellationHash, cbor_hex: cancellationCbor, cbor_size: cancellationCbor.length / 2 }] };
      }
      if (sql.includes('RETURNING id')) return { rows: [{ id: 1 }] };
      if (sql.includes('SELECT number, hash, prev_hash')) return { rows: [{ number: 2, hash: blockHash, prev_hash: null }] };
      return { rows: [] };
    });
    await processBlock({ query } as unknown as PoolClient, filter, 2);
    const evidenceInsert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO bridge_tx_evidence'));
    expect(evidenceInsert?.[1]).toEqual([
      cancellationHash, 2, blockHash, 20, 0, cancellationCbor, cancellationCbor,
      '[]', null, null, null, null, 200000, cancellationCbor.length / 2,
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO bridge_utxo_history'))).toBe(false);
  });
});

// Run against an expendable PostgreSQL database using BRIDGE_HISTORY_TEST_DATABASE_URL.
// Each test uses a private schema inside a rolled-back transaction, never public tables.
const databaseUrl = process.env.BRIDGE_HISTORY_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
postgresDescribe('bridge history cancellation SQL and ObserveTx', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 2 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA bridge_history_cancellation_test');
    await client.query('SET LOCAL search_path TO bridge_history_cancellation_test');
    // Columns and out-ref keys follow Yaci Store v2.0.2's PostgreSQL migrations.
    await client.query(`
      CREATE TABLE block(number bigint PRIMARY KEY, hash text, prev_hash text, slot bigint, no_of_txs integer DEFAULT 1);
      CREATE TABLE address_utxo(
        tx_hash text, output_index smallint, block bigint, owner_addr text, owner_addr_full text,
        data_hash text, inline_datum text, reference_script_hash text, amounts jsonb,
        PRIMARY KEY(output_index, tx_hash)
      );
      CREATE TABLE tx_input(
        tx_hash text, output_index smallint, spent_tx_hash text, spent_at_block bigint,
        spent_at_block_hash text, PRIMARY KEY(output_index, tx_hash)
      );
      CREATE TABLE transaction(
        tx_hash text PRIMARY KEY, block bigint, block_hash text, slot bigint, tx_index integer,
        fee bigint, invalid boolean
      );
      CREATE TABLE transaction_cbor(tx_hash text PRIMARY KEY, cbor_data bytea, cbor_size integer);
      CREATE TABLE pool_registration(tx_hash text, pool_id text, block bigint, tx_index integer);
      CREATE TABLE pool_retirement(LIKE pool_registration);
    `);
    await ensureBridgeHistoryTables(client);
    await client.query('INSERT INTO block(number, hash, prev_hash, slot) VALUES (1, $1, NULL, 10), (2, $2, $1, 20)', [sessionTxHash, blockHash]);
    await client.query('INSERT INTO address_utxo(tx_hash, output_index, block, owner_addr, amounts) VALUES ($1, 0, 1, $2, $3)',
      [sessionTxHash, sessionAddress, JSON.stringify([{ unit: sessionPolicy + '01', policy_id: sessionPolicy, quantity: '1' }])]);
    await client.query('INSERT INTO tx_input VALUES ($1, 0, $2, 2, $3)', [sessionTxHash, cancellationHash, blockHash]);
    await client.query('INSERT INTO transaction VALUES ($1, 2, $2, 20, 0, 200000, false)', [cancellationHash, blockHash]);
    await client.query('INSERT INTO transaction_cbor VALUES ($1, decode($2, \'hex\'), $3)',
      [cancellationHash, cancellationCbor, cancellationCbor.length / 2]);
    await client.query('INSERT INTO address_utxo(tx_hash, output_index, block, owner_addr) VALUES ($1, 0, 2, $2)',
      [cancellationHash, 'addr_test_wallet_change']);
  });
  afterEach(async () => {
    if (client) {
      await client.query('ROLLBACK');
      await client.query('DROP SCHEMA IF EXISTS bridge_history_cancellation_test CASCADE');
      client.release();
    }
  });

  it.each(['address', 'full address', 'policy', 'same-block output'])('confirms cancellation selected by consumed %s without a HostState output', async (match) => {
    if (match === 'address') await client.query('UPDATE address_utxo SET amounts = NULL WHERE block = 1');
    if (match === 'full address') await client.query('UPDATE address_utxo SET owner_addr_full = owner_addr, owner_addr = NULL, amounts = NULL WHERE block = 1');
    if (match === 'policy') await client.query('UPDATE address_utxo SET owner_addr = NULL WHERE block = 1');
    if (match === 'same-block output') await client.query('UPDATE address_utxo SET block = 2 WHERE block = 1');
    await expect(getNextRelevantBlock(client, 1)).resolves.toBe(2);
    await processBlock(client, filter, 2);
    const history = new YaciHistoryService({} as any, {} as any, {
      query: async (sql: string, parameters: unknown[]) => (await client.query(sql, parameters)).rows,
    } as any);
    const evidence = await history.findTransactionEvidenceByHash(cancellationHash);
    expect(evidence).toMatchObject({ txHash: cancellationHash, blockNo: 2, txBodyCborHex: cancellationCbor, hostStateRoot: null });
    expect((await client.query('SELECT * FROM bridge_utxo_history')).rows).toEqual([]);

    const pending = new IbcTreePendingUpdatesService();
    const commit = jest.fn();
    pending.register(cancellationHash, { kind: 'tree_neutral', expectedNewRoot: '', commit });
    const submission = new SubmissionService(
      { LucidImporter: { CML } } as any, {} as any, {} as any, pending, {} as any, history, {} as any, {} as any,
    );
    await expect(submission.observeTransaction({ tx_hash: cancellationHash })).resolves.toEqual({
      tx_hash: cancellationHash, height: '0-2', events: [],
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(pending.peek(cancellationHash)).toBeUndefined();
  });

  it.each([
    ['invalid collateral consumption', 'UPDATE transaction SET invalid = true'],
    ['unknown validity', 'UPDATE transaction SET invalid = NULL'],
    ['noncanonical transaction', "UPDATE transaction SET block_hash = repeat('f', 64)"],
    ['different consumed output index', 'UPDATE tx_input SET output_index = 1'],
    ['different consumed transaction', "UPDATE tx_input SET tx_hash = repeat('f', 64)"],
    ['unrelated consumed output', 'UPDATE address_utxo SET owner_addr = NULL, amounts = NULL WHERE block = 1'],
  ])('does not discover or confirm %s', async (_description, mutation) => {
    await client.query(mutation);
    await expect(getNextRelevantBlock(client, 1)).resolves.toBe(2);
    await processBlock(client, filter, 2);
    expect((await client.query('SELECT * FROM bridge_tx_evidence')).rows).toEqual([]);
  });

  it.each([
    ['transaction', 'DELETE FROM transaction'],
    ['CBOR', 'DELETE FROM transaction_cbor'],
    ['output', 'DELETE FROM address_utxo WHERE block = 2'],
    ['input', 'DELETE FROM tx_input'],
    ['unknown validity', 'UPDATE transaction SET invalid = NULL'],
    ['canonical binding', "UPDATE transaction SET block_hash = repeat('f', 64)"],
  ])('does not advance the cursor before the %s component arrives', async (_component, mutation) => {
    await expect(isBlockProjectionComplete(client, 2)).resolves.toBe(true);
    await client.query('SAVEPOINT complete_fixture');
    await client.query(mutation);
    await expect(isBlockProjectionComplete(client, 2)).resolves.toBe(false);
    await expect(processBlock(client, filter, 2)).resolves.toBe(false);
    expect((await client.query("SELECT last_block FROM bridge_history_sync_state WHERE cursor_name = 'complete-block-v2'")).rows[0].last_block).toBe('-1');
    await client.query('ROLLBACK TO SAVEPOINT complete_fixture');
    await expect(processBlock(client, filter, 2)).resolves.toBe(true);
    expect((await client.query('SELECT tx_hash FROM bridge_tx_evidence')).rows).toEqual([{ tx_hash: cancellationHash }]);
  });

  it('rejects transaction bytes substituted behind the indexed hash', async () => {
    await client.query("UPDATE transaction_cbor SET cbor_data = decode($1, 'hex')", [cancellationCbor.replace('1a002dc6c0', '1a002dc6c1')]);
    await expect(isBlockProjectionComplete(client, 2)).rejects.toThrow('CBOR/hash mismatch');
  });

  it('derives every pool certificate before asynchronous certificate tables arrive', async () => {
    const body = CML.TransactionBody.from_cbor_hex(cancellationCbor);
    const certificates = CML.CertificateList.new();
    for (const pool of ['66', '77']) {
      certificates.add(CML.Certificate.new_pool_retirement(CML.Ed25519KeyHash.from_hex(pool.repeat(28)), 7n));
    }
    body.set_certs(certificates);
    const hash = CML.hash_transaction(body).to_hex(), cbor = body.to_cbor_hex();
    await client.query('UPDATE transaction SET tx_hash = $1', [hash]);
    await client.query("UPDATE transaction_cbor SET tx_hash = $1, cbor_data = decode($2, 'hex'), cbor_size = $3", [hash, cbor, cbor.length / 2]);
    await client.query('UPDATE tx_input SET spent_tx_hash = $1', [hash]);
    await client.query('UPDATE address_utxo SET tx_hash = $1 WHERE block = 2', [hash]);
    expect((await client.query('SELECT * FROM pool_retirement')).rows).toEqual([]);
    await expect(processBlock(client, filter, 2)).resolves.toBe(true);
    const events = (await client.query('SELECT event_type, cert_index, pool_id FROM bridge_spo_event_history ORDER BY cert_index')).rows;
    expect(events).toHaveLength(2);
    expect(events.map((event) => [event.event_type, event.cert_index])).toEqual([['unregister', 0], ['unregister', 1]]);
    expect(new Set(events.map((event) => event.pool_id)).size).toBe(2);
  });

  it('atomically replaces legacy projections while preserving authenticated cache seeds', async () => {
    await processBlock(client, filter, 2);
    await client.query("INSERT INTO bridge_pool_registration_cache(pool_id, first_registration_slot, source) VALUES ('orphan', 1, 'yaci_projection'), ('orphan_read_cache', 1, 'yaci'), ('genesis', 0, 'authenticated_genesis')");
    await client.query("DELETE FROM bridge_history_sync_state WHERE cursor_name = 'complete-block-v2'");
    await client.query("INSERT INTO bridge_history_sync_state VALUES ('default', 2, $1, now())", [blockHash]);
    await ensureBridgeHistoryTables(client);
    for (const table of ['bridge_tx_history', 'bridge_tx_evidence', 'bridge_utxo_history', 'bridge_spo_event_history', 'bridge_history_block_checkpoints']) {
      expect((await client.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    }
    expect((await client.query('SELECT pool_id FROM bridge_pool_registration_cache')).rows).toEqual([{ pool_id: 'genesis' }]);
    await expect(processBlock(client, filter, 2)).resolves.toBe(true);
    expect((await client.query('SELECT tx_hash FROM bridge_tx_evidence')).rows).toEqual([{ tx_hash: cancellationHash }]);
  });

  it('rewinds through unknown sparse anchors and removes orphan registration ages while waiting for replay', async () => {
    await processBlock(client, filter, 2);
    await client.query('INSERT INTO bridge_history_block_checkpoints VALUES (1, $1)', [sessionTxHash]);
    await client.query("INSERT INTO block(number,hash,slot,no_of_txs) VALUES (3, repeat('a',64), 30, 0), (4, repeat('b',64), 40, 0)");
    await client.query("UPDATE block SET hash = repeat('f',64) WHERE number=2");
    await client.query("UPDATE bridge_history_sync_state SET last_block=4, last_block_hash=repeat('c',64) WHERE cursor_name='complete-block-v2'");
    await client.query("INSERT INTO bridge_spo_event_history(event_type,tx_hash,block_no,pool_id,slot_no) VALUES ('register',$1,2,'orphan',20)", [cancellationHash]);
    await client.query("INSERT INTO bridge_pool_registration_cache(pool_id,first_registration_slot,source) VALUES ('orphan',20,'yaci_projection'),('orphan_read_cache',20,'yaci'),('genesis',0,'authenticated_genesis')");
    await expect(reconcileCursor(client)).resolves.toEqual({ lastBlock: 1, lastBlockHash: sessionTxHash });
    expect((await client.query('SELECT * FROM bridge_tx_evidence')).rows).toEqual([]);
    expect((await client.query('SELECT pool_id FROM bridge_pool_registration_cache')).rows).toEqual([{ pool_id: 'genesis' }]);
    await expect(getNextRelevantBlock(client, 1)).resolves.toBe(2);
    await expect(processBlock(client, filter, 2)).resolves.toBe(false);
    expect((await client.query("SELECT last_block FROM bridge_history_sync_state WHERE cursor_name='complete-block-v2'")).rows[0].last_block).toBe('1');
  });

  it.each(['no next block', 'incomplete next block', 'malformed next block'])(
    'the real transaction wrapper persists rewind while waiting for %s and rolls back exceptions', async (mode) => {
      await processBlock(client, filter, 2);
      await client.query('INSERT INTO bridge_history_block_checkpoints VALUES (1, $1)', [sessionTxHash]);
      if (mode === 'no next block') await client.query('DELETE FROM block WHERE number=2');
      else await client.query("UPDATE block SET hash=repeat('f',64) WHERE number=2");
      if (mode === 'malformed next block') {
        await client.query("UPDATE transaction SET block_hash=repeat('f',64)");
        await client.query("UPDATE transaction_cbor SET cbor_data=decode($1,'hex')", [cancellationCbor.replace('1a002dc6c0', '1a002dc6c1')]);
        await client.query("UPDATE tx_input SET spent_at_block_hash=repeat('f',64)");
      }
      // This test commits only its private expendable schema. The actual
      // worker gets another connection; visibility checks use this one.
      await client.query('COMMIT');
      await client.query('SET search_path TO bridge_history_cancellation_test');
      const database = { connect: async () => {
        const connection = await pool.connect();
        await connection.query('SET search_path TO bridge_history_cancellation_test');
        return connection;
      } } as Pick<Pool, 'connect'>;
      if (mode === 'malformed next block') {
        await expect(processNextBlock(database, filter)).rejects.toThrow('CBOR/hash mismatch');
      } else await expect(processNextBlock(database, filter)).resolves.toBe(false);
      const failed = mode === 'malformed next block';
      expect((await client.query("SELECT last_block FROM bridge_history_sync_state WHERE cursor_name='complete-block-v2'")).rows[0].last_block).toBe(failed ? '2' : '1');
      expect((await client.query('SELECT * FROM bridge_tx_evidence')).rows).toHaveLength(failed ? 1 : 0);
      await client.query('BEGIN');
    },
  );

  it('a delayed Gateway reader cannot resurrect a registration age after concurrent rollback', async () => {
    await processBlock(client, filter, 2);
    await client.query('INSERT INTO bridge_history_block_checkpoints VALUES (1, $1)', [sessionTxHash]);
    await client.query('CREATE TABLE pool(pool_id text, registration_slot bigint)');
    await client.query("INSERT INTO bridge_spo_event_history(event_type,tx_hash,block_no,pool_id,slot_no) VALUES ('register',$1,2,'pool1delayed',20)", [cancellationHash]);
    await client.query('COMMIT');
    await client.query('SET search_path TO bridge_history_cancellation_test');
    const reader = await pool.connect();
    await reader.query('SET search_path TO bridge_history_cancellation_test');
    let readObserved!: () => void;
    let releaseRead!: () => void;
    const observed = new Promise<void>((resolve) => { readObserved = resolve; });
    const released = new Promise<void>((resolve) => { releaseRead = resolve; });
    const statements: string[] = [];
    const history = new YaciHistoryService({ get: () => undefined } as any, {} as any, {
      query: async (sql: string, parameters: unknown[]) => {
        statements.push(sql);
        const result = (await reader.query(sql, parameters)).rows;
        if (sql.includes('WITH registration_slots')) { readObserved(); await released; }
        return result;
      },
    } as any);
    const pending = (history as any).findKnownPoolRegistrationSlots(['pool1delayed']);
    try {
      await observed;
      await client.query('BEGIN');
      await client.query("UPDATE block SET hash=repeat('f',64) WHERE number=2");
      await reconcileCursor(client);
      await client.query("INSERT INTO bridge_pool_registration_cache(pool_id,first_registration_slot,source) VALUES ('pool1delayed',50,'yaci_projection')");
      await client.query('COMMIT');
      releaseRead();
      await pending;
      expect((await client.query("SELECT first_registration_slot FROM bridge_pool_registration_cache WHERE pool_id='pool1delayed'")).rows[0].first_registration_slot).toBe('50');
      expect(statements.some((sql) => sql.includes('INSERT INTO bridge_pool_registration_cache'))).toBe(false);
    } finally {
      releaseRead();
      await pending;
      reader.release();
      await client.query('BEGIN');
    }
  });
});
