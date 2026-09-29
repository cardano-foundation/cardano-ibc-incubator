import * as fs from 'fs';
import { Pool, PoolClient } from 'pg';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as Lucid from '@lucid-evolution/lucid';
import { bech32 } from 'bech32';
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
  cert_index: number;
  pool_id?: string | null;
  slot_no?: string | number | null;
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

export type BridgeProjectionFilter = {
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

export async function ensureBridgeHistoryTables(database: Pick<Pool, 'query'> = historyPool) {
  await database.query(`
    SELECT pg_advisory_xact_lock(462, 2);
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
      cert_index integer NOT NULL DEFAULT 0,
      block_no bigint NOT NULL,
      pool_id text,
      slot_no bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (event_type, tx_hash, cert_index)
    );

    ALTER TABLE bridge_spo_event_history
      ADD COLUMN IF NOT EXISTS cert_index integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pool_id text,
      ADD COLUMN IF NOT EXISTS slot_no bigint;

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bridge_spo_event_history'::regclass
        AND contype = 'p' AND array_length(conkey, 1) = 2) THEN
        ALTER TABLE bridge_spo_event_history DROP CONSTRAINT bridge_spo_event_history_pkey;
        ALTER TABLE bridge_spo_event_history ADD PRIMARY KEY (event_type, tx_hash, cert_index);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_bridge_spo_event_history_block_no
      ON bridge_spo_event_history(block_no, event_type);

    CREATE INDEX IF NOT EXISTS idx_bridge_spo_event_history_pool_id
      ON bridge_spo_event_history(pool_id, event_type, slot_no);

    CREATE TABLE IF NOT EXISTS bridge_pool_registration_cache (
      pool_id text PRIMARY KEY,
      first_registration_slot bigint NOT NULL,
      source text NOT NULL,
      source_tx_hash varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_pool_registration_cache_slot
      ON bridge_pool_registration_cache(first_registration_slot);

    CREATE TABLE IF NOT EXISTS bridge_history_block_checkpoints (
      block_no bigint PRIMARY KEY, block_hash varchar(64) NOT NULL
    );

    DO $$ BEGIN
      PERFORM pg_advisory_xact_lock(462, 2);
      IF NOT EXISTS (SELECT 1 FROM bridge_history_sync_state WHERE cursor_name = 'complete-block-v2') THEN
        DELETE FROM bridge_tx_evidence;
        DELETE FROM bridge_tx_history;
        DELETE FROM bridge_utxo_history;
        DELETE FROM bridge_spo_event_history;
        DELETE FROM bridge_history_block_checkpoints;
        DELETE FROM bridge_pool_registration_cache WHERE source IN ('yaci_projection', 'yaci');
        INSERT INTO bridge_history_sync_state(cursor_name, last_block, last_block_hash)
        VALUES ('complete-block-v2', -1, NULL);
      END IF;
    END $$;
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
  return Array.from(
    new Set(values.map((value) => normalizeHex(value)).filter((value): value is string => !!value)),
  ).sort();
}

function normalizePoolId(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() || '';
  if (!trimmed) return null;
  if (trimmed.startsWith('pool1')) return trimmed;
  if (/^[0-9a-f]{56}$/.test(trimmed)) {
    return bech32.encode('pool', bech32.toWords(Buffer.from(trimmed, 'hex')));
  }
  return trimmed;
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
  try {
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
  } catch {
    // Newer Yaci modes can expose transaction-body CBOR directly in transaction_cbor.
    // Accept that shape so bridge history indexing can still progress; redeemers are unavailable.
    const txBody = CML.TransactionBody.from_cbor_hex(normalizedTxCborHex);
    return {
      txBodyCborHex: txBody.to_cbor_hex().toLowerCase(),
      redeemers: [],
    };
  }
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
    deployment.validators.mintClientStt.scriptHash,
    deployment.validators.mintConnectionStt.scriptHash,
    deployment.validators.mintChannelStt.scriptHash,
    deployment.validators.mintVoucher.scriptHash,
    ...(deployment.validators.mintTendermintUpdateSession
      ? [deployment.validators.mintTendermintUpdateSession.scriptHash]
      : []),
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

// A cancellation burns the session NFT and pays only the owner's wallet. Its
// consumed output still identifies it as bridge work even with no watched output.
async function getRelevantSpentTxHashesForBlock(
  client: PoolClient,
  blockNo: number,
  filter: BridgeProjectionFilter,
): Promise<string[]> {
  const result = await client.query<{ tx_hash: string }>(
    `
      SELECT DISTINCT spent.spent_tx_hash AS tx_hash
      ${relevantSpentOutputsSql}
      WHERE spent.spent_at_block = $1 AND tx.invalid = false
        AND ${relevantOutputSql('utxo')}
    `,
    [blockNo, filter.relevantAddresses, filter.relevantPolicies],
  );
  return result.rows.map((row) => row.tx_hash.toLowerCase());
}

function relevantOutputSql(alias: string): string {
  return `(
    ${alias}.owner_addr = ANY($2::text[])
    OR ${alias}.owner_addr_full = ANY($2::text[])
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(${alias}.amounts::jsonb, '[]'::jsonb)) AS amount
      WHERE lower(COALESCE(amount->>'policy_id', '')) = ANY($3::text[])
    )
  )`;
}

const relevantSpentOutputsSql = `
  FROM tx_input spent
  JOIN address_utxo utxo ON utxo.tx_hash = spent.tx_hash AND utxo.output_index = spent.output_index
  JOIN transaction tx ON tx.tx_hash = spent.spent_tx_hash
    AND tx.block = spent.spent_at_block AND tx.block_hash = spent.spent_at_block_hash
  JOIN block canonical ON canonical.number = tx.block AND canonical.hash = tx.block_hash
`;

export async function getNextRelevantBlock(
  client: PoolClient,
  lastBlock: number,
): Promise<number | null> {
  const result = await client.query<{ block_no: string | null }>(
    `
      SELECT MIN(number)::text AS block_no FROM block
      WHERE number > $1 AND (no_of_txs > 0 OR no_of_txs IS NULL)
    `,
    [lastBlock],
  );
  const blockNo = result.rows[0]?.block_no;
  return blockNo === null || blockNo === undefined ? null : Number(blockNo);
}

/** Yaci publishes its component tables asynchronously. A header/output can
 * precede the transaction row. Never advance past an incompletely indexed
 * block, including one whose watched outputs have not appeared yet. These are
 * discovery checks; proof serving still authenticates canonical raw evidence.
 */
export async function isBlockProjectionComplete(client: PoolClient, blockNo: number): Promise<boolean> {
  const header = (await client.query<{ hash: string; no_of_txs: number }>(
    'SELECT hash, no_of_txs FROM block WHERE number = $1', [blockNo],
  )).rows[0];
  if (!header || header.no_of_txs === null || !Number.isSafeInteger(Number(header.no_of_txs)) || Number(header.no_of_txs) < 0) return false;
  const transactions = (await client.query<{ tx_hash: string; invalid: boolean | null; cbor_hex: string | null }>(`
    SELECT tx.tx_hash, tx.invalid, encode(c.cbor_data, 'hex') AS cbor_hex
    FROM transaction tx LEFT JOIN transaction_cbor c ON c.tx_hash = tx.tx_hash
    WHERE tx.block = $1 AND tx.block_hash = $2
  `, [blockNo, header.hash])).rows;
  if (transactions.length !== Number(header.no_of_txs)) return false;
  const outputs = new Set((await client.query<{ tx_hash: string; output_index: number }>(
    'SELECT tx_hash, output_index FROM address_utxo WHERE block = $1', [blockNo],
  )).rows.map((row) => `${row.tx_hash}:${row.output_index}`));
  const inputs = new Set((await client.query<{ tx_hash: string; output_index: number; spent_tx_hash: string }>(`
    SELECT tx_hash, output_index, spent_tx_hash FROM tx_input
    WHERE spent_at_block = $1 AND spent_at_block_hash = $2
  `, [blockNo, header.hash])).rows.map((row) => `${row.spent_tx_hash}:${row.tx_hash}:${row.output_index}`));
  for (const transaction of transactions) {
    if (typeof transaction.invalid !== 'boolean' || !transaction.cbor_hex) return false;
    if (transaction.invalid) continue; // Invalid scripts do not spend normal state inputs.
    const { txBodyCborHex } = decodeTransactionEvidence(transaction.cbor_hex);
    const body = CML.TransactionBody.from_cbor_hex(txBodyCborHex);
    if (CML.hash_transaction(body).to_hex() !== transaction.tx_hash) {
      throw new Error(`Yaci transaction CBOR/hash mismatch at block ${blockNo}`);
    }
    for (let i = 0; i < body.outputs().len(); i++) {
      if (!outputs.has(`${transaction.tx_hash}:${i}`)) return false;
    }
    for (let i = 0; i < body.inputs().len(); i++) {
      const input = body.inputs().get(i);
      if (!inputs.has(`${transaction.tx_hash}:${input.transaction_id().to_hex()}:${input.index()}`)) return false;
    }
  }
  return true;
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
      row.txHash === txHash && row.assetsPolicy === hostStateToken.policyId && row.assetsName === hostStateToken.name,
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
      WHERE cursor_name = 'complete-block-v2'
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
      WHERE cursor_name = 'complete-block-v2'
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
      FROM bridge_history_block_checkpoints
      WHERE block_no = $1
        AND block_hash IS NOT NULL
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
  await client.query(`DELETE FROM bridge_history_block_checkpoints WHERE block_no >= $1`, [blockNo]);
  await client.query(`DELETE FROM bridge_pool_registration_cache WHERE source IN ('yaci_projection', 'yaci')`);
  await client.query(`
    INSERT INTO bridge_pool_registration_cache(pool_id, first_registration_slot, source)
    SELECT pool_id, MIN(slot_no), 'yaci_projection' FROM bridge_spo_event_history
    WHERE event_type = 'register' AND pool_id IS NOT NULL AND slot_no IS NOT NULL
    GROUP BY pool_id ON CONFLICT (pool_id) DO NOTHING
  `);
}

export async function reconcileCursor(client: PoolClient) {
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
      lastBlockHash = await getProjectedBlockHash(client, lastBlock);
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

export async function processBlock(
  client: PoolClient,
  projectionFilter: BridgeProjectionFilter,
  blockNo: number,
): Promise<boolean> {
  if (!await isBlockProjectionComplete(client, blockNo)) return false;
  // Certificate tables are asynchronous too. Derive these events from the
  // already hash-checked bodies so a late certificate cannot be skipped.
  const certificateTransactions = (await client.query<{ tx_hash: string; slot: string; cbor_hex: string }>(`
    SELECT tx.tx_hash, tx.slot, encode(c.cbor_data, 'hex') AS cbor_hex
    FROM transaction tx JOIN transaction_cbor c ON c.tx_hash = tx.tx_hash
    JOIN block canonical ON canonical.number = tx.block AND canonical.hash = tx.block_hash
    WHERE tx.block = $1 AND tx.invalid = false ORDER BY tx.tx_index
  `, [blockNo])).rows;
  const poolRegistrations: SpoEventRow[] = [], poolRetirements: SpoEventRow[] = [];
  for (const transaction of certificateTransactions) {
    const body = CML.TransactionBody.from_cbor_hex(decodeTransactionEvidence(transaction.cbor_hex).txBodyCborHex);
    const certificates = body.certs();
    for (let i = 0; certificates && i < certificates.len(); i++) {
      const certificate = certificates.get(i);
      const registration = certificate.as_pool_registration();
      const retirement = certificate.as_pool_retirement();
      const common = { tx_hash: transaction.tx_hash, cert_index: i, slot_no: transaction.slot };
      if (registration) poolRegistrations.push({ ...common, pool_id: registration.pool_params().operator().to_hex() });
      if (retirement) poolRetirements.push({ ...common, pool_id: retirement.pool().to_hex() });
    }
  }
  for (const row of poolRegistrations) {
    const poolId = normalizePoolId(row.pool_id);
    await client.query(
      `
        INSERT INTO bridge_spo_event_history(event_type, tx_hash, block_no, pool_id, slot_no, cert_index)
        VALUES ('register', $1, $2, $3, $4, $5)
        ON CONFLICT (event_type, tx_hash, cert_index) DO UPDATE SET
          block_no = EXCLUDED.block_no,
          pool_id = EXCLUDED.pool_id,
          slot_no = EXCLUDED.slot_no
      `,
      [row.tx_hash.toLowerCase(), blockNo, poolId, row.slot_no ?? null, row.cert_index],
    );

    if (poolId && row.slot_no !== null && row.slot_no !== undefined) {
      await client.query(
        `
          INSERT INTO bridge_pool_registration_cache(pool_id, first_registration_slot, source, source_tx_hash)
          VALUES ($1, $2, 'yaci_projection', $3)
          ON CONFLICT (pool_id) DO UPDATE SET
            first_registration_slot = LEAST(
              bridge_pool_registration_cache.first_registration_slot,
              EXCLUDED.first_registration_slot
            ),
            source = EXCLUDED.source,
            source_tx_hash = EXCLUDED.source_tx_hash,
            updated_at = now()
          WHERE bridge_pool_registration_cache.source IN ('yaci_projection', 'yaci')
        `,
        [poolId, row.slot_no, row.tx_hash.toLowerCase()],
      );
    }
  }

  for (const row of poolRetirements) {
    await client.query(
      `
        INSERT INTO bridge_spo_event_history(event_type, tx_hash, block_no, pool_id, slot_no, cert_index)
        VALUES ('unregister', $1, $2, $3, $4, $5)
        ON CONFLICT (event_type, tx_hash, cert_index) DO UPDATE SET
          block_no = EXCLUDED.block_no,
          pool_id = EXCLUDED.pool_id,
          slot_no = EXCLUDED.slot_no
      `,
      [row.tx_hash.toLowerCase(), blockNo, normalizePoolId(row.pool_id), row.slot_no ?? null, row.cert_index],
    );
  }

  const relevantUtxoRows = await getRelevantUtxoRowsForBlock(client, blockNo, projectionFilter);
  const spentTxHashes = await getRelevantSpentTxHashesForBlock(client, blockNo, projectionFilter);
  const relevantTxHashes = Array.from(new Set([
    ...relevantUtxoRows.map((row) => row.tx_hash.toLowerCase()),
    ...spentTxHashes,
  ]));

  if (relevantTxHashes.length > 0) {
    const txResult = await client.query<YaciTxRow>(
      `
        SELECT tx.tx_hash, tx.fee, tx.block, tx.block_hash, tx.tx_index, tx.slot
        FROM transaction tx
        JOIN block canonical ON canonical.number = tx.block AND canonical.hash = tx.block_hash
        WHERE tx.block = $1 AND tx.invalid = false
          AND tx.tx_hash = ANY($2::varchar[])
        ORDER BY tx.tx_index ASC, tx.tx_hash ASC
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
      const txSize = txCborRow?.cbor_hex ? Number(txCborRow.cbor_size ?? Math.floor(txCborRow.cbor_hex.length / 2)) : 0;
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
        process.stdout.write(
          `bridge-history-sync skipping tx evidence for ${txHash} at block ${blockNo}: transaction_cbor row unavailable\n`,
        );
        continue;
      }

      const txCborHex = txCborRow.cbor_hex.toLowerCase();
      const { txBodyCborHex, redeemers } = decodeTransactionEvidence(txCborHex);
      const hostStateEvidence = await deriveHostStateEvidence(projectionFilter.hostStateToken, txHash, outputRows);

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
  if (!canonicalBlock) throw new Error('Canonical block disappeared during projection');
  await client.query(`INSERT INTO bridge_history_block_checkpoints VALUES ($1, $2)
    ON CONFLICT (block_no) DO UPDATE SET block_hash = EXCLUDED.block_hash`, [blockNo, canonicalBlock.hash]);
  await updateSyncState(client, blockNo, normalizeHex(canonicalBlock?.hash) ?? null);
  process.stdout.write(`bridge-history-sync indexed block ${blockNo}\n`);
  return true;
}

export async function processNextBlock(
  database: Pick<Pool, 'connect'> = historyPool,
  projectionFilter = tryResolveBridgeProjectionFilter(),
): Promise<boolean> {
  if (!projectionFilter) {
    return false;
  }

  const client = await database.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SELECT pg_advisory_xact_lock(462, 2)');
    const syncState = await reconcileCursor(client);

    const nextBlock = await getNextRelevantBlock(client, syncState.lastBlock);
    if (nextBlock === null) {
      await client.query('COMMIT');
      return false;
    }

    const processed = await processBlock(client, projectionFilter, nextBlock);
    if (!processed) {
      await client.query('COMMIT');
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

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`bridge-history-sync fatal: ${message}\n`);
    process.exit(1);
  });
}
