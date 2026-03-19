import * as fs from 'fs';
import { Pool, PoolClient } from 'pg';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as Lucid from '@lucid-evolution/lucid';
import { REDEEMER_TYPE } from '../constant';
import { LoadedBridgeConfig, loadBridgeConfigFromEnv } from '../config/bridge-manifest';
import { decodeHostStateDatum } from '../shared/types/host-state-datum';

type YaciTxRow = {
  tx_hash: string;
  fee: string | number | null;
  block: string | number;
  block_hash: string;
  tx_index: number;
  slot: string | number;
};

type YaciTxCborRow = {
  tx_hash: string;
  cbor_hex: string;
  cbor_size: number | null;
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
  id: number | string;
};

type ParsedTxRedeemer = {
  type: string;
  data: string;
  index: number;
};

type BridgeUtxoInsertRow = {
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
};

type HostStateToken = {
  policyId: string;
  name: string;
};

type BridgeProjectionFilter = {
  hostStateToken: HostStateToken;
  relevantAddresses: string[];
  relevantPolicies: string[];
};

type SyncStateRow = {
  last_block: string | number;
  last_block_hash: string | null;
};

type BlockRow = {
  number: string | number;
  hash: string;
  prev_hash: string | null;
};

const pollIntervalMs = Number(process.env.BRIDGE_HISTORY_SYNC_INTERVAL_MS || 2000);
const historyPool = new Pool({
  host: process.env.HISTORY_DB_HOST || 'yaci-postgres',
  port: Number(process.env.HISTORY_DB_PORT || 5432),
  database: process.env.HISTORY_DB_NAME || 'yaci_store',
  user: process.env.HISTORY_DB_USERNAME || 'yaci',
  password: process.env.HISTORY_DB_PASSWORD || 'dbpass',
});

let cachedBridgeProjectionFilter: BridgeProjectionFilter | null = null;
let loggedMissingBridgeConfig = false;
const bridgeConfigFileReader = {
  readFileSync(path: string, _encoding: string) {
    return fs.readFileSync(path, 'utf8');
  },
};

async function ensureBridgeHistoryTables() {
  await historyPool.query(`
    CREATE TABLE IF NOT EXISTS bridge_history_sync_state (
      cursor_name text PRIMARY KEY,
      last_block bigint NOT NULL DEFAULT -1,
      last_block_hash varchar(64),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE bridge_history_sync_state
      ADD COLUMN IF NOT EXISTS last_block_hash varchar(64);

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

    CREATE TABLE IF NOT EXISTS bridge_tx_evidence (
      tx_hash varchar(64) PRIMARY KEY,
      block_no bigint NOT NULL,
      block_hash varchar(64),
      slot_no bigint,
      tx_index integer NOT NULL DEFAULT 0,
      tx_cbor bytea NOT NULL,
      tx_body_cbor bytea NOT NULL,
      redeemers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      host_state_output_index integer,
      host_state_datum text,
      host_state_datum_hash varchar(64),
      host_state_root varchar(64),
      gas_fee bigint NOT NULL DEFAULT 0,
      tx_size integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_tx_evidence_block_no
      ON bridge_tx_evidence(block_no, tx_index);

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

    INSERT INTO bridge_history_sync_state(cursor_name, last_block, last_block_hash)
    VALUES ('default', -1, NULL)
    ON CONFLICT (cursor_name) DO NOTHING;
  `);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBigInt(value: string | number | null | undefined): bigint {
  return BigInt(value ?? 0);
}

function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeHex(value)).filter((value): value is string => !!value))).sort();
}

function redeemerTagToType(CML: any, tag: number): string {
  switch (tag) {
    case CML.RedeemerTag.Mint:
      return REDEEMER_TYPE.MINT;
    case CML.RedeemerTag.Spend:
      return REDEEMER_TYPE.SPEND;
    default:
      return `tag_${tag}`;
  }
}

function decodeTransactionEvidence(txCborHex: string): { txBodyCborHex: string; redeemers: ParsedTxRedeemer[] } {
  const normalizedTxCborHex = txCborHex.toLowerCase();
  const transaction = CML.Transaction.from_cbor_hex(normalizedTxCborHex);
  const txBodyCborHex = transaction.body().to_cbor_hex().toLowerCase();
  const redeemers = transaction.witness_set().redeemers();
  if (!redeemers) {
    return { txBodyCborHex, redeemers: [] };
  }

  const parsedRedeemers: ParsedTxRedeemer[] = [];
  const redeemerMap = redeemers.as_map_redeemer_key_to_redeemer_val();
  const keys = redeemerMap?.keys();
  if (redeemerMap && keys) {
    for (let index = 0; index < keys.len(); index += 1) {
      const key = keys.get(index);
      const value = redeemerMap.get(key);
      if (!value) continue;
      parsedRedeemers.push({
        type: redeemerTagToType(CML, key.tag()),
        index: Number(key.index()),
        data: value.data().to_cbor_hex().toLowerCase(),
      });
    }

    return { txBodyCborHex, redeemers: parsedRedeemers };
  }

  const legacyRedeemers = redeemers.as_arr_legacy_redeemer();
  if (!legacyRedeemers) {
    return { txBodyCborHex, redeemers: [] };
  }

  for (let index = 0; index < legacyRedeemers.len(); index += 1) {
    const redeemer = legacyRedeemers.get(index);
    parsedRedeemers.push({
      type: redeemerTagToType(CML, redeemer.tag()),
      index: Number(redeemer.index()),
      data: redeemer.data().to_cbor_hex().toLowerCase(),
    });
  }

  return { txBodyCborHex, redeemers: parsedRedeemers };
}

function buildBridgeUtxoRows(
  utxoRows: YaciAddressUtxoRow[],
  txIdsByHash: Map<string, number>,
  txIndexesByHash: Map<string, number>,
  blockNo: number,
  relevantPolicies: ReadonlySet<string>,
) {
  const rows: BridgeUtxoInsertRow[] = [];

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
      if (!relevantPolicies.has(policyId)) {
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
        datum: normalizeHex(utxoRow.inline_datum),
        datumHash: normalizeHex(utxoRow.data_hash),
        assetsPolicy: policyId,
        assetsName: assetName,
        blockNo,
        blockId: blockNo,
        txIndex: txIndexesByHash.get(txHash) ?? 0,
        referenceScriptHash: normalizeHex(utxoRow.reference_script_hash),
      });
    }
  }

  return rows;
}

function deriveBridgeProjectionFilter(bridgeConfig: LoadedBridgeConfig): BridgeProjectionFilter {
  const deployment = bridgeConfig.deployment;
  const validatorAddresses = Object.values(deployment.validators)
    .flatMap((validator) => ('address' in validator ? [validator.address] : []))
    .filter((address) => typeof address === 'string' && address.trim().length > 0);
  const moduleAddresses = Object.values(deployment.modules)
    .map((module) => module?.address)
    .filter((address): address is string => typeof address === 'string' && address.trim().length > 0);

  const relevantPolicies = uniqueSorted([
    deployment.hostStateNFT.policyId,
    deployment.handlerAuthToken.policyId,
    deployment.validators.mintClientStt.scriptHash,
    deployment.validators.mintConnectionStt.scriptHash,
    deployment.validators.mintChannelStt.scriptHash,
    deployment.validators.mintVoucher.scriptHash,
  ]);

  return {
    hostStateToken: {
      policyId: deployment.hostStateNFT.policyId.toLowerCase(),
      name: deployment.hostStateNFT.name.toLowerCase(),
    },
    relevantAddresses: uniqueSorted([...validatorAddresses, ...moduleAddresses]),
    relevantPolicies,
  };
}

function tryResolveBridgeProjectionFilter(): BridgeProjectionFilter | null {
  if (cachedBridgeProjectionFilter) {
    return cachedBridgeProjectionFilter;
  }

  try {
    const bridgeConfig = loadBridgeConfigFromEnv(
      process.env as Record<string, string | undefined>,
      bridgeConfigFileReader,
    );
    cachedBridgeProjectionFilter = deriveBridgeProjectionFilter(bridgeConfig);
    if (loggedMissingBridgeConfig) {
      process.stdout.write('bridge-history-sync detected bridge deployment config and is resuming indexing\n');
      loggedMissingBridgeConfig = false;
    }
    return cachedBridgeProjectionFilter;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('ENOENT') ||
      message.includes('no such file or directory') ||
      message.includes('Unexpected end of JSON input')
    ) {
      if (!loggedMissingBridgeConfig) {
        process.stdout.write(
          'bridge-history-sync waiting for bridge deployment config before indexing historical evidence\n',
        );
        loggedMissingBridgeConfig = true;
      }
      return null;
    }
    throw error;
  }
}

async function getRelevantUtxoRowsForBlock(
  client: PoolClient,
  blockNo: number,
  filter: BridgeProjectionFilter,
): Promise<YaciAddressUtxoRow[]> {
  const result = await client.query<YaciAddressUtxoRow>(
    `
      SELECT tx_hash, output_index, owner_addr, owner_addr_full, data_hash, inline_datum, reference_script_hash, amounts
      FROM address_utxo
      WHERE block = $1
        AND (
          owner_addr = ANY($2::text[])
          OR owner_addr_full = ANY($2::text[])
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(amounts::jsonb, '[]'::jsonb)) AS amount
            WHERE lower(COALESCE(amount->>'policy_id', '')) = ANY($3::text[])
          )
        )
      ORDER BY tx_hash ASC, output_index ASC
    `,
    [blockNo, filter.relevantAddresses, filter.relevantPolicies],
  );
  return result.rows;
}

async function deriveHostStateEvidence(
  hostStateToken: HostStateToken,
  txHash: string,
  utxoRows: BridgeUtxoInsertRow[],
): Promise<{
  hostStateOutputIndex: number | null;
  hostStateDatum: string | null;
  hostStateDatumHash: string | null;
  hostStateRoot: string | null;
}> {
  const hostStateRow = utxoRows.find(
    (row) =>
      row.txHash === txHash &&
      row.assetsPolicy === hostStateToken.policyId &&
      row.assetsName === hostStateToken.name,
  );

  if (!hostStateRow) {
    return {
      hostStateOutputIndex: null,
      hostStateDatum: null,
      hostStateDatumHash: null,
      hostStateRoot: null,
    };
  }

  if (!hostStateRow.datum) {
    throw new Error(`HostState output in tx ${txHash} is missing inline datum`);
  }

  const hostStateDatum = await decodeHostStateDatum(hostStateRow.datum, Lucid);
  return {
    hostStateOutputIndex: hostStateRow.outputIndex,
    hostStateDatum: hostStateRow.datum,
    hostStateDatumHash: hostStateRow.datumHash,
    hostStateRoot: hostStateDatum.state.ibc_state_root.toLowerCase(),
  };
}

async function upsertBridgeTx(client: PoolClient, row: YaciTxRow, txSize: number): Promise<number> {
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
      txSize,
      Number(row.block),
      normalizeHex(row.block_hash),
      Number(row.slot),
      Number(row.tx_index ?? 0),
    ],
  );

  return Number(result.rows[0].id);
}

async function upsertBridgeTxEvidence(
  client: PoolClient,
  row: {
    txHash: string;
    blockNo: number;
    blockHash: string | null;
    slotNo: number;
    txIndex: number;
    txCborHex: string;
    txBodyCborHex: string;
    redeemers: ParsedTxRedeemer[];
    hostStateOutputIndex: number | null;
    hostStateDatum: string | null;
    hostStateDatumHash: string | null;
    hostStateRoot: string | null;
    gasFee: number;
    txSize: number;
  },
) {
  await client.query(
    `
      INSERT INTO bridge_tx_evidence(
        tx_hash,
        block_no,
        block_hash,
        slot_no,
        tx_index,
        tx_cbor,
        tx_body_cbor,
        redeemers_json,
        host_state_output_index,
        host_state_datum,
        host_state_datum_hash,
        host_state_root,
        gas_fee,
        tx_size,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        decode($6, 'hex'),
        decode($7, 'hex'),
        $8::jsonb,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        now()
      )
      ON CONFLICT (tx_hash) DO UPDATE SET
        block_no = EXCLUDED.block_no,
        block_hash = EXCLUDED.block_hash,
        slot_no = EXCLUDED.slot_no,
        tx_index = EXCLUDED.tx_index,
        tx_cbor = EXCLUDED.tx_cbor,
        tx_body_cbor = EXCLUDED.tx_body_cbor,
        redeemers_json = EXCLUDED.redeemers_json,
        host_state_output_index = EXCLUDED.host_state_output_index,
        host_state_datum = EXCLUDED.host_state_datum,
        host_state_datum_hash = EXCLUDED.host_state_datum_hash,
        host_state_root = EXCLUDED.host_state_root,
        gas_fee = EXCLUDED.gas_fee,
        tx_size = EXCLUDED.tx_size,
        updated_at = now()
    `,
    [
      row.txHash,
      row.blockNo,
      row.blockHash,
      row.slotNo,
      row.txIndex,
      row.txCborHex,
      row.txBodyCborHex,
      JSON.stringify(row.redeemers),
      row.hostStateOutputIndex,
      row.hostStateDatum,
      row.hostStateDatumHash,
      row.hostStateRoot,
      row.gasFee,
      row.txSize,
    ],
  );
}

async function getSyncState(client: PoolClient): Promise<{ lastBlock: number; lastBlockHash: string | null }> {
  const result = await client.query<SyncStateRow>(
    `
      SELECT last_block, last_block_hash
      FROM bridge_history_sync_state
      WHERE cursor_name = 'default'
      LIMIT 1
    `,
  );
  if (result.rows.length === 0) {
    return { lastBlock: -1, lastBlockHash: null };
  }
  return {
    lastBlock: Number(result.rows[0].last_block),
    lastBlockHash: normalizeHex(result.rows[0].last_block_hash),
  };
}

async function updateSyncState(client: PoolClient, lastBlock: number, lastBlockHash: string | null) {
  await client.query(
    `
      UPDATE bridge_history_sync_state
      SET last_block = $1, last_block_hash = $2, updated_at = now()
      WHERE cursor_name = 'default'
    `,
    [lastBlock, lastBlockHash],
  );
}

async function getCanonicalBlock(client: PoolClient, blockNo: number): Promise<BlockRow | null> {
  const result = await client.query<BlockRow>(
    `
      SELECT number, hash, prev_hash
      FROM block
      WHERE number = $1
      LIMIT 1
    `,
    [blockNo],
  );
  return result.rows[0] ?? null;
}

async function getProjectedBlockHash(client: PoolClient, blockNo: number): Promise<string | null> {
  const result = await client.query<{ block_hash: string | null }>(
    `
      SELECT block_hash
      FROM bridge_tx_history
      WHERE block_no = $1
        AND block_hash IS NOT NULL
      ORDER BY tx_index DESC
      LIMIT 1
    `,
    [blockNo],
  );
  return normalizeHex(result.rows[0]?.block_hash ?? null);
}

async function deleteProjectionRowsAtOrAboveBlock(client: PoolClient, blockNo: number) {
  await client.query(`DELETE FROM bridge_tx_evidence WHERE block_no >= $1`, [blockNo]);
  await client.query(`DELETE FROM bridge_tx_history WHERE block_no >= $1`, [blockNo]);
  await client.query(`DELETE FROM bridge_utxo_history WHERE block_no >= $1`, [blockNo]);
  await client.query(`DELETE FROM bridge_spo_event_history WHERE block_no >= $1`, [blockNo]);
}

async function reconcileCursor(client: PoolClient) {
  let { lastBlock, lastBlockHash } = await getSyncState(client);

  while (lastBlock >= 0) {
    const canonicalBlock = await getCanonicalBlock(client, lastBlock);
    if (!canonicalBlock) {
      await deleteProjectionRowsAtOrAboveBlock(client, lastBlock);
      lastBlock -= 1;
      lastBlockHash = lastBlock >= 0 ? await getProjectedBlockHash(client, lastBlock) : null;
      continue;
    }

    const canonicalHash = canonicalBlock.hash.toLowerCase();
    if (!lastBlockHash) {
      lastBlockHash = (await getProjectedBlockHash(client, lastBlock)) ?? canonicalHash;
      if (lastBlockHash === canonicalHash) {
        break;
      }
    }

    if (canonicalHash === lastBlockHash) {
      break;
    }

    process.stdout.write(
      `bridge-history-sync detected rollback/divergence at block ${lastBlock}; rewinding projection state\n`,
    );
    await deleteProjectionRowsAtOrAboveBlock(client, lastBlock);
    lastBlock -= 1;
    lastBlockHash = lastBlock >= 0 ? await getProjectedBlockHash(client, lastBlock) : null;
  }

  await updateSyncState(client, lastBlock, lastBlockHash);
  return { lastBlock, lastBlockHash };
}

async function processBlock(client: PoolClient, hostStateToken: HostStateToken, blockNo: number): Promise<boolean> {
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

  const projectionFilter = tryResolveBridgeProjectionFilter();
  if (!projectionFilter) {
    return false;
  }

  const relevantUtxoRows = await getRelevantUtxoRowsForBlock(client, blockNo, projectionFilter);
  const relevantTxHashes = Array.from(new Set(relevantUtxoRows.map((row) => row.tx_hash.toLowerCase())));

  if (relevantTxHashes.length > 0) {
    const txResult = await client.query<YaciTxRow>(
      `
        SELECT tx_hash, fee, block, block_hash, tx_index, slot
        FROM transaction
        WHERE block = $1
          AND tx_hash = ANY($2::varchar[])
        ORDER BY tx_index ASC, tx_hash ASC
      `,
      [blockNo, relevantTxHashes],
    );

    const txCborResult = await client.query<YaciTxCborRow>(
      `
        SELECT tx_hash, encode(cbor_data, 'hex') AS cbor_hex, cbor_size
        FROM transaction_cbor
        WHERE tx_hash = ANY($1::varchar[])
      `,
      [relevantTxHashes],
    );
    const txCborByHash = new Map<string, YaciTxCborRow>(
      txCborResult.rows.map((row) => [row.tx_hash.toLowerCase(), row]),
    );

    const txIdsByHash = new Map<string, number>();
    const txIndexesByHash = new Map<string, number>();

    for (const txRow of txResult.rows) {
      const txHash = txRow.tx_hash.toLowerCase();
      const txCborRow = txCborByHash.get(txHash);
      if (!txCborRow?.cbor_hex) {
        throw new Error(`Missing transaction_cbor row for tx ${txHash} at block ${blockNo}`);
      }

      const txSize = Number(txCborRow.cbor_size ?? Math.floor(txCborRow.cbor_hex.length / 2));
      const txId = await upsertBridgeTx(client, txRow, txSize);
      txIdsByHash.set(txHash, txId);
      txIndexesByHash.set(txHash, Number(txRow.tx_index ?? 0));
    }

    const outputRows = buildBridgeUtxoRows(
      relevantUtxoRows,
      txIdsByHash,
      txIndexesByHash,
      blockNo,
      new Set(projectionFilter.relevantPolicies),
    );
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

    for (const txRow of txResult.rows) {
      const txHash = txRow.tx_hash.toLowerCase();
      const txCborRow = txCborByHash.get(txHash);
      if (!txCborRow?.cbor_hex) {
        throw new Error(`Missing transaction_cbor row for tx ${txHash} at block ${blockNo}`);
      }

      const txCborHex = txCborRow.cbor_hex.toLowerCase();
      const { txBodyCborHex, redeemers } = decodeTransactionEvidence(txCborHex);
      const hostStateEvidence = await deriveHostStateEvidence(hostStateToken, txHash, outputRows);

      await upsertBridgeTxEvidence(client, {
        txHash,
        blockNo,
        blockHash: normalizeHex(txRow.block_hash),
        slotNo: Number(txRow.slot),
        txIndex: Number(txRow.tx_index ?? 0),
        txCborHex,
        txBodyCborHex,
        redeemers,
        hostStateOutputIndex: hostStateEvidence.hostStateOutputIndex,
        hostStateDatum: hostStateEvidence.hostStateDatum,
        hostStateDatumHash: hostStateEvidence.hostStateDatumHash,
        hostStateRoot: hostStateEvidence.hostStateRoot,
        gasFee: Number(txRow.fee ?? 0),
        txSize: Number(txCborRow.cbor_size ?? Math.floor(txCborHex.length / 2)),
      });
    }
  }

  const canonicalBlock = await getCanonicalBlock(client, blockNo);
  await updateSyncState(client, blockNo, normalizeHex(canonicalBlock?.hash) ?? null);
  process.stdout.write(`bridge-history-sync indexed block ${blockNo}\n`);
  return true;
}

async function processNextBlock(): Promise<boolean> {
  const projectionFilter = tryResolveBridgeProjectionFilter();
  if (!projectionFilter) {
    return false;
  }

  const client = await historyPool.connect();
  try {
    await client.query('BEGIN');
    const syncState = await reconcileCursor(client);

    const nextBlockResult = await client.query<{ block_no: string | null }>(
      `
        SELECT MIN(candidate_block)::text AS block_no
        FROM (
          SELECT MIN(block)::bigint AS candidate_block
          FROM address_utxo
          WHERE block > $1
            AND (
              owner_addr = ANY($2::text[])
              OR owner_addr_full = ANY($2::text[])
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(amounts::jsonb, '[]'::jsonb)) AS amount
                WHERE lower(COALESCE(amount->>'policy_id', '')) = ANY($3::text[])
              )
            )
          UNION ALL
          SELECT MIN(block)::bigint AS candidate_block
          FROM pool_registration
          WHERE block > $1
          UNION ALL
          SELECT MIN(block)::bigint AS candidate_block
          FROM pool_retirement
          WHERE block > $1
        ) next_blocks
        WHERE candidate_block IS NOT NULL
      `,
      [syncState.lastBlock, projectionFilter.relevantAddresses, projectionFilter.relevantPolicies],
    );

    const nextBlock = nextBlockResult.rows[0]?.block_no;
    if (!nextBlock) {
      await client.query('ROLLBACK');
      return false;
    }

    const processed = await processBlock(client, projectionFilter.hostStateToken, Number(nextBlock));
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
