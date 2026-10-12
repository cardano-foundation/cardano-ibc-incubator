import { Pool, type PoolClient } from 'pg';
import { ensureRestHistoryTables, importRestBlock, syncRestHistory } from './rest-history-import';
import { assertRestHistoryCanonical, YaciRestClient } from '../shared/helpers/yaci-rest';
import { restBlockFixture } from '../test-config/rest-block';
import { ensureBridgeHistoryTables, processNextBlock } from './yaci-bridge-history-sync';

const databaseUrl = process.env.BRIDGE_HISTORY_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('REST history imports into Gateway-owned PostgreSQL', () => {
  const schema = `rest_history_import_${process.pid}`;
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 1 });
  const rest = new YaciRestClient('https://yaci.example');
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
  });
  beforeEach(async () => {
    await client.query('BEGIN');
    await ensureRestHistoryTables(client, 42);
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
    await pool.end();
  });

  function source(blocks: ReturnType<typeof restBlockFixture>[]) {
    const state = { blocks };
    const request = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const path = String(url).split('/api/v1/blocks/')[1];
      const selected = path === 'latest' ? state.blocks.at(-1) : state.blocks.find((block) =>
        path === String(block.metadata.number) || path === `${block.metadata.hash}/cbor`);
      if (!selected) return new Response(null, { status: 404 });
      return new Response(path.endsWith('/cbor') ? new Uint8Array(selected.bytes) : JSON.stringify(selected.metadata));
    });
    return { state, request };
  }

  it('retains original bodies and accepted outputs/spends while excluding failed scripts', async () => {
    const fixture = restBlockFixture();
    source([fixture]);
    await expect(syncRestHistory(client, rest, { height: 100, hash: fixture.metadata.hash })).resolves.toBe(true);
    const transactions = (await client.query('SELECT tx_hash, invalid, tx_index FROM transaction ORDER BY tx_index')).rows;
    expect(transactions).toEqual(fixture.hashes.map((tx_hash, tx_index) => ({ tx_hash, tx_index, invalid: tx_index === 1 })));
    const outputs = (await client.query('SELECT * FROM address_utxo')).rows;
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ tx_hash: fixture.hashes[0], owner_addr_full: fixture.address, inline_datum: '00' });
    expect(outputs[0].amounts).toContainEqual(expect.objectContaining({ unit: fixture.unit, quantity: '1' }));
    expect((await client.query('SELECT spent_tx_hash FROM tx_input')).rows).toEqual([{ spent_tx_hash: fixture.hashes[0] }]);
    const bodies = (await client.query('SELECT cbor_data FROM transaction_cbor ORDER BY tx_hash')).rows.map((row) => row.cbor_data.toString('hex')).sort();
    expect(bodies).toEqual(fixture.bodies.map((body) => body.to_cbor_hex()).sort());
    expect((await client.query('SELECT cbor FROM block')).rows[0].cbor).toEqual(fixture.bytes);
  });

  it('rewinds raw outputs and spends after a fork and imports the replacement', async () => {
    // The application cache already exists before history is imported.
    await client.query(`CREATE TABLE ibc_state_tree_cache (
      id text PRIMARY KEY, root text NOT NULL, leaves_gzip bytea NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query("INSERT INTO ibc_state_tree_cache (id, root, leaves_gzip) VALUES ('current', 'app-root', $1)", [Buffer.from('app-cache')]);
    await ensureRestHistoryTables(client, 42);
    const first = restBlockFixture(100);
    const second = restBlockFixture(101, first.metadata.hash, [1], 3);
    const replacement = restBlockFixture(101, first.metadata.hash, [1], 5);
    const { state } = source([first, second]);
    await syncRestHistory(client, rest, { height: 100 });
    await syncRestHistory(client, rest, { height: 100 });
    state.blocks = [first, replacement];
    await syncRestHistory(client, rest, { height: 100 });
    expect((await client.query('SELECT hash FROM block ORDER BY number')).rows).toEqual([
      { hash: first.metadata.hash }, { hash: replacement.metadata.hash },
    ]);
    expect((await client.query('SELECT 1 FROM transaction WHERE tx_hash = ANY($1)', [second.hashes])).rows).toEqual([]);
    expect((await client.query('SELECT 1 FROM tx_input WHERE spent_tx_hash = ANY($1)', [second.hashes])).rows).toEqual([]);
    expect((await client.query('SELECT 1 FROM address_utxo WHERE tx_hash = ANY($1)', [second.hashes])).rows).toEqual([]);
    expect((await client.query('SELECT id, root, leaves_gzip FROM ibc_state_tree_cache')).rows).toEqual([
      { id: 'current', root: 'app-root', leaves_gzip: Buffer.from('app-cache') },
    ]);
  });

  it('waits for an observer behind the local tip without treating lag as a fork', async () => {
    const first = restBlockFixture(100);
    const second = restBlockFixture(101, first.metadata.hash, [1], 3);
    const { state } = source([first, second]);
    await syncRestHistory(client, rest, { height: 100 });
    await syncRestHistory(client, rest, { height: 100 });
    state.blocks = [first];
    await expect(syncRestHistory(client, rest, { height: 100 })).resolves.toBe(false);
    expect((await client.query('SELECT count(*)::int AS count FROM block')).rows[0].count).toBe(2);
    await expect(assertRestHistoryCanonical({ query: async (sql) => (await client.query(sql)).rows }, rest)).rejects.toThrow('index is behind');
  });

  it('requires the pinned checkpoint predecessor when an intersection block was omitted', async () => {
    const next = restBlockFixture(101);
    source([next]);
    await syncRestHistory(client, rest, { height: 100, hash: next.metadata.previous_block! });
    expect((await client.query('SELECT number FROM block')).rows[0].number).toBe('101');
  });

  it('rejects a checkpoint on another fork before writing its history', async () => {
    source([restBlockFixture()]);
    await expect(syncRestHistory(client, rest, { height: 100, hash: 'ff'.repeat(32) })).rejects.toThrow('another chain or fork');
    expect((await client.query('SELECT * FROM block')).rows).toEqual([]);
  });

  it('fails when the provider no longer retains the required checkpoint', async () => {
    source([restBlockFixture(102)]);
    await expect(syncRestHistory(client, rest, { height: 100 })).rejects.toThrow('does not retain block 100');
  });

  it('rejects REST metadata inconsistent with the raw header before writing rows', async () => {
    const fixture = restBlockFixture();
    await expect(importRestBlock(client, { ...fixture.metadata, slot: 2000 }, fixture.bytes)).rejects.toThrow('REST metadata');
    expect((await client.query('SELECT * FROM block')).rows).toEqual([]);
  });

  it('rolls back all writes when the source changes during an import', async () => {
    const original = restBlockFixture();
    const replacement = restBlockFixture(100, original.metadata.previous_block!, [1], 3);
    const { state, request } = source([original]);
    const serve = request.getMockImplementation()!;
    request.mockImplementation(async (...args) => {
      const response = await serve(...args);
      if (String(args[0]).endsWith('/cbor')) state.blocks = [replacement];
      return response;
    });
    await ensureBridgeHistoryTables(client);
    // The suite owns an outer transaction. Savepoints model the worker's lease.
    const lease = {
      query: (sql: string, values?: unknown[]) => client.query(
        sql.startsWith('BEGIN') ? 'SAVEPOINT import_attempt' :
          sql === 'COMMIT' ? 'RELEASE SAVEPOINT import_attempt' :
            sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT import_attempt' : sql, values),
      release: jest.fn(),
    };
    await expect(processNextBlock({ connect: async () => lease } as never, null, rest, { height: 100 })).rejects.toThrow('changed during history import');
    expect((await client.query('SELECT * FROM block')).rows).toEqual([]);
    expect((await client.query('SELECT * FROM transaction')).rows).toEqual([]);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it('refuses existing Yaci SQL tables and history for a different network', async () => {
    await expect(ensureRestHistoryTables(client, 1)).rejects.toThrow('another Cardano network');
    await client.query('DROP TABLE bridge_rest_history_identity');
    await expect(ensureRestHistoryTables(client, 42)).rejects.toThrow('Do not point it at Yaci');
  });
});
