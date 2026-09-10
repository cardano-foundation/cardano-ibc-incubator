"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverYaciHistoryBootstrap = discoverYaciHistoryBootstrap;
exports.createYaciHistorySource = createYaciHistorySource;
const consensusHistoryRecovery_ts_1 = require("./consensusHistoryRecovery.js");
const NFT_OUTPUT = `
  (a.owner_addr = $1 OR a.owner_addr_full = $1)
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(a.amounts::jsonb, '[]'::jsonb)) AS amount
    WHERE lower(amount->>'unit') = $2
      AND amount->>'quantity' = '1'
  )`;
function row(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Yaci history returned an invalid row");
    }
    return value;
}
function integer(value, label) {
    if (typeof value !== "number" && typeof value !== "bigint" &&
        !(typeof value === "string" && /^\d+$/.test(value)))
        throw new Error(`Yaci ${label} must be a nonnegative safe integer`);
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 0) {
        throw new Error(`Yaci ${label} must be a nonnegative safe integer`);
    }
    return result;
}
function hex(value, label, bytes) {
    if (typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(value) ||
        (bytes !== undefined && value.length !== bytes * 2))
        throw new Error(`Yaci ${label} is missing or invalid hex`);
    return value.toLowerCase();
}
function point(value) {
    return {
        txHash: hex(value.txHash, "resume transaction hash", 32),
        blockHash: hex(value.blockHash, "resume block hash", 32),
        blockHeight: integer(value.blockHeight, "resume block height"),
        slot: integer(value.slot, "resume slot"),
        transactionIndex: integer(value.transactionIndex, "resume transaction index"),
    };
}
function samePoint(left, right) {
    return left.txHash === right.txHash && left.blockHash === right.blockHash &&
        left.blockHeight === right.blockHeight && left.slot === right.slot &&
        left.transactionIndex === right.transactionIndex;
}
function canonicalValidity(invalid) {
    // Yaci TransactionProcessor copies this flag from the decoded canonical block.
    // Do not treat NULL/missing evidence or truthy strings as phase-2 validity.
    if (invalid !== false) {
        throw new Error("Yaci canonical transaction validity is missing or invalid");
    }
    return true;
}
/** Discover creation from canonical raw history, never an application cache. */
async function discoverYaciHistoryBootstrap(client, deployment) {
    const policy = hex(deployment.clientToken.policyId, "NFT policy", 28);
    const name = deployment.clientToken.name;
    if (!/^(?:[0-9a-f]{2}){0,32}$/i.test(name)) {
        throw new Error("Yaci NFT name is invalid hex");
    }
    if (!deployment.stateAddress) {
        throw new Error("Yaci history state address is required");
    }
    const token = { policyId: policy, name: name.toLowerCase() };
    let transactionOpen = true;
    try {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const rows = (await client.query(`
      /* consensus-history:discover */
      SELECT t.tx_hash, b.hash AS block_hash, b.number AS block_height,
        b.slot AS slot, t.tx_index AS transaction_index, a.output_index, t.invalid,
        encode(c.cbor_data, 'hex') AS cbor
      FROM address_utxo a
      JOIN transaction t ON t.tx_hash = a.tx_hash
      JOIN block b ON b.number = t.block AND b.hash = t.block_hash
      LEFT JOIN transaction_cbor c ON c.tx_hash = t.tx_hash
      WHERE ${NFT_OUTPUT}
      ORDER BY t.block ASC, t.tx_index ASC, a.output_index ASC
      LIMIT 1
    `, [deployment.stateAddress, token.policyId + token.name])).rows;
        if (rows.length !== 1) {
            throw new Error("Yaci client NFT creation is unavailable");
        }
        const candidate = row(rows[0]);
        const evidence = {
            txHash: hex(candidate.tx_hash, "creation transaction hash", 32),
            blockHash: hex(candidate.block_hash, "creation block hash", 32),
            blockHeight: integer(candidate.block_height, "creation block height"),
            slot: integer(candidate.slot, "creation slot"),
            transactionIndex: integer(candidate.transaction_index, "creation transaction index"),
            cbor: hex(candidate.cbor, "creation raw transaction CBOR"),
            valid: canonicalValidity(candidate.invalid),
        };
        const outputIndex = integer(candidate.output_index, "creation output index");
        (0, consensusHistoryRecovery_ts_1.validateHistoryBootstrap)(evidence, token, outputIndex, deployment.stateAddress);
        await client.query("COMMIT");
        transactionOpen = false;
        // The following recovery enumeration independently checks canonicality again.
        return { txHash: evidence.txHash, outputIndex };
    }
    catch (error) {
        if (transactionOpen) {
            try {
                await client.query("ROLLBACK");
            }
            catch (cleanup) {
                throw new AggregateError([error, cleanup], "Yaci rollback failed; discard the SQL connection");
            }
        }
        throw error;
    }
}
/**
 * Read canonical historical state transactions directly from Yaci's raw tables.
 * Spent address_utxo rows and transaction_cbor must be retained. No bridge
 * projection, application snapshot, schema changes or new dependencies are used.
 *
 * Resume inclusively from a checkpoint authenticated against the same read
 * snapshot as its subsequent pages. Only a missing/replaced canonical block is
 * an intersection failure: lag or incomplete transaction evidence is not a fork.
 * Intermediate replay checkpoints may be retained, but consume the iterator
 * completely before publishing an index: after COMMIT it rechecks the captured
 * block against a fresh database snapshot. The recovery caller must additionally
 * compare independently read live NFT anchors before publishing. This adapter
 * does not authenticate the database itself.
 * Body-only CBOR is paired with the canonical transaction.invalid flag, never a
 * synthesized full transaction. NULL or invalid flags fail closed.
 * The caller owns/release()s the idle connection; do not share it or begin an
 * outer transaction during iteration.
 * If ROLLBACK fails, discard the connection; this source refuses further reads.
 */
function createYaciHistorySource(client, deployment, readCurrentState, options = {}) {
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
    if (!address)
        throw new Error("Yaci history state address is required");
    const bootstrapHash = hex(deployment.bootstrap.txHash, "bootstrap hash", 32);
    const bootstrapIndex = integer(deployment.bootstrap.outputIndex, "output index");
    let active = false;
    let failedConnection = false;
    async function rollback(failure) {
        try {
            await client.query("ROLLBACK");
        }
        catch (error) {
            failedConnection = true;
            throw new AggregateError(failure === undefined ? [error] : [failure, error], "Yaci rollback failed; discard the SQL connection");
        }
    }
    return {
        currentState: readCurrentState,
        async *transactions(after) {
            if (failedConnection) {
                throw new Error("Yaci rollback failed; discard the SQL connection");
            }
            if (active)
                throw new Error("Yaci history connection is already in use");
            active = true;
            let transactionOpen = false;
            let failure;
            try {
                // Copy scalars before awaiting SQL; callers cannot mutate the checkpoint
                // between its validation and the first evidence page.
                const resume = after === undefined ? undefined : point(after);
                // A failed BEGIN response can leave its server-side outcome uncertain.
                // Attempt ROLLBACK on that path too; poison the lease if cleanup fails.
                transactionOpen = true;
                await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
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
                let firstHeight;
                let firstIndex;
                if (resume) {
                    if (resume.blockHeight > tipHeight) {
                        throw new Error("Yaci canonical tip is behind the resume point");
                    }
                    const intersectionRows = (await client.query(`
            /* consensus-history:intersection */
            SELECT b.hash AS block_hash, b.number AS block_height, b.slot AS slot,
              t.tx_hash, t.tx_index AS transaction_index,
              EXISTS (
                SELECT 1 FROM address_utxo a
                WHERE a.tx_hash = t.tx_hash AND ${NFT_OUTPUT}
              ) AS has_state_nft
            FROM block b
            LEFT JOIN transaction t
              ON b.number = t.block AND b.hash = t.block_hash AND t.tx_index = $4
            WHERE b.number = $3
          `, [address, unit, resume.blockHeight, resume.transactionIndex])).rows;
                    if (intersectionRows.length === 0) {
                        throw new consensusHistoryRecovery_ts_1.HistoryIntersectionError("Yaci resume block is no longer canonical");
                    }
                    if (intersectionRows.length !== 1) {
                        throw new Error("Yaci resume point has ambiguous canonical evidence");
                    }
                    const intersection = row(intersectionRows[0]);
                    const blockHash = hex(intersection.block_hash, "resume block hash", 32);
                    if (blockHash !== resume.blockHash) {
                        throw new consensusHistoryRecovery_ts_1.HistoryIntersectionError("Yaci resume block is no longer canonical");
                    }
                    // With the same canonical block hash, missing or changed transactions
                    // are incomplete/corrupt source data, not a reason to erase progress.
                    const canonical = {
                        blockHash,
                        txHash: hex(intersection.tx_hash, "resume transaction evidence", 32),
                        blockHeight: integer(intersection.block_height, "resume block height"),
                        slot: integer(intersection.slot, "resume slot"),
                        transactionIndex: integer(intersection.transaction_index, "resume transaction index"),
                    };
                    if (!samePoint(canonical, resume)) {
                        throw new Error("Yaci resume transaction evidence is inconsistent");
                    }
                    if (intersection.has_state_nft !== true) {
                        throw new Error("Yaci resume NFT output evidence is unavailable");
                    }
                    firstHeight = resume.blockHeight;
                    firstIndex = resume.transactionIndex;
                }
                else {
                    const bootstrapRows = (await client.query(`
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
          `, [address, unit, bootstrapHash, bootstrapIndex])).rows;
                    if (bootstrapRows.length !== 1) {
                        throw new Error("Yaci bootstrap NFT output is missing from canonical history");
                    }
                    const bootstrap = row(bootstrapRows[0]);
                    firstHeight = integer(bootstrap.block_height, "bootstrap height");
                    firstIndex = integer(bootstrap.transaction_index, "bootstrap transaction index");
                }
                if (firstHeight > tipHeight) {
                    throw new Error("Yaci bootstrap is beyond the canonical tip");
                }
                let lastHeight = firstHeight;
                let lastIndex = firstIndex - 1;
                let first = true;
                while (true) {
                    const rows = (await client.query(`
            /* consensus-history:page */
            SELECT t.tx_hash, b.hash AS block_hash, b.number AS block_height,
              b.slot AS slot, t.tx_index AS transaction_index, t.invalid,
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
          `, [address, unit, lastHeight, lastIndex, tipHeight, pageSize])).rows;
                    if (rows.length > pageSize) {
                        throw new Error("Yaci history exceeded the page limit");
                    }
                    for (const raw of rows) {
                        const item = row(raw);
                        const entry = {
                            txHash: hex(item.tx_hash, "transaction hash", 32),
                            blockHash: hex(item.block_hash, "block hash", 32),
                            blockHeight: integer(item.block_height, "block height"),
                            slot: integer(item.slot, "slot"),
                            transactionIndex: integer(item.transaction_index, "transaction index"),
                            cbor: hex(item.cbor, "raw transaction CBOR"),
                            valid: canonicalValidity(item.invalid),
                        };
                        if (entry.blockHeight > tipHeight || entry.blockHeight < lastHeight ||
                            (entry.blockHeight === lastHeight &&
                                entry.transactionIndex <= lastIndex))
                            throw new Error("Yaci history transaction order is invalid");
                        if (first && resume && !samePoint(entry, resume)) {
                            throw new Error("Yaci history does not begin at the validated resume point");
                        }
                        if (first && !resume && entry.txHash !== bootstrapHash) {
                            throw new Error("Yaci history does not begin at the bootstrap transaction");
                        }
                        first = false;
                        lastHeight = entry.blockHeight;
                        lastIndex = entry.transactionIndex;
                        yield entry;
                    }
                    if (rows.length < pageSize)
                        break;
                }
                if (first) {
                    throw new Error(`Yaci ${resume ? "resume" : "bootstrap"} transaction evidence is unavailable`);
                }
                await client.query("COMMIT");
                transactionOpen = false;
                const current = (await client.query(`
          /* consensus-history:recheck */
          SELECT hash AS block_hash FROM block WHERE number = $1
        `, [tipHeight])).rows;
                if (current.length > 1) {
                    throw new Error("Yaci canonical recheck returned ambiguous evidence");
                }
                if (current.length === 0 ||
                    hex(row(current[0]).block_hash, "canonical recheck hash", 32) !==
                        tipHash) {
                    throw new consensusHistoryRecovery_ts_1.HistorySnapshotChangedError("Yaci canonical chain changed during history replay");
                }
            }
            catch (error) {
                failure = error;
                throw error;
            }
            finally {
                try {
                    if (transactionOpen)
                        await rollback(failure);
                }
                finally {
                    active = false;
                }
            }
        },
    };
}
