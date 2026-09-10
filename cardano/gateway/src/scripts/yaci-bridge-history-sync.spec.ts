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
  processBlock,
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
  it('binds the spent block range and exact consumed out-ref to canonical successful transactions', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ block_no: '2' }] });
    await expect(getNextRelevantBlock({ query } as unknown as PoolClient, 1, filter)).resolves.toBe(2);
    const [sql, parameters] = query.mock.calls[0];
    expect(parameters).toEqual([1, [sessionAddress], [sessionPolicy]]);
    expect(sql).toContain('spent.spent_at_block > $1');
    expect(sql).toContain('utxo.tx_hash = spent.tx_hash AND utxo.output_index = spent.output_index');
    expect(sql).toContain('tx.tx_hash = spent.spent_tx_hash');
    expect(sql).toContain('tx.block = spent.spent_at_block AND tx.block_hash = spent.spent_at_block_hash');
    expect(sql).toContain('canonical.number = tx.block AND canonical.hash = tx.block_hash');
    expect(sql).toContain('tx.invalid = false');
    expect(sql).toContain("amount->>'policy_id'");
  });

  it('returns no next block when none of the watched outputs were created or spent', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ block_no: null }] });
    await expect(getNextRelevantBlock({ query } as unknown as PoolClient, 1, filter)).resolves.toBeNull();
  });

  it('projects exact cancellation evidence even when the block has no new watched output', async () => {
    const query = jest.fn().mockImplementation(async (sql: string, parameters?: unknown[]) => {
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

  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA bridge_history_cancellation_test');
    await client.query('SET LOCAL search_path TO bridge_history_cancellation_test');
    // Columns and out-ref keys follow Yaci Store v2.0.2's PostgreSQL migrations.
    await client.query(`
      CREATE TABLE block(number bigint PRIMARY KEY, hash text, prev_hash text, slot bigint);
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
    await client.query('INSERT INTO block VALUES (1, $1, NULL, 10), (2, $2, $1, 20)', [sessionTxHash, blockHash]);
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
      client.release();
    }
  });

  it.each(['address', 'full address', 'policy', 'same-block output'])('confirms cancellation selected by consumed %s without a HostState output', async (match) => {
    if (match === 'address') await client.query('UPDATE address_utxo SET amounts = NULL WHERE block = 1');
    if (match === 'full address') await client.query('UPDATE address_utxo SET owner_addr_full = owner_addr, owner_addr = NULL, amounts = NULL WHERE block = 1');
    if (match === 'policy') await client.query('UPDATE address_utxo SET owner_addr = NULL WHERE block = 1');
    if (match === 'same-block output') await client.query('UPDATE address_utxo SET block = 2 WHERE block = 1');
    await expect(getNextRelevantBlock(client, 1, filter)).resolves.toBe(2);
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
    await expect(getNextRelevantBlock(client, 1, filter)).resolves.toBeNull();
    await processBlock(client, filter, 2);
    expect((await client.query('SELECT * FROM bridge_tx_evidence')).rows).toEqual([]);
  });
});
