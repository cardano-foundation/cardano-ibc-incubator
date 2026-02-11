#!/usr/bin/env ts-node
/**
 * Strict Historical Backfill Script for Denom Trace Mappings
 *
 * This script scans historical voucher-mint transactions and backfills
 * denom traces using strict decoding/validation only.
 *
 * Usage:
 *   ts-node backfill-denom-traces.ts
 *
 * The script will:
 * 1. Query historical voucher mint transactions (`quantity > 0`)
 * 2. Decode redeemers with known schemas (no regex/heuristics)
 * 3. Derive canonical full denom path and verify minted token-name hash
 * 4. Save only deterministic mappings; skip unresolved/ambiguous entries
 *
 * Integrity rule:
 * - If any voucher mint cannot be resolved deterministically, the script exits non-zero.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DenomTraceService } from '../query/services/denom-trace.service';
import { DbSyncService } from '../query/services/db-sync.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as Lucid from '@lucid-evolution/lucid';
import { BackfillRedeemerRecord, deriveVoucherTraceCandidatesForTx, splitTracePath } from './backfill-denom-traces.helpers';

type MintTokenRow = {
  tx_id: number | string;
  tx_hash: Buffer | string;
  token_name: Buffer | string;
};

type RedeemerRow = {
  purpose: string;
  redeemer_bytes: Buffer | string | null;
};

type TxMintGroup = {
  txHash: string;
  tokenNames: Set<string>;
};

async function bootstrap() {
  const logger = new Logger('BackfillDenomTraces');
  logger.log('Starting denom trace backfill process...');

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null;
  try {
    // Create NestJS application context
    app = await NestFactory.createApplicationContext(AppModule);

    const denomTraceService = app.get(DenomTraceService);
    const dbSyncService = app.get(DbSyncService);
    const configService = app.get(ConfigService);

    const voucherMintingPolicyId = configService.get('deployment').validators.mintVoucher.scriptHash;
    
    if (!voucherMintingPolicyId) {
      throw new Error('Voucher minting policy ID not found in configuration');
    }

    logger.log(`Voucher minting policy ID: ${voucherMintingPolicyId}`);
    logger.log('Querying historical voucher minting transactions...');

    const mintRowsQuery = `
      SELECT
        tx.hash AS tx_hash,
        tx.id AS tx_id,
        ma.name AS token_name
      FROM tx
      INNER JOIN ma_tx_mint mtm ON mtm.tx_id = tx.id
      INNER JOIN multi_asset ma ON ma.id = mtm.ident
      WHERE ma.policy = $1
        AND mtm.quantity > 0
      ORDER BY tx.id ASC
    `;

    const mintRows = (await dbSyncService['entityManager'].query(mintRowsQuery, [
      `\\x${voucherMintingPolicyId}`,
    ])) as MintTokenRow[];

    logger.log(`Found ${mintRows.length} voucher mint rows`);

    const mintsByTxId = new Map<string, TxMintGroup>();
    for (const row of mintRows) {
      const txId = String(row.tx_id);
      const txHash = toHex(row.tx_hash);
      const tokenName = toHex(row.token_name);
      if (!txHash || !tokenName) {
        logger.warn(`Skipping tx_id=${txId}: missing tx hash or token name bytes`);
        continue;
      }

      const group = mintsByTxId.get(txId) ?? { txHash, tokenNames: new Set<string>() };
      group.tokenNames.add(tokenName.toLowerCase());
      mintsByTxId.set(txId, group);
    }

    logger.log(`Found ${mintsByTxId.size} transactions with voucher mints`);

    const redeemersByTxQuery = `
      SELECT rd.purpose AS purpose, rd_data.bytes AS redeemer_bytes
      FROM redeemer rd
      INNER JOIN redeemer_data rd_data ON rd_data.id = rd.redeemer_data_id
      WHERE rd.tx_id = $1
      ORDER BY rd.id ASC
    `;

    let txProcessed = 0;
    let tokenMintsProcessed = 0;
    let tracesSaved = 0;
    let unresolvedTokenMints = 0;
    let ambiguousTokenMints = 0;
    let conflictingExistingRows = 0;
    let hardErrors = 0;

    for (const [txId, txGroup] of mintsByTxId.entries()) {
      try {
        txProcessed++;

        const redeemerRows = (await dbSyncService['entityManager'].query(redeemersByTxQuery, [txId])) as RedeemerRow[];
        const redeemers: BackfillRedeemerRecord[] = redeemerRows
          .map((row) => ({
            purpose: row.purpose,
            redeemerHex: toHex(row.redeemer_bytes),
          }))
          .filter((row) => !!row.redeemerHex);

        const candidates = deriveVoucherTraceCandidatesForTx(redeemers, Lucid);
        const candidatesByHash = new Map<string, Set<string>>();
        for (const candidate of candidates) {
          const key = candidate.voucherTokenName.toLowerCase();
          const paths = candidatesByHash.get(key) ?? new Set<string>();
          paths.add(candidate.fullDenomPath);
          candidatesByHash.set(key, paths);
        }

        for (const tokenName of txGroup.tokenNames) {
          tokenMintsProcessed++;
          const matchedPaths = Array.from(candidatesByHash.get(tokenName) ?? []);
          if (matchedPaths.length === 0) {
            unresolvedTokenMints++;
            logger.warn(
              `Unresolved voucher mint: tx=${txGroup.txHash.substring(0, 12)}..., token=${tokenName.substring(0, 16)}...`,
            );
            continue;
          }
          if (matchedPaths.length > 1) {
            ambiguousTokenMints++;
            logger.warn(
              `Ambiguous voucher mint: tx=${txGroup.txHash.substring(0, 12)}..., token=${tokenName.substring(0, 16)}..., paths=${matchedPaths.length}`,
            );
            continue;
          }

          const trace = splitTracePath(matchedPaths[0]);
          if (!trace) {
            unresolvedTokenMints++;
            logger.warn(
              `Invalid derived denom path: tx=${txGroup.txHash.substring(0, 12)}..., token=${tokenName.substring(0, 16)}..., path=${matchedPaths[0]}`,
            );
            continue;
          }

          const persisted = await denomTraceService.saveDenomTrace({
            hash: tokenName,
            path: trace.path,
            base_denom: trace.baseDenom,
            voucher_policy_id: voucherMintingPolicyId,
            tx_hash: txGroup.txHash,
          });

          if (persisted.path !== trace.path || persisted.base_denom !== trace.baseDenom) {
            conflictingExistingRows++;
            logger.error(
              `Conflicting existing denom trace for hash ${tokenName}: expected ${trace.path}/${trace.baseDenom}, got ${persisted.path}/${persisted.base_denom}`,
            );
            continue;
          }

          if (!persisted.tx_hash) {
            await denomTraceService.setTxHashForTraces([tokenName], txGroup.txHash);
          }

          tracesSaved++;
        }
      } catch (error) {
        hardErrors++;
        logger.error(`Error processing tx_id=${txId}: ${error.message}`);
      } finally {
        if (txProcessed % 25 === 0) {
          logger.log(
            `Progress: tx=${txProcessed}/${mintsByTxId.size}, token_mints=${tokenMintsProcessed}, saved=${tracesSaved}, unresolved=${unresolvedTokenMints}, ambiguous=${ambiguousTokenMints}, conflicts=${conflictingExistingRows}, errors=${hardErrors}`,
          );
        }
      }
    }

    logger.log('=== Strict Backfill Complete ===');
    logger.log(`Transactions processed: ${txProcessed}`);
    logger.log(`Voucher mints processed: ${tokenMintsProcessed}`);
    logger.log(`Traces saved: ${tracesSaved}`);
    logger.log(`Unresolved voucher mints: ${unresolvedTokenMints}`);
    logger.log(`Ambiguous voucher mints: ${ambiguousTokenMints}`);
    logger.log(`Conflicting existing rows: ${conflictingExistingRows}`);
    logger.log(`Hard errors: ${hardErrors}`);

    if (unresolvedTokenMints > 0 || ambiguousTokenMints > 0 || conflictingExistingRows > 0 || hardErrors > 0) {
      throw new Error(
        `Strict backfill failed integrity checks (unresolved=${unresolvedTokenMints}, ambiguous=${ambiguousTokenMints}, conflicts=${conflictingExistingRows}, errors=${hardErrors})`,
      );
    }
  } catch (error) {
    logger.error(`Backfill script failed: ${error.message}`, error.stack);
    process.exit(1);
  } finally {
    if (app) {
      await app.close();
    }
  }
}

function toHex(value: Buffer | string | null | undefined): string {
  if (!value) return '';
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'string') {
    return value.startsWith('\\x') ? value.slice(2) : value;
  }
  return '';
}

bootstrap();
