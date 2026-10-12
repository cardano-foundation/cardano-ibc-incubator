import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2b';
import type { PoolClient } from 'pg';
import { YaciRestClient, type YaciRestBlock } from '../shared/helpers/yaci-rest';

/** Gateway-owned raw history. Yaci's SQL schema is never read or modified. */
export async function ensureRestHistoryTables(database: Pick<PoolClient, 'query'>, networkMagic = Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || 42)): Promise<void> {
  if (!Number.isSafeInteger(networkMagic) || networkMagic < 0) throw new Error('Invalid Cardano history network magic');
  const [existing] = (await database.query<{ raw: string | null; imported: string | null }>(
    "SELECT to_regclass('block')::text AS raw, to_regclass('bridge_rest_history_identity')::text AS imported",
  )).rows;
  if (existing?.raw && !existing.imported)
    throw new Error('HISTORY_DB must be a fresh Gateway-owned database. Do not point it at Yaci Store PostgreSQL');
  await database.query(`
    CREATE TABLE IF NOT EXISTS bridge_rest_history_identity (
      id integer PRIMARY KEY CHECK (id = 1), network_magic bigint NOT NULL
    );
    CREATE TABLE IF NOT EXISTS block (
      number bigint PRIMARY KEY, hash text NOT NULL UNIQUE, prev_hash text,
      slot bigint NOT NULL, epoch integer NOT NULL, block_time timestamptz NOT NULL,
      slot_leader text NOT NULL, no_of_txs integer NOT NULL, cbor bytea NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rest_block_epoch ON block(epoch, number);
    CREATE TABLE IF NOT EXISTS transaction (
      tx_hash text PRIMARY KEY, block bigint NOT NULL, block_hash text NOT NULL,
      tx_index integer NOT NULL, slot bigint NOT NULL, invalid boolean NOT NULL,
      fee numeric NOT NULL, UNIQUE(block, tx_index)
    );
    CREATE TABLE IF NOT EXISTS transaction_cbor (
      tx_hash text PRIMARY KEY, cbor_data bytea NOT NULL, cbor_size integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS address_utxo (
      tx_hash text NOT NULL, output_index integer NOT NULL, block bigint NOT NULL,
      owner_addr text NOT NULL, owner_addr_full text NOT NULL, data_hash text,
      inline_datum text, reference_script_hash text, amounts jsonb NOT NULL,
      PRIMARY KEY(tx_hash, output_index)
    );
    CREATE INDEX IF NOT EXISTS idx_rest_output_block ON address_utxo(block);
    CREATE INDEX IF NOT EXISTS idx_rest_output_address ON address_utxo(owner_addr_full, block);
    CREATE INDEX IF NOT EXISTS idx_rest_output_assets ON address_utxo USING gin(amounts);
    CREATE TABLE IF NOT EXISTS tx_input (
      tx_hash text NOT NULL, output_index integer NOT NULL, spent_tx_hash text NOT NULL,
      spent_at_block bigint NOT NULL, spent_at_block_hash text NOT NULL,
      PRIMARY KEY(spent_tx_hash, tx_hash, output_index)
    );
    CREATE INDEX IF NOT EXISTS idx_rest_input_output ON tx_input(tx_hash, output_index, spent_at_block);
    CREATE INDEX IF NOT EXISTS idx_rest_input_block ON tx_input(spent_at_block);
  `);
  await database.query('INSERT INTO bridge_rest_history_identity VALUES (1, $1) ON CONFLICT DO NOTHING', [networkMagic]);
  const [identity] = (await database.query<{ network_magic: string }>('SELECT network_magic::text AS network_magic FROM bridge_rest_history_identity WHERE id = 1')).rows;
  if (!identity || identity.network_magic !== String(networkMagic))
    throw new Error('Gateway-owned history belongs to another Cardano network. Use a separate history database');
}

function outputAmounts(output: CML.TransactionOutput) {
  const value = output.amount();
  const amounts: Array<{ unit: string; quantity: string; policy_id: string | null; asset_name: string | null }> = [
    { unit: 'lovelace', quantity: value.coin().toString(), policy_id: null, asset_name: null },
  ];
  const multi = value.multi_asset();
  const policies = multi.keys();
  for (let p = 0; p < policies.len(); p++) {
    const policy = policies.get(p);
    const assets = multi.get_assets(policy)!;
    const names = assets.keys();
    for (let a = 0; a < names.len(); a++) {
      const name = names.get(a);
      amounts.push({
        unit: policy.to_hex() + name.to_hex(), quantity: assets.get(name)!.toString(),
        policy_id: policy.to_hex(), asset_name: name.to_hex(),
      });
    }
  }
  return amounts;
}

/** Checks REST metadata against the raw header and uses the block's validity list. */
function decodeRestBlock(metadata: YaciRestBlock, bytes: Buffer): CML.Block {
  const block = CML.Block.from_cbor_bytes(bytes);
  const header = block.header();
  const body = header.header_body();
  const hash = Buffer.from(blake2b(header.to_cbor_bytes(), { dkLen: 32 })).toString('hex');
  if (hash !== metadata.hash || body.block_number() !== BigInt(metadata.number) ||
      body.slot() !== BigInt(metadata.slot) || (body.prev_hash()?.to_hex() ?? null) !== metadata.previous_block ||
      block.transaction_bodies().len() !== metadata.tx_count ||
      block.transaction_witness_sets().len() !== metadata.tx_count)
    throw new Error('Yaci raw block does not match its REST metadata');
  const invalid = [...block.invalid_transactions()];
  if (new Set(invalid).size !== invalid.length || invalid.some((index) => index >= metadata.tx_count))
    throw new Error('Yaci raw block has invalid transaction validity evidence');
  return block;
}

export async function importRestBlock(database: Pick<PoolClient, 'query'>, metadata: YaciRestBlock, bytes: Buffer): Promise<void> {
  const block = decodeRestBlock(metadata, bytes);
  const invalid = new Set(block.invalid_transactions());
  await database.query(`INSERT INTO block(number, hash, prev_hash, slot, epoch, block_time, slot_leader, no_of_txs, cbor)
    VALUES ($1,$2,$3,$4,$5,to_timestamp($6),$7,$8,$9)`,
    [metadata.number, metadata.hash, metadata.previous_block, metadata.slot, metadata.epoch, metadata.time, metadata.slot_leader, metadata.tx_count, bytes]);
  const bodies = block.transaction_bodies();
  for (let index = 0; index < bodies.len(); index++) {
    const body = bodies.get(index);
    const hash = CML.hash_transaction(body).to_hex();
    // Keep the original body encoding. Canonical reserialization can change its hash.
    const cbor = Buffer.from(body.to_cbor_bytes());
    await database.query(`INSERT INTO transaction(tx_hash, block, block_hash, tx_index, slot, invalid, fee)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [hash, metadata.number, metadata.hash, index, metadata.slot, invalid.has(index), body.fee().toString()]);
    await database.query('INSERT INTO transaction_cbor(tx_hash, cbor_data, cbor_size) VALUES ($1,$2,$3)', [hash, cbor, cbor.length]);
    // Failed phase-2 transactions never create normal state outputs or spend normal inputs.
    if (invalid.has(index)) continue;
    const outputs = body.outputs();
    for (let outputIndex = 0; outputIndex < outputs.len(); outputIndex++) {
      const output = outputs.get(outputIndex);
      const datum = output.datum();
      const inline = datum?.as_datum();
      const datumHash = inline ? CML.hash_plutus_data(inline).to_hex() : datum?.as_hash()?.to_hex() ?? null;
      const script = output.script_ref();
      await database.query(`INSERT INTO address_utxo(tx_hash, output_index, block, owner_addr, owner_addr_full, data_hash, inline_datum, reference_script_hash, amounts)
        VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8::jsonb)`,
        [hash, outputIndex, metadata.number, output.address().to_bech32(), datumHash, inline?.to_cbor_hex() ?? null,
          script?.hash().to_hex() ?? null, JSON.stringify(outputAmounts(output))]);
    }
    const inputs = body.inputs();
    for (let inputIndex = 0; inputIndex < inputs.len(); inputIndex++) {
      const input = inputs.get(inputIndex);
      await database.query(`INSERT INTO tx_input(tx_hash, output_index, spent_tx_hash, spent_at_block, spent_at_block_hash)
        VALUES ($1,$2,$3,$4,$5)`, [input.transaction_id().to_hex(), input.index(), hash, metadata.number, metadata.hash]);
    }
  }
}

async function deleteRawHistory(database: Pick<PoolClient, 'query'>, first: number): Promise<void> {
  await database.query('DELETE FROM transaction_cbor WHERE tx_hash IN (SELECT tx_hash FROM transaction WHERE block >= $1)', [first]);
  await database.query('DELETE FROM address_utxo WHERE block >= $1', [first]);
  await database.query('DELETE FROM tx_input WHERE spent_at_block >= $1', [first]);
  await database.query('DELETE FROM transaction WHERE block >= $1', [first]);
  await database.query('DELETE FROM block WHERE number >= $1', [first]);
}

/** Called inside the projection's transaction so raw history and projection rewind together. */
export async function syncRestHistory(
  database: Pick<PoolClient, 'query'>,
  rest: YaciRestClient,
  start: { height: number; hash?: string },
): Promise<boolean> {
  const remoteTip = await rest.block('latest');
  if (!remoteTip) return false;
  let tip = (await database.query<{ number: string; hash: string }>('SELECT number::text AS number, hash FROM block ORDER BY number DESC LIMIT 1')).rows[0];
  // A behind observer is not evidence of a fork. Stop serving until it catches up.
  if (tip && Number(tip.number) > remoteTip.number) return false;
  let rewind: number | undefined;
  for (let checked = 0; tip; checked++) {
    if (checked >= 10_000) throw new Error('REST history rollback exceeds 10000 blocks. Restore history from the manifest checkpoint');
    const canonical = await rest.block(BigInt(tip.number));
    if (!canonical) throw new Error(`Yaci no longer retains required block ${tip.number}`);
    if (canonical.hash === tip.hash) break;
    rewind = Number(tip.number);
    tip = (await database.query<{ number: string; hash: string }>('SELECT number::text AS number, hash FROM block WHERE number < $1 ORDER BY number DESC LIMIT 1', [tip.number])).rows[0];
  }
  if (rewind !== undefined) await deleteRawHistory(database, rewind);
  const height = tip ? Number(tip.number) + 1 : start.height;
  if (height > remoteTip.number) return rewind !== undefined;
  let next = await rest.block(height);
  // Chain sync may omit the intersection block itself. The successor pins its hash.
  if (!next && !tip) next = await rest.block(height + 1);
  if (!next) throw new Error(`Yaci does not retain block ${height} required by the bridge history checkpoint`);
  if (tip && (next.number !== Number(tip.number) + 1 || next.previous_block !== tip.hash))
    throw new Error('Yaci REST block history is incomplete or changed during import');
  if (!tip && start.hash &&
      (next.number === start.height ? next.hash !== start.hash : next.previous_block !== start.hash))
    throw new Error('Yaci REST history checkpoint belongs to another chain or fork');
  await importRestBlock(database, next, await rest.blockCbor(next.hash));
  const canonical = await rest.block(next.number);
  if (!canonical || canonical.hash !== next.hash) throw new Error('Yaci REST block changed during history import');
  return true;
}
