import { upgradeHistoryArtifact } from './history-upgrade';
import { Pool, PoolClient } from 'pg';
import * as Lucid from '@lucid-evolution/lucid';
import { verifyHistoryCoverage } from './history-coverage';
import { requireHistoryBootstrap } from '@cardano-ibc/tx-builder-runtime/historyBootstrap';
import { BridgeManifest } from './bridge-manifest';
import { encodeHostStateDatum, decodeHostStateDatum } from '../shared/types/host-state-datum';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const policy = 'aa'.repeat(28);
let anchorHash = hash(2);
const history = {
  format: 'cardano-history-v1',
  start: { slot: 1000, block_hash: hash(100), block_height: 100 },
  host_state_nft_mint: { tx_hash: anchorHash, output_index: 0 },
};
const manifest = () =>
  ({
    cardano: { network_magic: 2, chain_id: 'cardano-preview', network: 'Preview' },
    history: structuredClone(history),
    host_state_nft: { policy_id: policy, token_name: '01' },
    validators: { host_state_stt: { ref_utxo: { tx_hash: hash(1), output_index: 0 } } },
  }) as unknown as BridgeManifest;

describe('manifest replay metadata', () => {
  it('requires an explicit public replay point and creation anchor', () => {
    expect(requireHistoryBootstrap(history, 2)).toEqual(history);
    for (const invalid of [
      undefined,
      { ...history, format: 'future' },
      { ...history, start: 'origin' },
      { ...history, start: { ...history.start, slot: '1000' } },
      { ...history, host_state_nft_mint: { tx_hash: 'bad', output_index: 0 } },
    ]) {
      expect(() => requireHistoryBootstrap(invalid, 2)).toThrow('bridge history bootstrap');
    }
  });
});

const url = process.env.BRIDGE_HISTORY_TEST_DATABASE_URL;
(url ? describe : describe.skip)('manifest history coverage on PostgreSQL', () => {
  let pool: Pool;
  let db: PoolClient;
  const sql = { query: async (text: string, values?: unknown[]) => (await db.query(text, values)).rows };
  const verify = (m = manifest()) => verifyHistoryCoverage(sql, m, { txHash: hash(3), outputIndex: 0 });
  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    db = await pool.connect();
    await db.query('BEGIN');
    await db.query('CREATE SCHEMA bridge_bootstrap_test');
    await db.query('SET LOCAL search_path TO bridge_bootstrap_test');
    await db.query(`CREATE TABLE block(number bigint PRIMARY KEY, hash text, prev_hash text, slot bigint, epoch int);
      CREATE TABLE transaction(tx_hash text PRIMARY KEY, block bigint, block_hash text, invalid boolean, tx_index int DEFAULT 0);
      CREATE TABLE transaction_cbor(tx_hash text PRIMARY KEY, cbor_data bytea);
      CREATE TABLE address_utxo(tx_hash text, output_index int, block bigint, inline_datum text, amounts jsonb);`);
    const datum = await encodeHostStateDatum(
      {
        state: {
          ibc_state_root: '00'.repeat(32),
          version: 0n,
          next_client_sequence: 0n,
          next_connection_sequence: 0n,
          next_channel_sequence: 0n,
          bound_port: [],
          last_update_time: 0n,
        },
        nft_policy: policy,
        deployer: 'bb'.repeat(28),
        control: { port_registry: new Map(), shutdown: 'Active' },
      },
      Lucid,
    );
    const inputs = Lucid.CML.TransactionInputList.new();
    inputs.add(Lucid.CML.TransactionInput.new(Lucid.CML.TransactionHash.from_hex(hash(900)), 0n));
    const outputs = Lucid.CML.TransactionOutputList.new();
    outputs.add(
      Lucid.utxoToCore({
        txHash: hash(0),
        outputIndex: 0,
        address: Lucid.validatorToAddress('Preview', { type: 'PlutusV3', script: '49480100002221200101' }),
        assets: { lovelace: 2_000_000n, [policy + '01']: 1n },
        datum,
      }).output(),
    );
    const body = Lucid.CML.TransactionBody.new(inputs, outputs, 200_000n);
    const mint = Lucid.CML.Mint.new();
    mint.set(Lucid.CML.ScriptHash.from_hex(policy), Lucid.CML.AssetName.from_hex('01'), 1n);
    body.set_mint(mint);
    anchorHash = Lucid.CML.hash_transaction(body).to_hex();
    history.host_state_nft_mint.tx_hash = anchorHash;
    const creationCbor = Lucid.CML.Transaction.new(body, Lucid.CML.TransactionWitnessSet.new(), true).to_cbor_hex();
    const liveDatum = await decodeHostStateDatum(datum, Lucid);
    liveDatum.state.version = 1n;
    const liveEncoded = await encodeHostStateDatum(liveDatum, Lucid);
    for (let n = 100; n <= 103; n++)
      await db.query('INSERT INTO block VALUES ($1,$2,$3,$4,$5)', [
        n,
        hash(n),
        hash(n - 1),
        n * 10,
        n === 100 ? 8 : 10,
      ]);
    for (let n = 1; n <= 3; n++) {
      await db.query('INSERT INTO transaction(tx_hash,block,block_hash,invalid) VALUES ($1,$2,$3,false)', [
        n === 2 ? anchorHash : hash(n),
        n + 100,
        hash(n + 100),
      ]);
      await db.query("INSERT INTO transaction_cbor VALUES ($1,decode($2,'hex'))", [
        n === 2 ? anchorHash : hash(n),
        n === 2 ? creationCbor : 'aa',
      ]);
      await db.query('INSERT INTO address_utxo VALUES ($1,0,$2,$3,$4)', [
        n === 2 ? anchorHash : hash(n),
        n + 100,
        n === 3 ? liveEncoded : datum,
        JSON.stringify(n === 1 ? [] : [{ unit: policy + '01', quantity: '1' }]),
      ]);
    }
  });
  afterEach(async () => {
    await db.query('ROLLBACK');
    db.release();
  });
  it('upgrades a month-old artifact from original evidence without changing contracts or trusting its timestamp', async () => {
    const old = { ...manifest(), deployed_at: '2000-01-01T00:00:00Z', schema_version: 4 } as any;
    delete old.history;
    const upgraded = await upgradeHistoryArtifact(db, old);
    expect(upgraded).toEqual({ ...old, history });
    expect(old.history).toBeUndefined();
    await db.query('DELETE FROM address_utxo WHERE tx_hash=$1', [anchorHash]);
    await expect(upgradeHistoryArtifact(db, old)).rejects.toThrow();
  });
  it('detects missing blocks even when every required output and transaction is present', async () => {
    await db.query('INSERT INTO block VALUES (105,$1,$2,1050,10)', [hash(105), hash(104)]);
    await db.query('UPDATE transaction SET block=105, block_hash=$1 WHERE tx_hash=$2', [hash(105), hash(3)]);
    await db.query('UPDATE address_utxo SET block=105 WHERE tx_hash=$1', [hash(3)]);
    await expect(verify()).rejects.toThrow('block history contains gaps');
  });
  it('accepts complete retained history, even when chain sync omitted the intersection block', async () => {
    await verify();
    await db.query('DELETE FROM block WHERE number=100');
    await verify();
  });
  it.each(['anchor', 'cbor', 'block', 'datum', 'nft', 'validity', 'live'])(
    'refuses readiness with missing or invalid %s',
    async (field) => {
      if (field === 'anchor') await db.query('DELETE FROM address_utxo WHERE tx_hash=$1', [anchorHash]);
      if (field === 'cbor') await db.query('DELETE FROM transaction_cbor WHERE tx_hash=$1', [anchorHash]);
      if (field === 'block') await db.query('DELETE FROM block WHERE number=102');
      if (field === 'datum') await db.query('UPDATE address_utxo SET inline_datum=NULL WHERE tx_hash=$1', [anchorHash]);
      if (field === 'nft') await db.query("UPDATE address_utxo SET amounts='[]' WHERE tx_hash=$1", [anchorHash]);
      if (field === 'validity') await db.query('UPDATE transaction SET invalid=true WHERE tx_hash=$1', [anchorHash]);
      if (field === 'live') await db.query('DELETE FROM transaction WHERE tx_hash=$1', [hash(3)]);
      await expect(verify()).rejects.toThrow('Bridge history is not ready');
    },
  );
  it('rejects a continuation advertised as creation even when the datum version is zero', async () => {
    const { rows } = await db.query('SELECT cbor_data FROM transaction_cbor WHERE tx_hash=$1', [anchorHash]);
    const tx = Lucid.CML.Transaction.from_cbor_hex(Buffer.from(rows[0].cbor_data).toString('hex'));
    const original = tx.body();
    const body = Lucid.CML.TransactionBody.new(original.inputs(), original.outputs(), original.fee());
    const continuationHash = Lucid.CML.hash_transaction(body).to_hex();
    const cbor = Lucid.CML.Transaction.new(body, Lucid.CML.TransactionWitnessSet.new(), true).to_cbor_hex();
    await db.query('UPDATE transaction SET tx_hash=$1 WHERE tx_hash=$2', [continuationHash, anchorHash]);
    await db.query('UPDATE address_utxo SET tx_hash=$1 WHERE tx_hash=$2', [continuationHash, anchorHash]);
    await db.query("UPDATE transaction_cbor SET tx_hash=$1,cbor_data=decode($2,'hex') WHERE tx_hash=$3", [
      continuationHash,
      cbor,
      anchorHash,
    ]);
    const m = manifest();
    m.history!.host_state_nft_mint.tx_hash = continuationHash;
    await expect(verify(m)).rejects.toThrow('must mint exactly');
  });
  it('rejects replaced raw transaction evidence with the original anchor hash', async () => {
    await db.query("UPDATE transaction_cbor SET cbor_data=decode('aa','hex') WHERE tx_hash=$1", [anchorHash]);
    await expect(verify()).rejects.toThrow('hash-checked NFT mint evidence');
  });
  it('rejects a recent checkpoint that skipped deployment and an unrelated chain point', async () => {
    const late = manifest();
    late.history!.start = { slot: 1020, block_hash: hash(102), block_height: 102 };
    await expect(verify(late)).rejects.toThrow('checkpoint does not precede');
    const wrong = manifest();
    (wrong.history!.start as any).block_hash = hash(999);
    await expect(verify(wrong)).rejects.toThrow('another chain or fork');
  });
});
