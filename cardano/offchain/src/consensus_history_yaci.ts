import type { UTxO } from "@lucid-evolution/lucid";
import type {
  HistoryDeployment,
  HistorySource,
  HistoryTransaction,
} from "./consensus_history_recovery.ts";

/** An exclusively leased connection, e.g. pg PoolClient, NOT Pool.query. */
export interface YaciHistorySqlClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

const NFT_OUTPUT = `
  (a.owner_addr = $1 OR a.owner_addr_full = $1)
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(a.amounts::jsonb, '[]'::jsonb)) AS amount
    WHERE lower(amount->>'unit') = $2
      AND amount->>'quantity' = '1'
  )`;

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yaci history returned an invalid row");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (
    typeof value !== "number" && typeof value !== "bigint" &&
    !(typeof value === "string" && /^\d+$/.test(value))
  ) throw new Error(`Yaci ${label} must be a nonnegative safe integer`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Yaci ${label} must be a nonnegative safe integer`);
  }
  return result;
}

function hex(value: unknown, label: string, bytes?: number): string {
  if (
    typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(value) ||
    (bytes !== undefined && value.length !== bytes * 2)
  ) throw new Error(`Yaci ${label} is missing or invalid hex`);
  return value.toLowerCase();
}

/**
 * Read canonical historical state transactions directly from Yaci's raw tables.
 * Spent address_utxo rows and full transaction_cbor must be retained. No bridge
 * projection, application snapshot, schema changes or new dependencies are used.
 *
 * Consume the iterator completely before publishing a recovered index: after
 * COMMIT it rechecks the captured block against a fresh database snapshot. The
 * recovery caller must additionally compare independently read live NFT anchors
 * before/after replay. This adapter does not authenticate the database itself.
 * Body-only CBOR is passed through for the recovery decoder to reject explicitly.
 * The caller owns/release()s the idle connection; do not share it or begin an
 * outer transaction during iteration.
 * If ROLLBACK fails, discard the connection; this source refuses further reads.
 */
export function createYaciHistorySource(
  client: YaciHistorySqlClient,
  deployment: HistoryDeployment,
  readCurrentState: () => Promise<UTxO>,
  options: { pageSize?: number } = {},
): HistorySource {
  const pageSize = integer(options.pageSize ?? 100, "page size");
  if (pageSize < 1 || pageSize > 1000) {
    throw new Error("Yaci history page size must be between 1 and 1000");
  }
  const policy = hex(deployment.clientToken.policyId, "NFT policy", 28);
  const name = deployment.clientToken.name;
  if (!/^(?:[0-9a-f]{2}){0,32}$/i.test(name)) {
    throw new Error("Yaci NFT name is invalid hex");
  }
  const unit = policy + name.toLowerCase();
  const address = deployment.stateAddress;
  if (!address) throw new Error("Yaci history state address is required");
  const bootstrapHash = hex(deployment.bootstrap.txHash, "bootstrap hash", 32);
  const bootstrapIndex = integer(
    deployment.bootstrap.outputIndex,
    "output index",
  );
  let active = false;
  let failedConnection = false;
  async function rollback(failure: unknown): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch (error) {
      failedConnection = true;
      throw new AggregateError(
        failure === undefined ? [error] : [failure, error],
        "Yaci rollback failed; discard the SQL connection",
      );
    }
  }

  return {
    currentState: readCurrentState,
    async *transactions(): AsyncGenerator<HistoryTransaction> {
      if (failedConnection) {
        throw new Error("Yaci rollback failed; discard the SQL connection");
      }
      if (active) throw new Error("Yaci history connection is already in use");
      active = true;
      let transactionOpen = false;
      let failure: unknown;
      try {
        // A failed BEGIN response can leave its server-side outcome uncertain.
        // Attempt ROLLBACK on that path too; poison the lease if cleanup fails.
        transactionOpen = true;
        await client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        const tipRows = (await client.query(`
          /* consensus-history:tip */
          SELECT number AS block_height, hash AS block_hash
          FROM block ORDER BY number DESC LIMIT 1
        `)).rows;
        if (tipRows.length !== 1) {
          throw new Error("Yaci canonical tip is unavailable");
        }
        const tip = row(tipRows[0]);
        const tipHeight = integer(tip.block_height, "tip height");
        const tipHash = hex(tip.block_hash, "tip hash", 32);

        const bootstrapRows = (await client.query(
          `
          /* consensus-history:bootstrap */
          SELECT t.block AS block_height, t.tx_index AS transaction_index
          FROM transaction t
          JOIN block b ON b.number = t.block AND b.hash = t.block_hash
          WHERE t.tx_hash = $3
            AND EXISTS (
              SELECT 1 FROM address_utxo a
              WHERE a.tx_hash = t.tx_hash AND a.output_index = $4
                AND ${NFT_OUTPUT}
            )
        `,
          [address, unit, bootstrapHash, bootstrapIndex],
        )).rows;
        if (bootstrapRows.length !== 1) {
          throw new Error(
            "Yaci bootstrap NFT output is missing from canonical history",
          );
        }
        const bootstrap = row(bootstrapRows[0]);
        const firstHeight = integer(bootstrap.block_height, "bootstrap height");
        const firstIndex = integer(
          bootstrap.transaction_index,
          "bootstrap transaction index",
        );
        if (firstHeight > tipHeight) {
          throw new Error("Yaci bootstrap is beyond the canonical tip");
        }
        let lastHeight = firstHeight;
        let lastIndex = firstIndex - 1;
        let first = true;
        while (true) {
          const rows = (await client.query(
            `
            /* consensus-history:page */
            SELECT t.tx_hash, b.hash AS block_hash, b.number AS block_height,
              b.slot AS slot, t.tx_index AS transaction_index,
              encode(c.cbor_data, 'hex') AS cbor
            FROM transaction t
            JOIN block b ON b.number = t.block AND b.hash = t.block_hash
            LEFT JOIN transaction_cbor c ON c.tx_hash = t.tx_hash
            WHERE (t.block, t.tx_index) > ($3::bigint, $4::integer)
              AND t.block <= $5
              AND EXISTS (
                SELECT 1 FROM address_utxo a
                WHERE a.tx_hash = t.tx_hash AND ${NFT_OUTPUT}
              )
            ORDER BY t.block ASC, t.tx_index ASC
            LIMIT $6
          `,
            [address, unit, lastHeight, lastIndex, tipHeight, pageSize],
          )).rows;
          if (rows.length > pageSize) {
            throw new Error("Yaci history exceeded the page limit");
          }
          for (const raw of rows) {
            const item = row(raw);
            const entry: HistoryTransaction = {
              txHash: hex(item.tx_hash, "transaction hash", 32),
              blockHash: hex(item.block_hash, "block hash", 32),
              blockHeight: integer(item.block_height, "block height"),
              slot: integer(item.slot, "slot"),
              transactionIndex: integer(
                item.transaction_index,
                "transaction index",
              ),
              cbor: hex(item.cbor, "raw transaction CBOR"),
            };
            if (
              entry.blockHeight > tipHeight || entry.blockHeight < lastHeight ||
              (entry.blockHeight === lastHeight &&
                entry.transactionIndex <= lastIndex)
            ) throw new Error("Yaci history transaction order is invalid");
            if (first && entry.txHash !== bootstrapHash) {
              throw new Error(
                "Yaci history does not begin at the bootstrap transaction",
              );
            }
            first = false;
            lastHeight = entry.blockHeight;
            lastIndex = entry.transactionIndex;
            yield entry;
          }
          if (rows.length < pageSize) break;
        }
        if (first) {
          throw new Error("Yaci bootstrap transaction evidence is unavailable");
        }
        await client.query("COMMIT");
        transactionOpen = false;
        const current = (await client.query(
          `
          /* consensus-history:recheck */
          SELECT hash AS block_hash FROM block WHERE number = $1
        `,
          [tipHeight],
        )).rows;
        if (
          current.length !== 1 ||
          hex(row(current[0]).block_hash, "canonical recheck hash", 32) !==
            tipHash
        ) throw new Error("Yaci canonical chain changed during history replay");
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        try {
          if (transactionOpen) await rollback(failure);
        } finally {
          active = false;
        }
      }
    },
  };
}
