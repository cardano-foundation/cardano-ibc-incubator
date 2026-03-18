import { Pool, PoolClient } from 'pg';

type YaciTxRow = {
  tx_hash: string;
  fee: string | number | null;
  block: string | number;
  block_hash: string;
  tx_index: number;
  slot: string | number;
};

type YaciAddressUtxoRow = {
  tx_hash: string;
  output_index: number;
  owner_addr: string | null;
  owner_addr_full: string | null;
  data_hash: string | null;
  inline_datum: string | null;
  reference_script_hash: string | null;
  amounts: Array<{
    unit: string;
    quantity: string | number;
    policy_id: string | null;
    asset_name: string | null;
  }> | null;
};

type SpoEventRow = {
  tx_hash: string;
};

type BridgeTxInsertRow = {
  id: number;
};

const pollIntervalMs = Number(process.env.BRIDGE_HISTORY_SYNC_INTERVAL_MS || 2000);
const historyPool = new Pool({
  host: process.env.HISTORY_DB_HOST || process.env.DBSYNC_HOST || 'yaci-postgres',
  port: Number(process.env.HISTORY_DB_PORT || process.env.DBSYNC_PORT || 5432),
  database: process.env.HISTORY_DB_NAME || process.env.DBSYNC_NAME || 'yaci_store',
  user: process.env.HISTORY_DB_USERNAME || process.env.DBSYNC_USERNAME || 'yaci',
  password: process.env.HISTORY_DB_PASSWORD || process.env.DBSYNC_PASSWORD || 'dbpass',
});

async function ensureBridgeHistoryTables() {
  await historyPool.query(`
    CREATE TABLE IF NOT EXISTS bridge_history_sync_state (
      cursor_name text PRIMARY KEY,
      last_block bigint NOT NULL DEFAULT -1,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bridge_tx_history (
      id bigserial PRIMARY KEY,
      tx_hash varchar(64) NOT NULL UNIQUE,
      gas_fee bigint NOT NULL DEFAULT 0,
      tx_size integer NOT NULL DEFAULT 0,
      block_no bigint NOT NULL,
      block_hash varchar(64),
      slot_no bigint,
      tx_index integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_tx_history_block_no
      ON bridge_tx_history(block_no, tx_index);

    CREATE TABLE IF NOT EXISTS bridge_utxo_history (
      tx_hash varchar(64) NOT NULL,
      tx_id bigint NOT NULL,
      output_index integer NOT NULL,
      address text NOT NULL,
      datum text,
      datum_hash varchar(64),
      assets_policy varchar(56) NOT NULL,
      assets_name text NOT NULL,
      block_no bigint NOT NULL,
      block_id bigint NOT NULL,
      tx_index integer NOT NULL DEFAULT 0,
      reference_script_hash varchar(56),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tx_hash, output_index, assets_policy, assets_name)
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_utxo_history_block_no
      ON bridge_utxo_history(block_no, tx_index, output_index);

    CREATE INDEX IF NOT EXISTS idx_bridge_utxo_history_asset
      ON bridge_utxo_history(assets_policy, assets_name);

    CREATE TABLE IF NOT EXISTS bridge_spo_event_history (
      event_type text NOT NULL,
      tx_hash varchar(64) NOT NULL,
      block_no bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (event_type, tx_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_spo_event_history_block_no
      ON bridge_spo_event_history(block_no, event_type);

    INSERT INTO bridge_history_sync_state(cursor_name, last_block)
    VALUES ('default', -1)
    ON CONFLICT (cursor_name) DO NOTHING;
  `);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBigInt(value: string | number | null | undefined): bigint {
  return BigInt(value ?? 0);
}

function buildBridgeUtxoRows(
  utxoRows: YaciAddressUtxoRow[],
  txIdsByHash: Map<string, number>,
  txIndexesByHash: Map<string, number>,
  blockNo: number,
) {
  const rows: Array<{
    txHash: string;
    txId: number;
    outputIndex: number;
    address: string;
    datum: string | null;
    datumHash: string | null;
    assetsPolicy: string;
    assetsName: string;
    blockNo: number;
    blockId: number;
    txIndex: number;
    referenceScriptHash: string | null;
  }> = [];

  for (const utxoRow of utxoRows) {
    const txHash = utxoRow.tx_hash.toLowerCase();
    const txId = txIdsByHash.get(txHash);
    if (!txId) {
      continue;
    }

    const amounts = utxoRow.amounts ?? [];
    if (amounts.length < 2) {
      continue;
    }

    const address = utxoRow.owner_addr_full || utxoRow.owner_addr;
    if (!address) {
      continue;
    }

    for (const amountRow of amounts) {
      const policyId = amountRow.policy_id?.toLowerCase();
      if (!policyId || amountRow.unit === 'lovelace') {
        continue;
      }

      const quantity = toBigInt(amountRow.quantity);
      if (quantity <= 0n) {
        continue;
      }

      const unit = amountRow.unit.toLowerCase();
      const assetName = unit.startsWith(policyId) ? unit.slice(policyId.length) : unit;
      rows.push({
        txHash,
        txId,
        outputIndex: Number(utxoRow.output_index),
        address,
        datum: utxoRow.inline_datum,
        datumHash: utxoRow.data_hash?.toLowerCase?.() || null,
        assetsPolicy: policyId,
        assetsName: assetName,
        blockNo,
        blockId: blockNo,
        txIndex: txIndexesByHash.get(txHash) ?? 0,
        referenceScriptHash: utxoRow.reference_script_hash?.toLowerCase?.() || null,
      });
    }
  }

  return rows;
}

async function upsertBridgeTx(client: PoolClient, row: YaciTxRow): Promise<number> {
  const result = await client.query<BridgeTxInsertRow>(
    `
      INSERT INTO bridge_tx_history(tx_hash, gas_fee, tx_size, block_no, block_hash, slot_no, tx_index, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (tx_hash) DO UPDATE SET
        gas_fee = EXCLUDED.gas_fee,
        tx_size = EXCLUDED.tx_size,
        block_no = EXCLUDED.block_no,
        block_hash = EXCLUDED.block_hash,
        slot_no = EXCLUDED.slot_no,
        tx_index = EXCLUDED.tx_index,
        updated_at = now()
      RETURNING id
    `,
    [
      row.tx_hash.toLowerCase(),
      Number(row.fee ?? 0),
      0,
      Number(row.block),
      row.block_hash?.toLowerCase?.() || null,
      Number(row.slot),
      Number(row.tx_index ?? 0),
    ],
  );

  return result.rows[0].id;
}

async function processBlock(client: PoolClient, blockNo: number): Promise<boolean> {
  const txResult = await client.query<YaciTxRow>(
    `
      SELECT tx_hash, fee, block, block_hash, tx_index, slot
      FROM transaction
      WHERE block = $1
      ORDER BY tx_index ASC, tx_hash ASC
    `,
    [blockNo],
  );

  if (txResult.rows.length === 0) {
    await client.query(
      `UPDATE bridge_history_sync_state SET last_block = $1, updated_at = now() WHERE cursor_name = 'default'`,
      [blockNo],
    );
    return true;
  }

  const txHashes = txResult.rows.map((row) => row.tx_hash.toLowerCase());
  const txIdsByHash = new Map<string, number>();
  const txIndexesByHash = new Map<string, number>();

  for (const txRow of txResult.rows) {
    const txHash = txRow.tx_hash.toLowerCase();
    const txId = await upsertBridgeTx(client, txRow);
    txIdsByHash.set(txHash, txId);
    txIndexesByHash.set(txHash, Number(txRow.tx_index ?? 0));
  }

  const utxoResult = await client.query<YaciAddressUtxoRow>(
    `
      SELECT tx_hash, output_index, owner_addr, owner_addr_full, data_hash, inline_datum, reference_script_hash, amounts
      FROM address_utxo
      WHERE block = $1
        AND tx_hash = ANY($2::varchar[])
      ORDER BY tx_hash ASC, output_index ASC
    `,
    [blockNo, txHashes],
  );

  const outputRows = buildBridgeUtxoRows(utxoResult.rows, txIdsByHash, txIndexesByHash, blockNo);
  for (const outputRow of outputRows) {
    await client.query(
      `
        INSERT INTO bridge_utxo_history(
          tx_hash,
          tx_id,
          output_index,
          address,
          datum,
          datum_hash,
          assets_policy,
          assets_name,
          block_no,
          block_id,
          tx_index,
          reference_script_hash,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
        ON CONFLICT (tx_hash, output_index, assets_policy, assets_name) DO UPDATE SET
          tx_id = EXCLUDED.tx_id,
          address = EXCLUDED.address,
          datum = EXCLUDED.datum,
          datum_hash = EXCLUDED.datum_hash,
          block_no = EXCLUDED.block_no,
          block_id = EXCLUDED.block_id,
          tx_index = EXCLUDED.tx_index,
          reference_script_hash = EXCLUDED.reference_script_hash,
          updated_at = now()
      `,
      [
        outputRow.txHash,
        outputRow.txId,
        outputRow.outputIndex,
        outputRow.address,
        outputRow.datum,
        outputRow.datumHash,
        outputRow.assetsPolicy,
        outputRow.assetsName,
        outputRow.blockNo,
        outputRow.blockId,
        outputRow.txIndex,
        outputRow.referenceScriptHash,
      ],
    );
  }

  const poolRegistrations = await client.query<SpoEventRow>(
    `SELECT tx_hash FROM pool_registration WHERE block = $1 ORDER BY tx_index ASC`,
    [blockNo],
  );
  for (const row of poolRegistrations.rows) {
    await client.query(
      `
        INSERT INTO bridge_spo_event_history(event_type, tx_hash, block_no)
        VALUES ('register', $1, $2)
        ON CONFLICT (event_type, tx_hash) DO UPDATE SET block_no = EXCLUDED.block_no
      `,
      [row.tx_hash.toLowerCase(), blockNo],
    );
  }

  const poolRetirements = await client.query<SpoEventRow>(
    `SELECT tx_hash FROM pool_retirement WHERE block = $1 ORDER BY tx_index ASC`,
    [blockNo],
  );
  for (const row of poolRetirements.rows) {
    await client.query(
      `
        INSERT INTO bridge_spo_event_history(event_type, tx_hash, block_no)
        VALUES ('unregister', $1, $2)
        ON CONFLICT (event_type, tx_hash) DO UPDATE SET block_no = EXCLUDED.block_no
      `,
      [row.tx_hash.toLowerCase(), blockNo],
    );
  }

  await client.query(
    `UPDATE bridge_history_sync_state SET last_block = $1, updated_at = now() WHERE cursor_name = 'default'`,
    [blockNo],
  );
  process.stdout.write(`bridge-history-sync indexed block ${blockNo}\n`);
  return true;
}

async function processNextBlock(): Promise<boolean> {
  const client = await historyPool.connect();
  try {
    await client.query('BEGIN');

    const nextBlockResult = await client.query<{ block_no: string | null }>(
      `
        SELECT MIN(block)::text AS block_no
        FROM transaction
        WHERE block > (
          SELECT last_block
          FROM bridge_history_sync_state
          WHERE cursor_name = 'default'
        )
      `,
    );

    const nextBlock = nextBlockResult.rows[0]?.block_no;
    if (!nextBlock) {
      await client.query('ROLLBACK');
      return false;
    }

    const processed = await processBlock(client, Number(nextBlock));
    if (!processed) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  await ensureBridgeHistoryTables();
  process.stdout.write('bridge-history-sync started\n');

  while (true) {
    try {
      const processed = await processNextBlock();
      if (!processed) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      process.stderr.write(`bridge-history-sync error: ${message}\n`);
      await sleep(pollIntervalMs);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`bridge-history-sync fatal: ${message}\n`);
  process.exit(1);
});
