import { Injectable, Logger } from '@nestjs/common';
import { LucidService } from '../shared/modules/lucid/lucid.service';
import { GrpcInternalException } from '../exception/grpc_exceptions';
import { SubmitSignedTxRequest, SubmitSignedTxResponse } from './dto/submit-signed-tx.dto';
import { DbSyncService } from '../query/services/db-sync.service';
import { TxEventsService } from './tx-events.service';
import { KupoService } from '../shared/modules/kupo/kupo.service';
import { HostStateDatum } from '../shared/types/host-state-datum';

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly lucidService: LucidService,
    private readonly dbSyncService: DbSyncService,
    private readonly txEventsService: TxEventsService,
    private readonly kupoService: KupoService,
  ) {}

  /**
   * Submits a signed Cardano transaction to the network.
   * This endpoint is called by the Hermes relayer after it signs the transaction.
   * 
   * Flow:
   * 1. Hermes receives unsigned CBOR from Gateway
   * 2. Hermes signs with CIP-1852 key (Ed25519)
   * 3. Hermes calls this endpoint with signed CBOR
   * 4. Gateway submits to Cardano via Ogmios
   * 5. Gateway returns tx hash and events
   * 
   * @param request - Contains signed transaction CBOR hex string
   * @returns Transaction hash and confirmation details
   */
  async submitSignedTransaction(request: SubmitSignedTxRequest): Promise<SubmitSignedTxResponse> {
    try {
      this.logger.log(`Submitting signed transaction: ${request.description || 'unnamed'}`);
      
      // Parse signed transaction from hex CBOR
      const signedTxCbor = request.signed_tx_cbor;
      
      // Validate the CBOR format
      if (!signedTxCbor || signedTxCbor.length === 0) {
        throw new GrpcInternalException('Signed transaction CBOR is empty');
      }

      // Submit to Cardano network via Lucid/Ogmios
      // Note: Lucid's submit expects a Transaction object or signed CBOR
      const txHash = await this.submitToCardano(signedTxCbor);
      
      this.logger.log(`Transaction submitted successfully: ${txHash}`);

      // Wait for confirmation (optional - can be made configurable)
      await this.waitForConfirmation(txHash);

      // Hermes expects a non-empty IBC height string in the form "revisionNumber-revisionHeight".
      // For Cardano devnet we use revisionNumber=0 and revisionHeight=block_no from db-sync.
      // This is a Cardano block number (db-sync `block_no`), not a slot.
      const confirmedBlockNo = await this.waitForDbSyncTxHeight(txHash);

      const events = this.txEventsService.take(txHash) || [];
      this.logger.log(`[DEBUG] Returning ${events.length} events for tx ${txHash}`);
      
      const response: SubmitSignedTxResponse = {
        tx_hash: txHash,
        height: `0-${confirmedBlockNo}`,
        events,
      };

      return response;
    } catch (error) {
      this.logger.error(`submitSignedTransaction error: ${error.message}`, error.stack);
      throw new GrpcInternalException(`Failed to submit signed transaction: ${error.message}`);
    }
  }

  /**
   * Submit signed CBOR transaction to Cardano via Lucid/Ogmios.
   */
  private async submitToCardano(signedTxCbor: string): Promise<string> {
    try {
      // Submit the signed transaction directly using Lucid Evolution's wallet submitTx
      const txHash = await this.lucidService.lucid.wallet().submitTx(signedTxCbor);
      return txHash;
    } catch (error) {
      this.logger.error(`Failed to submit to Cardano: ${error.message}`);
      throw new GrpcInternalException(`Cardano submission failed: ${error.message}`);
    }
  }

  /**
   * Wait for transaction confirmation on-chain.
   * Polls Kupo/Ogmios until the transaction appears in a block.
   */
  private async waitForConfirmation(txHash: string, timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check if transaction is confirmed via Lucid's awaitTx
        const isConfirmed = await this.lucidService.lucid.awaitTx(txHash, pollInterval);
        if (isConfirmed) {
          this.logger.log(`Transaction ${txHash} confirmed`);
          return;
        }
      } catch (error) {
        // awaitTx throws if timeout reached, continue polling
        this.logger.debug(`Polling for tx confirmation: ${txHash}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    this.logger.warn(`Transaction ${txHash} confirmation timeout after ${timeoutMs}ms`);
    // Don't throw - transaction may still be pending, just return
  }

  /**
   * Wait for db-sync to index the transaction and return its block height (block_no).
   */
  private async waitForDbSyncTxHeight(txHash: string, timeoutMs: number = 60000): Promise<number> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const height = await this.dbSyncService.findHeightByTxHash(txHash);
        if (typeof height === 'number' && Number.isFinite(height)) {
          return height;
        }
      } catch (error) {
        // db-sync may not have indexed this tx yet; keep polling
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Fall back to the latest known block height so Hermes can proceed.
    const latestBlockNo = await this.dbSyncService.queryLatestBlockNo();
    this.logger.warn(
      `db-sync did not return a height for tx ${txHash} within ${timeoutMs}ms; falling back to latest block_no=${latestBlockNo}`,
    );
    return latestBlockNo;
  }
}
