#!/usr/bin/env ts-node
/**
 * Historical Backfill Script for Denom Trace Mappings
 *
 * This script scans historical voucher-mint transactions and backfills
 * denom traces using deterministic decoding/validation only.
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
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as Lucid from '@lucid-evolution/lucid';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BackfillRedeemerRecord, deriveVoucherTraceCandidatesForTx, splitTracePath } from './backfill-denom-traces.helpers';

type BridgeVoucherCandidateRow = {
  tx_hash: string;
  tx_cbor_hex: string;
  redeemers_json: Array<{
    type: string;
    data: string;
    index: number;
  }> | null;
  block_no: number | string;
  tx_index: number | string;
};

type TxMintGroup = {
  txHash: string;
  txCborHex: string;
  redeemers: BackfillRedeemerRecord[];
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
    const configService = app.get(ConfigService);
    const historyDataSource = app.get<DataSource>(getDataSourceToken('history'));

    const voucherMintingPolicyId = configService.get('deployment').validators.mintVoucher.scriptHash;
    
    if (!voucherMintingPolicyId) {
      throw new Error('Voucher minting policy ID not found in configuration');
    }

    logger.log(`Voucher minting policy ID: ${voucherMintingPolicyId}`);
    logger.log('Querying historical voucher minting transactions...');

    const voucherCandidateQuery = `
      SELECT
        e.tx_hash,
        encode(e.tx_cbor, 'hex') AS tx_cbor_hex,
        e.redeemers_json,
        e.block_no,
        e.tx_index
      FROM bridge_tx_evidence e
      INNER JOIN bridge_utxo_history u ON u.tx_hash = e.tx_hash
      WHERE u.assets_policy = $1
      GROUP BY e.tx_hash, e.tx_cbor, e.redeemers_json, e.block_no, e.tx_index
      ORDER BY e.block_no ASC, e.tx_index ASC
    `;

    const candidateRows = (await historyDataSource.query(voucherCandidateQuery, [
      voucherMintingPolicyId.toLowerCase(),
    ])) as BridgeVoucherCandidateRow[];

    logger.log(`Found ${candidateRows.length} historical voucher candidate transactions`);

    const mintsByTxHash = new Map<string, TxMintGroup>();
    for (const row of candidateRows) {
      const txHash = row.tx_hash.toLowerCase();
      const tokenNames = extractPositiveMintedTokenNames(row.tx_cbor_hex, voucherMintingPolicyId);
      if (tokenNames.size === 0) {
        continue;
      }

      const redeemers: BackfillRedeemerRecord[] = (row.redeemers_json ?? [])
        .filter((redeemer) => typeof redeemer?.type === 'string' && typeof redeemer?.data === 'string')
        .map((redeemer) => ({
          purpose: redeemer.type,
          redeemerHex: redeemer.data.toLowerCase(),
        }));

      mintsByTxHash.set(txHash, {
        txHash,
        txCborHex: row.tx_cbor_hex.toLowerCase(),
        redeemers,
        tokenNames,
      });
    }

    logger.log(`Found ${mintsByTxHash.size} transactions with positive voucher mints`);

    let txProcessed = 0;
    let tokenMintsProcessed = 0;
    let tracesSaved = 0;
    let unresolvedTokenMints = 0;
    let ambiguousTokenMints = 0;
    let conflictingExistingRows = 0;
    let hardErrors = 0;

    for (const txGroup of mintsByTxHash.values()) {
      try {
        txProcessed++;
        const candidates = deriveVoucherTraceCandidatesForTx(txGroup.redeemers, Lucid);
        const candidatesByHash = new Map<string, Set<string>>();
        for (const candidate of candidates) {
          // Keep all candidate paths per token hash so we can detect ambiguity explicitly.
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

          // Existing rows must match the newly derived canonical trace exactly.
          if (persisted.path !== trace.path || persisted.base_denom !== trace.baseDenom) {
            conflictingExistingRows++;
            logger.error(
              `Conflicting existing denom trace for hash ${tokenName}: expected ${trace.path}/${trace.baseDenom}, got ${persisted.path}/${persisted.base_denom}`,
            );
            continue;
          }

          // Fill tx_hash on older rows that predate current persistence behavior.
          if (!persisted.tx_hash) {
            await denomTraceService.setTxHashForTraces([tokenName], txGroup.txHash);
          }

          tracesSaved++;
        }
      } catch (error) {
        hardErrors++;
        logger.error(`Error processing tx=${txGroup.txHash}: ${error.message}`);
      } finally {
        if (txProcessed % 25 === 0) {
          logger.log(
            `Progress: tx=${txProcessed}/${mintsByTxHash.size}, token_mints=${tokenMintsProcessed}, saved=${tracesSaved}, unresolved=${unresolvedTokenMints}, ambiguous=${ambiguousTokenMints}, conflicts=${conflictingExistingRows}, errors=${hardErrors}`,
          );
        }
      }
    }

    logger.log('=== Backfill Complete ===');
    logger.log(`Transactions processed: ${txProcessed}`);
    logger.log(`Voucher mints processed: ${tokenMintsProcessed}`);
    logger.log(`Traces saved: ${tracesSaved}`);
    logger.log(`Unresolved voucher mints: ${unresolvedTokenMints}`);
    logger.log(`Ambiguous voucher mints: ${ambiguousTokenMints}`);
    logger.log(`Conflicting existing rows: ${conflictingExistingRows}`);
    logger.log(`Hard errors: ${hardErrors}`);

    // Any unresolved/ambiguous/conflicting result is a failing run.
    if (unresolvedTokenMints > 0 || ambiguousTokenMints > 0 || conflictingExistingRows > 0 || hardErrors > 0) {
      throw new Error(
        `Backfill failed integrity checks (unresolved=${unresolvedTokenMints}, ambiguous=${ambiguousTokenMints}, conflicts=${conflictingExistingRows}, errors=${hardErrors})`,
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

function extractPositiveMintedTokenNames(txCborHex: string, voucherMintingPolicyId: string): Set<string> {
  const tokenNames = new Set<string>();
  const transaction = CML.Transaction.from_cbor_hex(txCborHex);
  const mint = transaction.body().mint();
  if (!mint) {
    return tokenNames;
  }

  const positiveMint = mint.as_positive_multiasset();
  const policyIds = positiveMint.keys();
  const wantedPolicy = voucherMintingPolicyId.toLowerCase();

  for (let policyIndex = 0; policyIndex < policyIds.len(); policyIndex += 1) {
    const policyId = policyIds.get(policyIndex);
    const policyHex = policyId.to_hex().toLowerCase();
    if (policyHex !== wantedPolicy) {
      continue;
    }

    const assets = positiveMint.get_assets(policyId);
    const assetNames = assets?.keys();
    if (!assets || !assetNames) {
      continue;
    }

    for (let assetIndex = 0; assetIndex < assetNames.len(); assetIndex += 1) {
      const assetName = assetNames.get(assetIndex);
      const quantity = positiveMint.get(policyId, assetName);
      if (quantity && quantity > 0n) {
        tokenNames.add(assetName.to_hex().toLowerCase());
      }
    }
  }

  return tokenNames;
}

bootstrap();
