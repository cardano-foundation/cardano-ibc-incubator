import { Pool, PoolClient } from 'pg';
import { YaciHistoryService } from '../services/yaci-history.service';

const url = process.env.BRIDGE_HISTORY_TEST_DATABASE_URL;
const withDatabase = url ? describe : describe.skip;

withDatabase('canonical historical HostState lookup (PostgreSQL)', () => {
  const policy = 'ab'.repeat(28), name = '6962635f686f73745f7374617465';
  const schema = `host_lookup_${process.pid}`;
  let pool: Pool, db: PoolClient, service: YaciHistoryService;
  beforeAll(() => { pool = new Pool({ connectionString: url, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    db = await pool.connect();
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}`);
    await db.query(`
      CREATE TABLE block(number bigint PRIMARY KEY, hash text);
      CREATE TABLE transaction(tx_hash text PRIMARY KEY, block bigint, block_hash text, tx_index integer, invalid boolean);
      CREATE TABLE address_utxo(tx_hash text, output_index integer, block bigint, owner_addr text, owner_addr_full text, inline_datum text, data_hash text, amounts jsonb);
      CREATE TABLE tx_input(tx_hash text, output_index integer, spent_tx_hash text, spent_at_block bigint, spent_at_block_hash text);
      CREATE TABLE bridge_utxo_history(tx_hash text, output_index integer, tx_id bigint, assets_policy text, assets_name text, datum text, block_no bigint);
      INSERT INTO block VALUES (10,'block10'),(20,'block20');
      INSERT INTO transaction VALUES ('old',10,'block10',0,false),('new',20,'block20',0,false);
      INSERT INTO tx_input VALUES ('old',0,'new',20,'block20');
    `);
    for (const [hash, height] of [['old', 10], ['new', 20]] as const) {
      await db.query('INSERT INTO address_utxo VALUES ($1,0,$2,$3,NULL,$4,NULL,$5)',
        [hash, height, `${hash}-address`, `${hash}-raw-datum`, JSON.stringify([{ unit: policy + name, quantity: '1' }])]);
      await db.query('INSERT INTO bridge_utxo_history VALUES ($1,0,$2,$3,$4,$5,$2)',
        [hash, height, policy, name, 'untrusted-projection-datum']);
    }
    service = new YaciHistoryService({ get: () => ({ hostStateNFT: { policyId: policy, name } }) } as never,
      {} as never, { query: async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows } as never);
  });
  afterEach(async () => { try { await db.query('ROLLBACK'); } finally { db.release(); } });

  it('uses raw canonical data and the NFT unspent at the requested height', async () => {
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(10n)).toMatchObject({ txHash: 'old', datum: 'old-raw-datum' });
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(20n)).toMatchObject({ txHash: 'new', datum: 'new-raw-datum' });
  });
  it('ignores stale projection rows and rolled-back spends after the canonical block changes', async () => {
    await db.query("UPDATE block SET hash='replacement20' WHERE number=20");
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(20n)).toMatchObject({ txHash: 'old' });
  });
  it('authenticates generic channel/client NFT lookups against the same canonical outputs and spends', async () => {
    expect(await service.findUtxoByUnitAtOrBeforeBlockNo(policy + name, 20n)).toMatchObject({ txHash: 'new', datum: 'new-raw-datum' });
    await db.query("UPDATE block SET hash='replacement20' WHERE number=20");
    expect(await service.findUtxoByUnitAtOrBeforeBlockNo(policy + name, 20n)).toMatchObject({ txHash: 'old', datum: 'old-raw-datum' });
    await db.query("DELETE FROM bridge_utxo_history WHERE tx_hash='old'");
    await expect(service.findUtxoByUnitAtOrBeforeBlockNo(policy + name, 20n)).rejects.toThrow('not found at or before');
  });
  it('fails closed when the successor projection is missing instead of returning the spent predecessor', async () => {
    await db.query("DELETE FROM bridge_utxo_history WHERE tx_hash='new'");
    await expect(service.findHostStateUtxoAtOrBeforeBlockNo(20n)).rejects.toThrow('HostState UTxO not found');
  });
  it.each(['0', '2'])('rejects a projected HostState with raw NFT quantity %s', async (quantity) => {
    await db.query("UPDATE address_utxo SET amounts=$1 WHERE tx_hash='new'", [JSON.stringify([{ unit: policy + name, quantity }])]);
    await expect(service.findHostStateUtxoAtOrBeforeBlockNo(20n)).rejects.toThrow('HostState UTxO not found');
  });
  it('rejects ambiguous live NFTs when canonical spend evidence is missing', async () => {
    await db.query('DELETE FROM tx_input');
    await expect(service.findHostStateUtxoAtOrBeforeBlockNo(20n)).rejects.toThrow('Multiple canonical HostState UTxO outputs');
  });
  it('does not count an invalid consuming transaction as an authentic state transition', async () => {
    await db.query("UPDATE transaction SET invalid=true WHERE tx_hash='new'");
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(20n)).toMatchObject({ txHash: 'old' });
  });
});
