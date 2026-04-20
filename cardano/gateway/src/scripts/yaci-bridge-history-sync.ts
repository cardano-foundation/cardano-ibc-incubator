import * as fs from 'fs';
import { Pool, PoolClient } from 'pg';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as Lucid from '@lucid-evolution/lucid';
import { bech32 } from 'bech32';
import { REDEEMER_TYPE } from '../constant';
import { LoadedBridgeConfig, loadBridgeConfigFromEnv } from '../config/bridge-manifest';
import { queryEpochContextAtPoint } from '../shared/helpers/ogmios';
import { decodeHostStateDatum } from '../shared/types/host-state-datum';

type YaciBlockRow = {
  number: string | number;
  hash: string;
  prev_hash: string | null;
  slot: string | number;
  epoch: string | number;
  block_time: string | number;
  slot_leader: string | null;
};

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

type YaciEpochContext = {
  epoch: number;
  sourceBlockNo: number;
  sourceBlockHash: string;
  verificationContext: {
    epochNonce: string;
    slotsPerKesPeriod: number;
    currentEpochStartSlot: bigint;
    currentEpochEndSlotExclusive: bigint;
  };
  stakeDistribution: Array<{
    poolId: string;
    stake: bigint;
    vrfKeyHash: string;
  }>;
};

type SpoRegistrationRow = {
  tx_hash: string;
  pool_id: string | null;
  vrf_key: string | null;
  relays: unknown;
  metadata_url: string | null;
  metadata_hash: string | null;
  reward_account: string | null;
};

type SpoRetirementRow = {
  tx_hash: string;
  pool_id: string | null;
  retirement_epoch: number | null;
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
  last_slot: string | number | null;
};

const pollIntervalMs = Number(process.env.BRIDGE_HISTORY_SYNC_INTERVAL_MS || 2000);
const configuredEpochLength = Number(process.env.CARDANO_EPOCH_LENGTH || 0);
const ogmiosEndpoint = process.env.OGMIOS_ENDPOINT || '';
const epochNonceGenesis = process.env.CARDANO_EPOCH_NONCE_GENESIS || '';

const yaciPool = new Pool({
  host: process.env.YACI_STORE_DB_HOST || 'yaci-store-postgres',
  port: Number(process.env.YACI_STORE_DB_PORT || 5432),
  database: process.env.YACI_STORE_DB_NAME || 'yaci_store',
  user: process.env.YACI_STORE_DB_USERNAME || 'yaci',
  password: process.env.YACI_STORE_DB_PASSWORD || 'dbpass',
});

const bridgePool = new Pool({
  host: process.env.BRIDGE_HISTORY_DB_HOST || 'bridge-history-postgres',
  port: Number(process.env.BRIDGE_HISTORY_DB_PORT || 5432),
  database: process.env.BRIDGE_HISTORY_DB_NAME || 'bridge_history',
  user: process.env.BRIDGE_HISTORY_DB_USERNAME || 'bridge',
  password: process.env.BRIDGE_HISTORY_DB_PASSWORD || 'dbpass',
});

let cachedBridgeProjectionFilter: BridgeProjectionFilter | null = null;
let loggedMissingBridgeConfig = false;
const bridgeConfigFileReader = {
  readFileSync(path: string, _encoding: string) {
    return fs.readFileSync(path, 'utf8');
  },
};

async function ensureBridgeHistoryTables() {
  await bridgePool.query(`
    CREATE TABLE IF NOT EXISTS bridge_schema_version (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO bridge_schema_version(version)
    VALUES ('1')
    ON CONFLICT (version) DO NOTHING;

    CREATE TABLE IF NOT EXISTS bridge_sync_cursor (
      cursor_name text PRIMARY KEY,
      last_block bigint NOT NULL DEFAULT -1,
      last_block_hash varchar(64),
      last_slot bigint,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bridge_block_history (
      block_no bigint PRIMARY KEY,
      block_hash varchar(64) NOT NULL UNIQUE,
      prev_hash varchar(64),
      slot_no bigint NOT NULL,
      epoch_no integer NOT NULL,
      block_time timestamptz NOT NULL,
      slot_leader text NOT NULL,
      block_cbor bytea NOT NULL,
      block_cbor_size integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_block_history_epoch
      ON bridge_block_history(epoch_no, block_no);

    CREATE TABLE IF NOT EXISTS bridge_tx_history (
      id bigserial PRIMARY KEY,
      tx_hash varchar(64) NOT NULL UNIQUE,
      gas_fee bigint NOT NULL DEFAULT 0,
      tx_size integer NOT NULL DEFAULT 0,
      block_no bigint NOT NULL REFERENCES bridge_block_history(block_no) ON DELETE CASCADE,
      block_hash varchar(64),
      slot_no bigint,
      tx_index integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_tx_history_block_no
      ON bridge_tx_history(block_no, tx_index);

    CREATE TABLE IF NOT EXISTS bridge_tx_evidence (
      tx_hash varchar(64) PRIMARY KEY REFERENCES bridge_tx_history(tx_hash) ON DELETE CASCADE,
      block_no bigint NOT NULL REFERENCES bridge_block_history(block_no) ON DELETE CASCADE,
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
      tx_hash varchar(64) NOT NULL REFERENCES bridge_tx_history(tx_hash) ON DELETE CASCADE,
      tx_id bigint NOT NULL,
      output_index integer NOT NULL,
      address text NOT NULL,
      datum text,
      datum_hash varchar(64),
      assets_policy varchar(56) NOT NULL,
      assets_name text NOT NULL,
      block_no bigint NOT NULL REFERENCES bridge_block_history(block_no) ON DELETE CASCADE,
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
      id bigserial PRIMARY KEY,
      event_type text NOT NULL,
      tx_hash varchar(64) NOT NULL,
      block_no bigint NOT NULL REFERENCES bridge_block_history(block_no) ON DELETE CASCADE,
      pool_id text,
      vrf_key_hash varchar(64),
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (event_type, tx_hash, pool_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_spo_event_history_block_no
      ON bridge_spo_event_history(block_no, event_type);

    CREATE TABLE IF NOT EXISTS bridge_epoch_context (
      epoch_no bigint PRIMARY KEY,
      current_epoch_start_slot bigint NOT NULL,
      current_epoch_end_slot_exclusive bigint NOT NULL,
      epoch_nonce varchar(64) NOT NULL,
      slots_per_kes_period bigint NOT NULL,
      stake_distribution_json jsonb NOT NULL,
      source_block_no bigint NOT NULL,
      source_block_hash varchar(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO bridge_sync_cursor(cursor_name, last_block, last_block_hash, last_slot)
    VALUES ('default', -1, NULL, NULL)
    ON CONFLICT (cursor_name) DO NOTHING;

    INSERT INTO bridge_sync_cursor(cursor_name, last_block, last_block_hash, last_slot)
    VALUES ('bridge_projection', -1, NULL, NULL)
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
  if (!normalized) {
    return null;
  }
  return normalized.startsWith('0x') ? normalized.slice(2) : normalized;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeHex(value)).filter((value): value is string => !!value))).sort();
}

function redeemerTagToType(CMLLib: typeof CML, tag: number): string {
  switch (tag) {
    case CMLLib.RedeemerTag.Mint:
      return REDEEMER_TYPE.MINT;
    case CMLLib.RedeemerTag.Spend:
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
          'bridge-history-sync waiting for bridge deployment config before indexing bridge history\n',
        );
        loggedMissingBridgeConfig = true;
      }
      return null;
    }
    throw error;
  }
}

async function getRelevantUtxoRowsForBlock(
  yaciClient: PoolClient,
  blockNo: number,
  filter: BridgeProjectionFilter,
): Promise<YaciAddressUtxoRow[]> {
  const result = await yaciClient.query<YaciAddressUtxoRow>(
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

async function upsertBridgeBlock(
  bridgeClient: PoolClient,
  block: YaciBlockRow,
  blockCbor: Buffer,
): Promise<void> {
  await bridgeClient.query(
    `
      INSERT INTO bridge_block_history(
        block_no,
        block_hash,
        prev_hash,
        slot_no,
        epoch_no,
        block_time,
        slot_leader,
        block_cbor,
        block_cbor_size,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        to_timestamp($6),
        $7,
        $8,
        $9,
        now()
      )
      ON CONFLICT (block_no) DO UPDATE SET
        block_hash = EXCLUDED.block_hash,
        prev_hash = EXCLUDED.prev_hash,
        slot_no = EXCLUDED.slot_no,
        epoch_no = EXCLUDED.epoch_no,
        block_time = EXCLUDED.block_time,
        slot_leader = EXCLUDED.slot_leader,
        block_cbor = EXCLUDED.block_cbor,
        block_cbor_size = EXCLUDED.block_cbor_size,
        updated_at = now()
    `,
    [
      Number(block.number),
      block.hash.toLowerCase(),
      normalizeHex(block.prev_hash),
      Number(block.slot),
      Number(block.epoch),
      Number(block.block_time),
      block.slot_leader?.toLowerCase() ?? '',
      blockCbor,
      blockCbor.length,
    ],
  );
}

async function upsertBridgeTx(bridgeClient: PoolClient, row: YaciTxRow, txSize: number): Promise<number> {
  const result = await bridgeClient.query<BridgeTxInsertRow>(
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
  bridgeClient: PoolClient,
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
  await bridgeClient.query(
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

async function upsertBridgeEpochContext(bridgeClient: PoolClient, context: YaciEpochContext): Promise<void> {
  await bridgeClient.query(
    `
      INSERT INTO bridge_epoch_context(
        epoch_no,
        current_epoch_start_slot,
        current_epoch_end_slot_exclusive,
        epoch_nonce,
        slots_per_kes_period,
        stake_distribution_json,
        source_block_no,
        source_block_hash,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
      ON CONFLICT (epoch_no) DO UPDATE SET
        current_epoch_start_slot = EXCLUDED.current_epoch_start_slot,
        current_epoch_end_slot_exclusive = EXCLUDED.current_epoch_end_slot_exclusive,
        epoch_nonce = EXCLUDED.epoch_nonce,
        slots_per_kes_period = EXCLUDED.slots_per_kes_period,
        stake_distribution_json = EXCLUDED.stake_distribution_json,
        source_block_no = EXCLUDED.source_block_no,
        source_block_hash = EXCLUDED.source_block_hash,
        updated_at = now()
    `,
    [
      context.epoch,
      context.verificationContext.currentEpochStartSlot.toString(),
      context.verificationContext.currentEpochEndSlotExclusive.toString(),
      context.verificationContext.epochNonce,
      context.verificationContext.slotsPerKesPeriod,
      JSON.stringify(
        context.stakeDistribution.map((entry) => ({
          poolId: entry.poolId,
          stake: entry.stake.toString(),
          vrfKeyHash: entry.vrfKeyHash,
        })),
      ),
      context.sourceBlockNo,
      context.sourceBlockHash,
    ],
  );

  await bridgeClient.query(
    `
      UPDATE bridge_epoch_context
      SET current_epoch_end_slot_exclusive = $1,
          updated_at = now()
      WHERE epoch_no = $2
        AND current_epoch_end_slot_exclusive <> $1
    `,
    [context.verificationContext.currentEpochStartSlot.toString(), context.epoch - 1],
  );
}

async function getSyncState(
  bridgeClient: PoolClient,
  cursorName = 'default',
): Promise<{ lastBlock: number; lastBlockHash: string | null }> {
  const result = await bridgeClient.query<SyncStateRow>(
    `
      SELECT last_block, last_block_hash, last_slot
      FROM bridge_sync_cursor
      WHERE cursor_name = $1
      LIMIT 1
    `,
    [cursorName],
  );
  if (result.rows.length === 0) {
    return { lastBlock: -1, lastBlockHash: null };
  }
  return {
    lastBlock: Number(result.rows[0].last_block),
    lastBlockHash: normalizeHex(result.rows[0].last_block_hash),
  };
}

async function updateSyncState(
  bridgeClient: PoolClient,
  cursorName: string,
  blockNo: number,
  blockHash: string | null,
  slotNo: number | null,
) {
  await bridgeClient.query(
    `
      UPDATE bridge_sync_cursor
      SET last_block = $1, last_block_hash = $2, last_slot = $3, updated_at = now()
      WHERE cursor_name = $4
    `,
    [blockNo, blockHash, slotNo, cursorName],
  );
}

async function getCanonicalBlock(yaciClient: PoolClient, blockNo: number): Promise<YaciBlockRow | null> {
  const result = await yaciClient.query<YaciBlockRow>(
    `
      SELECT number, hash, prev_hash, slot, epoch, block_time, slot_leader
      FROM block
      WHERE number = $1
      LIMIT 1
    `,
    [blockNo],
  );
  return result.rows[0] ?? null;
}

async function getNextCanonicalBlock(yaciClient: PoolClient, blockNo: number): Promise<YaciBlockRow | null> {
  const result = await yaciClient.query<YaciBlockRow>(
    `
      SELECT number, hash, prev_hash, slot, epoch, block_time, slot_leader
      FROM block
      WHERE number > $1
      ORDER BY number ASC
      LIMIT 1
    `,
    [blockNo],
  );
  return result.rows[0] ?? null;
}

async function getProjectedBlockHash(bridgeClient: PoolClient, blockNo: number): Promise<string | null> {
  const result = await bridgeClient.query<{ block_hash: string | null }>(
    `
      SELECT block_hash
      FROM bridge_block_history
      WHERE block_no = $1
      LIMIT 1
    `,
    [blockNo],
  );
  return normalizeHex(result.rows[0]?.block_hash ?? null);
}

async function deleteProjectionRowsAtOrAboveBlock(bridgeClient: PoolClient, blockNo: number) {
  await bridgeClient.query(`DELETE FROM bridge_tx_evidence WHERE block_no >= $1`, [blockNo]);
  await bridgeClient.query(`DELETE FROM bridge_tx_history WHERE block_no >= $1`, [blockNo]);
  await bridgeClient.query(`DELETE FROM bridge_utxo_history WHERE block_no >= $1`, [blockNo]);
  await bridgeClient.query(`DELETE FROM bridge_spo_event_history WHERE block_no >= $1`, [blockNo]);
  await bridgeClient.query(`DELETE FROM bridge_block_history WHERE block_no >= $1`, [blockNo]);
  await bridgeClient.query(`DELETE FROM bridge_epoch_context WHERE source_block_no >= $1`, [blockNo]);
}

async function reconcileCursor(yaciClient: PoolClient, bridgeClient: PoolClient) {
  let { lastBlock, lastBlockHash } = await getSyncState(bridgeClient, 'default');

  while (lastBlock >= 0) {
    const canonicalBlock = await getCanonicalBlock(yaciClient, lastBlock);
    if (!canonicalBlock) {
      await deleteProjectionRowsAtOrAboveBlock(bridgeClient, lastBlock);
      lastBlock -= 1;
      lastBlockHash = lastBlock >= 0 ? await getProjectedBlockHash(bridgeClient, lastBlock) : null;
      continue;
    }

    const canonicalHash = canonicalBlock.hash.toLowerCase();
    if (!lastBlockHash) {
      lastBlockHash = (await getProjectedBlockHash(bridgeClient, lastBlock)) ?? canonicalHash;
      if (lastBlockHash === canonicalHash) {
        break;
      }
    }

    if (canonicalHash === lastBlockHash) {
      break;
    }

    process.stdout.write(
      `bridge-history-sync detected rollback/divergence at block ${lastBlock}; rewinding bridge history\n`,
    );
    await deleteProjectionRowsAtOrAboveBlock(bridgeClient, lastBlock);
    lastBlock -= 1;
    lastBlockHash = lastBlock >= 0 ? await getProjectedBlockHash(bridgeClient, lastBlock) : null;
  }

  await updateSyncState(bridgeClient, 'default', lastBlock, lastBlockHash, null);
  return { lastBlock, lastBlockHash };
}

async function fetchBlockCbor(yaciClient: PoolClient, blockHash: string): Promise<Buffer> {
  const result = await yaciClient.query<{ cbor_data: Buffer | null }>(
    `
      SELECT cbor_data
      FROM block_cbor
      WHERE block_hash = $1
      LIMIT 1
    `,
    [blockHash.toLowerCase()],
  );
  const blockCbor = result.rows[0]?.cbor_data ?? null;
  if (!blockCbor || blockCbor.length === 0) {
    throw new Error(`Yaci block_cbor missing for block ${blockHash}`);
  }
  return blockCbor;
}

async function findLatestBlockInEpoch(yaciClient: PoolClient, epoch: number): Promise<YaciBlockRow | null> {
  const result = await yaciClient.query<YaciBlockRow>(
    `
      SELECT number, hash, prev_hash, slot, epoch, block_time, slot_leader
      FROM block
      WHERE epoch = $1
      ORDER BY number DESC
      LIMIT 1
    `,
    [epoch],
  );
  return result.rows[0] ?? null;
}

async function findEpochSlotBounds(
  yaciClient: PoolClient,
  epoch: number,
): Promise<{ currentEpochStartSlot: bigint; currentEpochEndSlotExclusive: bigint } | null> {
  const startSlotResult = await yaciClient.query<{ start_slot: string | number | null }>(
    `
      SELECT MIN(slot) AS start_slot
      FROM block
      WHERE epoch = $1
        AND slot >= 0
    `,
    [epoch],
  );
  const currentEpochStartSlot = parseSlot(startSlotResult.rows[0]);
  if (currentEpochStartSlot === null) {
    return null;
  }

  const nextEpochStartSlotResult = await yaciClient.query<{ start_slot: string | number | null }>(
    `
      SELECT MIN(slot) AS start_slot
      FROM block
      WHERE epoch = $1
        AND slot >= 0
    `,
    [epoch + 1],
  );
  const nextEpochStartSlot = parseSlot(nextEpochStartSlotResult.rows[0]);
  const computedEpochEndSlotExclusive =
    nextEpochStartSlot ?? (configuredEpochLength > 0 ? currentEpochStartSlot + BigInt(configuredEpochLength) : null);
  if (computedEpochEndSlotExclusive === null) {
    return null;
  }

  return {
    currentEpochStartSlot,
    currentEpochEndSlotExclusive: computedEpochEndSlotExclusive,
  };
}

function parseSlot(row?: { start_slot: string | number | null } | null): bigint | null {
  const slot = row?.start_slot;
  if (slot === undefined || slot === null) {
    return null;
  }
  const parsed = BigInt(slot);
  return parsed < 0n ? null : parsed;
}

async function loadEpochContextAtBlock(
  yaciClient: PoolClient,
  block: YaciBlockRow,
): Promise<YaciEpochContext> {
  if (!ogmiosEndpoint) {
    throw new Error('OGMIOS_ENDPOINT must be configured for bridge epoch context projection');
  }

  const epoch = Number(block.epoch);
  const slotBounds = await findEpochSlotBounds(yaciClient, epoch);
  if (!slotBounds) {
    throw new Error(`Unable to derive slot bounds for epoch ${epoch}`);
  }

  const queryPoint = async (pointBlock: Pick<YaciBlockRow, 'hash' | 'slot' | 'number'>) =>
    queryEpochContextAtPoint(
      ogmiosEndpoint,
      {
        slot: BigInt(pointBlock.slot),
        hash: pointBlock.hash,
      },
      epochNonceGenesis,
    );

  let sourceBlock = block;
  let epochContext;
  try {
    epochContext = await queryPoint(block);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackBlock = await findLatestBlockInEpoch(yaciClient, epoch);
    const canRetryWithSameEpochPoint =
      fallbackBlock &&
      Number(fallbackBlock.number) !== Number(block.number) &&
      (message.includes('Target point is too old') || message.includes('Failed to acquire requested point'));

    if (!canRetryWithSameEpochPoint) {
      throw error;
    }

    process.stdout.write(
      `bridge-history-sync using later block ${fallbackBlock.number} to capture epoch ${epoch} context after Ogmios rejected block ${block.number}\n`,
    );
    sourceBlock = fallbackBlock;
    epochContext = await queryPoint(fallbackBlock);
  }

  if (epochContext.currentEpoch !== epoch) {
    throw new Error(
      `Ogmios acquired epoch ${epochContext.currentEpoch} at block ${block.number}, expected epoch ${epoch}`,
    );
  }

  return {
    epoch,
    sourceBlockNo: Number(sourceBlock.number),
    sourceBlockHash: sourceBlock.hash.toLowerCase(),
    verificationContext: {
      epochNonce: epochContext.epochNonce,
      slotsPerKesPeriod: epochContext.slotsPerKesPeriod,
      currentEpochStartSlot: slotBounds.currentEpochStartSlot,
      currentEpochEndSlotExclusive: slotBounds.currentEpochEndSlotExclusive,
    },
    stakeDistribution: epochContext.stakeDistribution.map((entry) => ({
      poolId: normalizePoolId(entry.poolId),
      stake: entry.stake,
      vrfKeyHash: normalizeHex(entry.vrfKeyHash) || '',
    })),
  };
}

async function ensureEpochContext(
  yaciClient: PoolClient,
  bridgeClient: PoolClient,
  block: YaciBlockRow,
): Promise<void> {
  const epoch = Number(block.epoch);
  const existing = await bridgeClient.query<{ epoch_no: string }>(
    `
      SELECT epoch_no
      FROM bridge_epoch_context
      WHERE epoch_no = $1
      LIMIT 1
    `,
    [epoch],
  );
  if (existing.rows.length > 0) {
    return;
  }

  const epochContext = await loadEpochContextAtBlock(yaciClient, block);
  await upsertBridgeEpochContext(bridgeClient, epochContext);
}

async function processSpoEvents(yaciClient: PoolClient, bridgeClient: PoolClient, blockNo: number) {
  const poolRegistrations = await yaciClient.query<SpoRegistrationRow>(
    `
      SELECT tx_hash, pool_id, vrf_key, relays, metadata_url, metadata_hash, reward_account
      FROM pool_registration
      WHERE block = $1
      ORDER BY tx_index ASC, cert_index ASC
    `,
    [blockNo],
  );
  for (const row of poolRegistrations.rows) {
    await bridgeClient.query(
      `
        INSERT INTO bridge_spo_event_history(
          event_type,
          tx_hash,
          block_no,
          pool_id,
          vrf_key_hash,
          payload_json,
          updated_at
        )
        VALUES ('register', $1, $2, $3, $4, $5::jsonb, now())
        ON CONFLICT (event_type, tx_hash, pool_id) DO UPDATE SET
          vrf_key_hash = EXCLUDED.vrf_key_hash,
          payload_json = EXCLUDED.payload_json,
          block_no = EXCLUDED.block_no,
          updated_at = now()
      `,
      [
        row.tx_hash.toLowerCase(),
        blockNo,
        normalizePoolId(row.pool_id),
        normalizeHex(row.vrf_key),
        JSON.stringify({
          relays: row.relays ?? [],
          metadata_url: row.metadata_url ?? null,
          metadata_hash: normalizeHex(row.metadata_hash),
          reward_account: row.reward_account ?? null,
        }),
      ],
    );
  }

  const poolRetirements = await yaciClient.query<SpoRetirementRow>(
    `
      SELECT tx_hash, pool_id, retirement_epoch
      FROM pool_retirement
      WHERE block = $1
      ORDER BY tx_index ASC, cert_index ASC
    `,
    [blockNo],
  );
  for (const row of poolRetirements.rows) {
    await bridgeClient.query(
      `
        INSERT INTO bridge_spo_event_history(
          event_type,
          tx_hash,
          block_no,
          pool_id,
          vrf_key_hash,
          payload_json,
          updated_at
        )
        VALUES ('unregister', $1, $2, $3, NULL, $4::jsonb, now())
        ON CONFLICT (event_type, tx_hash, pool_id) DO UPDATE SET
          payload_json = EXCLUDED.payload_json,
          block_no = EXCLUDED.block_no,
          updated_at = now()
      `,
      [
        row.tx_hash.toLowerCase(),
        blockNo,
        normalizePoolId(row.pool_id),
        JSON.stringify({
          retirement_epoch: row.retirement_epoch ?? null,
        }),
      ],
    );
  }
}

async function processBridgeTransactions(
  yaciClient: PoolClient,
  bridgeClient: PoolClient,
  hostStateToken: HostStateToken,
  blockNo: number,
  projectionFilter: BridgeProjectionFilter,
) {
  const relevantUtxoRows = await getRelevantUtxoRowsForBlock(yaciClient, blockNo, projectionFilter);
  const relevantTxHashes = Array.from(new Set(relevantUtxoRows.map((row) => row.tx_hash.toLowerCase())));
  if (relevantTxHashes.length === 0) {
    return;
  }

  const txResult = await yaciClient.query<YaciTxRow>(
    `
      SELECT tx_hash, fee, block, block_hash, tx_index, slot
      FROM transaction
      WHERE block = $1
        AND tx_hash = ANY($2::varchar[])
      ORDER BY tx_index ASC, tx_hash ASC
    `,
    [blockNo, relevantTxHashes],
  );

  const txCborResult = await yaciClient.query<YaciTxCborRow>(
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
    const txSize = txCborRow?.cbor_hex
      ? Number(txCborRow.cbor_size ?? Math.floor(txCborRow.cbor_hex.length / 2))
      : 0;
    const txId = await upsertBridgeTx(bridgeClient, txRow, txSize);
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
    await bridgeClient.query(
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
    const hostStateEvidence = await deriveHostStateEvidence(hostStateToken, txHash, outputRows);

    await upsertBridgeTxEvidence(bridgeClient, {
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

function normalizePoolId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase() || '';
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('pool1')) {
    return trimmed;
  }
  if (/^[0-9a-f]{56}$/.test(trimmed)) {
    return bech32.encode('pool', bech32.toWords(Buffer.from(trimmed, 'hex')));
  }
  return trimmed;
}

async function processBlock(
  yaciClient: PoolClient,
  bridgeClient: PoolClient,
  block: YaciBlockRow,
): Promise<void> {
  const blockNo = Number(block.number);
  await ensureEpochContext(yaciClient, bridgeClient, block);

  const blockCbor = await fetchBlockCbor(yaciClient, block.hash);
  await upsertBridgeBlock(bridgeClient, block, blockCbor);
  await processSpoEvents(yaciClient, bridgeClient, blockNo);

  const projectionFilter = tryResolveBridgeProjectionFilter();
  if (projectionFilter) {
    const projectionCursor = await getSyncState(bridgeClient, 'bridge_projection');
    if (projectionCursor.lastBlock + 1 === blockNo) {
      await processBridgeTransactions(
        yaciClient,
        bridgeClient,
        projectionFilter.hostStateToken,
        blockNo,
        projectionFilter,
      );
      await updateSyncState(
        bridgeClient,
        'bridge_projection',
        blockNo,
        block.hash.toLowerCase(),
        Number(block.slot),
      );
    }
  }

  await updateSyncState(
    bridgeClient,
    'default',
    blockNo,
    block.hash.toLowerCase(),
    Number(block.slot),
  );
  process.stdout.write(`bridge-history-sync indexed bridge block history for block ${blockNo}\n`);
}

async function processNextBlockHistory(): Promise<boolean> {
  const yaciClient = await yaciPool.connect();
  const bridgeClient = await bridgePool.connect();
  try {
    await bridgeClient.query('BEGIN');
    const syncState = await reconcileCursor(yaciClient, bridgeClient);
    const nextBlock = await getNextCanonicalBlock(yaciClient, syncState.lastBlock);
    if (!nextBlock) {
      await bridgeClient.query('ROLLBACK');
      return false;
    }

    await processBlock(yaciClient, bridgeClient, nextBlock);
    await bridgeClient.query('COMMIT');
    return true;
  } catch (error) {
    await bridgeClient.query('ROLLBACK');
    throw error;
  } finally {
    bridgeClient.release();
    yaciClient.release();
  }
}

async function processNextBridgeProjection(): Promise<boolean> {
  const projectionFilter = tryResolveBridgeProjectionFilter();
  if (!projectionFilter) {
    return false;
  }

  const yaciClient = await yaciPool.connect();
  const bridgeClient = await bridgePool.connect();
  try {
    await bridgeClient.query('BEGIN');

    const blockCursor = await reconcileCursor(yaciClient, bridgeClient);
    let projectionCursor = await getSyncState(bridgeClient, 'bridge_projection');
    if (projectionCursor.lastBlock > blockCursor.lastBlock) {
      await updateSyncState(
        bridgeClient,
        'bridge_projection',
        blockCursor.lastBlock,
        blockCursor.lastBlockHash,
        null,
      );
      projectionCursor = blockCursor;
    }

    const nextProjectionBlock = await getNextCanonicalBlock(yaciClient, projectionCursor.lastBlock);
    if (!nextProjectionBlock || Number(nextProjectionBlock.number) > blockCursor.lastBlock) {
      await bridgeClient.query('ROLLBACK');
      return false;
    }

    await processBridgeTransactions(
      yaciClient,
      bridgeClient,
      projectionFilter.hostStateToken,
      Number(nextProjectionBlock.number),
      projectionFilter,
    );
    await updateSyncState(
      bridgeClient,
      'bridge_projection',
      Number(nextProjectionBlock.number),
      nextProjectionBlock.hash.toLowerCase(),
      Number(nextProjectionBlock.slot),
    );
    await bridgeClient.query('COMMIT');
    process.stdout.write(
      `bridge-history-sync projected bridge tx/utxo history for block ${nextProjectionBlock.number}\n`,
    );
    return true;
  } catch (error) {
    await bridgeClient.query('ROLLBACK');
    throw error;
  } finally {
    bridgeClient.release();
    yaciClient.release();
  }
}

async function main() {
  await ensureBridgeHistoryTables();
  process.stdout.write('bridge-history-sync started\n');

  while (true) {
    try {
      const processedBlockHistory = await processNextBlockHistory();
      if (processedBlockHistory) {
        continue;
      }

      const processedBridgeProjection = await processNextBridgeProjection();
      if (!processedBridgeProjection) {
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
