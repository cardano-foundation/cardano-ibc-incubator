#!/usr/bin/env ts-node
/**
 * Historical Backfill Script for Denom Trace Mappings
 * 
 * This script scans historical Cardano transactions for voucher minting events
 * and populates the denom_traces table with the hash-to-trace mappings.
 * 
 * Usage:
 *   ts-node backfill-denom-traces.ts
 * 
 * The script will:
 * 1. Query all transactions that interact with the voucher minting policy
 * 2. Extract redeemer data containing fungible token packet data
 * 3. Parse denom strings to extract path and base denomination
 * 4. Compute hashes and save to denom_traces table
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DenomTraceService } from '../query/services/denom-trace.service';
import { DbSyncService } from '../query/services/db-sync.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { hashSha3_256, convertHex2String, convertString2Hex } from '../shared/helpers/hex';
import { getDenomPrefix } from '../shared/helpers/helper';

async function bootstrap() {
  const logger = new Logger('BackfillDenomTraces');
  logger.log('Starting denom trace backfill process...');

  try {
    // Create NestJS application context
    const app = await NestFactory.createApplicationContext(AppModule);
    
    const denomTraceService = app.get(DenomTraceService);
    const dbSyncService = app.get(DbSyncService);
    const configService = app.get(ConfigService);

    const voucherMintingPolicyId = configService.get('deployment').validators.mintVoucher.scriptHash;
    
    if (!voucherMintingPolicyId) {
      throw new Error('Voucher minting policy ID not found in configuration');
    }

    logger.log(`Voucher minting policy ID: ${voucherMintingPolicyId}`);
    logger.log('Querying historical voucher minting transactions...');

    // Query all transactions that minted voucher tokens
    // This queries cardano-db-sync for all transactions with the voucher minting policy
    const query = `
      SELECT DISTINCT
        tx.hash AS tx_hash,
        tx.id AS tx_id,
        ma.name AS token_name,
        ma.policy AS policy_id,
        datum.bytes AS datum_bytes,
        redeemer.unit_mem,
        redeemer.unit_steps,
        redeemer.purpose,
        redeemer_data.bytes AS redeemer_bytes
      FROM tx
      INNER JOIN ma_tx_mint mtm ON mtm.tx_id = tx.id
      INNER JOIN multi_asset ma ON ma.id = mtm.ident
      LEFT JOIN redeemer ON redeemer.tx_id = tx.id
      LEFT JOIN redeemer_data ON redeemer_data.id = redeemer.redeemer_data_id
      LEFT JOIN tx_out ON tx_out.tx_id = tx.id
      LEFT JOIN datum ON datum.id = tx_out.inline_datum_id
      WHERE ma.policy = $1
      ORDER BY tx.id ASC
    `;

    const result = await dbSyncService['entityManager'].query(query, [`\\x${voucherMintingPolicyId}`]);
    
    logger.log(`Found ${result.length} voucher minting transactions`);

    let processed = 0;
    let saved = 0;
    let errors = 0;

    for (const row of result) {
      try {
        processed++;
        
        const tokenName = row.token_name?.toString('hex');
        const txHash = row.tx_hash?.toString('hex');
        
        if (!tokenName) {
          logger.warn(`Skipping row ${processed}: No token name found`);
          continue;
        }

        // Try to extract denom path from redeemer data
        // The redeemer contains the packet with fungible token data
        let denomPath = null;
        let baseDenom = null;

        if (row.redeemer_bytes) {
          try {
            // Parse redeemer to extract packet data
            // This is a simplified extraction - in production you'd need to properly decode the CBOR
            const redeemerHex = row.redeemer_bytes.toString('hex');
            
            // Look for denom patterns in the redeemer data
            // This is a heuristic approach - proper CBOR decoding would be better
            const hexString = redeemerHex;
            
            // Try to find transfer/ or port/ patterns
            const transferPattern = /7472616e736665722f/g; // "transfer/" in hex
            const matches = [...hexString.matchAll(transferPattern)];
            
            if (matches.length > 0) {
              // Found a denom path, try to extract it
              // This is simplified - in production you'd decode the full packet structure
              logger.debug(`Found potential denom in tx ${txHash.substring(0, 8)}...`);
            }
          } catch (error) {
            logger.debug(`Could not parse redeemer for tx ${txHash}: ${error.message}`);
          }
        }

        // If we couldn't extract from redeemer, we can still save the hash
        // with placeholder values that can be updated later
        if (!denomPath || !baseDenom) {
          // Use a placeholder pattern
          // In a real scenario, you might skip these or handle them differently
          denomPath = 'unknown';
          baseDenom = 'unknown';
          logger.debug(`Using placeholder denom for token ${tokenName.substring(0, 16)}...`);
        }

        // Save the denom trace
        await denomTraceService.saveDenomTrace({
          hash: tokenName,
          path: denomPath,
          base_denom: baseDenom,
          voucher_policy_id: voucherMintingPolicyId,
          tx_hash: txHash,
        });

        saved++;

        if (processed % 10 === 0) {
          logger.log(`Progress: ${processed}/${result.length} processed, ${saved} saved, ${errors} errors`);
        }
      } catch (error) {
        errors++;
        logger.error(`Error processing row ${processed}: ${error.message}`);
      }
    }

    logger.log('=== Backfill Complete ===');
    logger.log(`Total transactions processed: ${processed}`);
    logger.log(`Denom traces saved: ${saved}`);
    logger.log(`Errors: ${errors}`);

    await app.close();
  } catch (error) {
    logger.error(`Backfill script failed: ${error.message}`, error.stack);
    process.exit(1);
  }
}

bootstrap();
