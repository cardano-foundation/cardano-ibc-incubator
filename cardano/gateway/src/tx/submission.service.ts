import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '../shared/modules/lucid/lucid.service';
import { GrpcInternalException } from '../exception/grpc_exceptions';
import { SubmitSignedTxRequest, SubmitSignedTxResponse } from './dto/submit-signed-tx.dto';
import { TxEventsService } from './tx-events.service';
import { HostStateDatum } from '../shared/types/host-state-datum';
import { IbcTreePendingUpdatesService } from '../shared/services/ibc-tree-pending-updates.service';
import { IbcTreeCacheService } from '../shared/services/ibc-tree-cache.service';
import { getCurrentTree } from '../shared/helpers/ibc-state-root';
import { DenomTraceService } from '../query/services/denom-trace.service';
import { queryNetworkTipPoint, queryTransactionInclusionBlockHeight } from '../shared/helpers/time';
import { isLocalCardanoDevnet } from './helper/tx-validity';

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly lucidService: LucidService,
    private readonly configService: ConfigService,
    private readonly txEventsService: TxEventsService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
    private readonly ibcTreeCacheService: IbcTreeCacheService,
    private readonly denomTraceService: DenomTraceService,
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

      const preSubmitPoint = await this.capturePreSubmitPoint();

      // Submit to Cardano network via Lucid/Ogmios
      // Note: Lucid's submit expects a Transaction object or signed CBOR
      const txHash = await this.submitToCardano(signedTxCbor);
      
      this.logger.log(`Transaction submitted successfully: ${txHash}`);

      const isConfirmed = await this.waitForConfirmation(txHash);
      if (!isConfirmed) {
        throw new GrpcInternalException(`Transaction ${txHash} was not confirmed`);
      }

      // Hermes expects the exact tx inclusion height in "revisionNumber-revisionHeight" form.
      // We capture the pre-submit chain point, then follow Ogmios forward until the submitted
      // tx hash appears in a concrete block.
      const confirmedBlockNo = await this.waitForTxInclusionBlockHeight(txHash, preSubmitPoint);

      await this.applyPendingIbcTreeUpdate(signedTxCbor, txHash);

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

  private async applyPendingIbcTreeUpdate(signedTxCbor: string, txHash: string): Promise<void> {
    // Tree updates are registered when building unsigned txs and keyed by tx hash.
    // We only commit them after confirmation, to avoid stale in-memory state if submission fails.
    let pending = this.ibcTreePendingUpdatesService.take(txHash);
    let confirmedRoot: string | undefined;

    // Best-effort: if hashes don't line up due to encoding/formatting, compute the canonical body hash.
    if (!pending) {
      const fallbackHash = this.computeTxBodyHashHex(signedTxCbor);
      if (fallbackHash && fallbackHash.toLowerCase() !== txHash.toLowerCase()) {
        pending = this.ibcTreePendingUpdatesService.take(fallbackHash);
      }
    }

    // Strict fallback: if hash matching fails, resolve the pending update by the resulting
    // on-chain root. This keeps correctness strict (root must match exactly) while handling
    // signer/tooling paths that produce a different tx hash key than we recorded pre-signing.
    if (!pending) {
      confirmedRoot = await this.readConfirmedTxRoot(signedTxCbor, txHash);
      pending = this.ibcTreePendingUpdatesService.takeByExpectedRoot(confirmedRoot);
      if (pending) {
        this.logger.warn(
          `Resolved pending IBC update for tx ${txHash} via confirmed-tx root fallback (hash-key lookup missed)`,
        );
      }
    }

    if (!pending) {
      throw new GrpcInternalException(
        `Missing pending IBC update for confirmed tx ${txHash}; refusing to skip denom trace/tree finalization`,
      );
    }

    // Attach tx_hash to traces before commit so mapping rows remain connected to the
    // submitted transaction even when later steps fail or process restarts occur.
    // Resolve HostState from the exact confirmed transaction.
    // We intentionally do not accept "latest HostState" here because that can
    // mask history-backend/runtime failures and attach traces to the wrong tx context.
    // Verify on-chain root matches what we computed when building the tx.
    if (!confirmedRoot) {
      confirmedRoot = await this.readConfirmedTxRoot(signedTxCbor, txHash);
    }

    if (confirmedRoot !== pending.expectedNewRoot) {
      throw new GrpcInternalException(
        `Confirmed tx root mismatch for tx ${txHash}: expected ${pending.expectedNewRoot.substring(0, 16)}..., got ${confirmedRoot.substring(0, 16)}...`,
      );
    }

    // Only attach tx_hash after root verification so denom trace rows are never
    // finalized against a transaction that resolved to a different HostState root.
    await this.finalizePendingDenomTraces(pending.denomTraceHashes, txHash);

    pending.commit();

    // Persist the updated tree so restarts don't require scanning all IBC UTxOs.
    if (process.env.IBC_TREE_CACHE_ENABLED === 'false') return;
    try {
      await this.ibcTreeCacheService.save(getCurrentTree(), 'current');
    } catch (error) {
      this.logger.warn(`Failed to persist IBC tree cache after tx ${txHash}: ${error?.message ?? error}`);
    }
  }

  private async readConfirmedTxRoot(signedTxCbor: string, txHash: string): Promise<string> {
    try {
      const hostStateDatumCbor = this.extractHostStateDatumCborFromSignedTx(signedTxCbor, txHash);
      const hostStateDatumAtTx = await this.lucidService.decodeDatum<HostStateDatum>(hostStateDatumCbor, 'host_state');
      return hostStateDatumAtTx.state.ibc_state_root;
    } catch (error) {
      throw new GrpcInternalException(
        `Failed to resolve HostState root for tx ${txHash} from the confirmed transaction: ${error?.message ?? error}`,
      );
    }
  }

  private extractHostStateDatumCborFromSignedTx(signedTxCbor: string, txHash: string): string {
    const hostStateOutput = this.findHostStateOutputInSignedTx(signedTxCbor, txHash);
    const datumOption = hostStateOutput.datum?.();
    const plutusDatum = datumOption?.as_datum?.();
    if (!plutusDatum) {
      throw new Error(`Missing inline HostState datum in confirmed tx ${txHash}`);
    }
    return plutusDatum.to_cbor_hex();
  }

  private findHostStateOutputInSignedTx(signedTxCbor: string, txHash: string): any {
    const { CML } = this.lucidService.LucidImporter as any;
    const hostStateNft = this.configService.get('deployment').hostStateNFT;
    const transaction = CML.Transaction.from_cbor_hex(signedTxCbor);
    const outputs = transaction.body().outputs();
    const policyId = CML.ScriptHash.from_hex(hostStateNft.policyId);
    const tokenName = CML.AssetName.from_hex(hostStateNft.name);

    for (let index = 0; index < outputs.len(); index += 1) {
      const output = outputs.get(index);
      const amount = output.amount?.();
      if (!amount?.has_multiassets?.()) {
        continue;
      }

      const quantity = amount.multi_asset?.()?.get?.(policyId, tokenName);
      if (typeof quantity === 'bigint' ? quantity > 0n : quantity !== undefined) {
        return output;
      }
    }

    throw new Error(`Confirmed tx ${txHash} does not contain a HostState output`);
  }

  private async finalizePendingDenomTraces(traceHashes: string[] | undefined, txHash: string): Promise<void> {
    // We treat "missing some expected rows" as an integrity error because partial
    // trace finalization makes ibc/<hash> reverse lookup/debugging ambiguous.
    const hashes = Array.from(new Set((traceHashes ?? []).map((hash) => hash.toLowerCase())));
    if (hashes.length === 0) return;

    let updated = 0;
    try {
      updated = await this.denomTraceService.setTxHashForTraces(hashes, txHash);
    } catch (error) {
      throw new GrpcInternalException(
        `Failed to finalize denom trace mappings for tx ${txHash}: ${error?.message ?? error}`,
      );
    }

    if (updated !== hashes.length) {
      throw new GrpcInternalException(
        `Failed to finalize denom trace mappings for tx ${txHash}: expected ${hashes.length} traces, updated ${updated}`,
      );
    }
  }

  private computeTxBodyHashHex(txCborHex: string): string | null {
    try {
      const { CML } = this.lucidService.LucidImporter;
      if (!CML?.Transaction?.from_cbor_hex) return null;
      const parsedTx = CML.Transaction.from_cbor_hex(txCborHex);
      const body = parsedTx.body();
      if (typeof CML.hash_transaction === 'function') {
        return CML.hash_transaction(body).to_hex();
      }
      return null;
    } catch {
      return null;
    }
  }

  private async capturePreSubmitPoint(): Promise<{ slot: number; id: string } | 'origin'> {
    const ogmiosEndpoint = this.configService.get<string>('ogmiosEndpoint');
    if (!ogmiosEndpoint) {
      throw new GrpcInternalException('Missing OGMIOS_ENDPOINT for pre-submit chain point lookup');
    }

    try {
      return await queryNetworkTipPoint(ogmiosEndpoint);
    } catch (error) {
      throw new GrpcInternalException(
        `Failed to capture pre-submit chain point from Ogmios: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * Submit signed CBOR transaction to Cardano via Lucid/Ogmios.
   */
  private async submitToCardano(signedTxCbor: string): Promise<string> {
    // Cardano nodes reject transactions which are "too early" for their validity interval.
    // This happens in local/devnet setups when:
    // - the Gateway builds the transaction against wallclock time (Lucid uses `unixTimeToSlot(Date.now())`), but
    // - the node's ledger tip is still catching up, so its `currentSlot` is behind wallclock.
    //
    // Ogmios returns error code 3118 with details like:
    //   data.currentSlot = 2965
    //   data.validityInterval.invalidBefore = 2966
    //
    // In that case we can safely wait until the node reaches `invalidBefore` and retry submission.
    const localDevnet = isLocalCardanoDevnet(this.configService);
    const maxRetries = localDevnet ? 20 : 10;
    const slotLengthMs = 1000; // Devnet + mainnet are 1s slots in Shelley+ eras.
    const retryBackoffMs = 250; // Small cushion to avoid edge-of-slot races.
    const unknownInputRetryBaseDelayMs = localDevnet ? 500 : 3000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Submit the signed transaction directly using Lucid Evolution's wallet submitTx.
        return await this.lucidService.lucid.wallet().submitTx(signedTxCbor);
      } catch (error) {
        const tooEarly = this.parseTxSubmittedTooEarlyError(error);
        if (!tooEarly) {
          const unknownInputs = this.parseUnknownInputVisibilityError(error);
          if (!unknownInputs) {
            const message = typeof error?.message === 'string' ? error.message : String(error);
            this.logger.error(`Failed to submit to Cardano: ${message}`);
            throw new GrpcInternalException(`Cardano submission failed: ${message}`);
          }

          if (attempt >= maxRetries) {
            const message = typeof error?.message === 'string' ? error.message : String(error);
            this.logger.error(
              `Tx inputs still unknown to Ogmios after ${maxRetries} retries (${unknownInputs.refs.join(', ') || 'refs unavailable'}): ${message}`,
            );
            throw new GrpcInternalException(`Cardano submission failed: ${message}`);
          }

          // Kupo can surface fresh change outputs slightly before Ogmios accepts them as
          // spendable inputs. Retrying the exact same signed tx is safe once Ogmios catches up.
          // Keep local-devnet retries short and flat so the tx does not expire while waiting
          // for node/Kupo visibility to converge.
          const waitMs = localDevnet
            ? unknownInputRetryBaseDelayMs
            : unknownInputRetryBaseDelayMs * (attempt + 1);
          this.logger.warn(
            `Tx rejected with transient unknown input references (${unknownInputs.refs.join(', ') || 'refs unavailable'}); waiting ${waitMs}ms and retrying (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        const { currentSlot, invalidBefore, invalidAfter } = tooEarly;
        // If we somehow reached here but the tx is already expired, do not retry.
        if (typeof invalidAfter === 'number' && currentSlot > invalidAfter) {
          const message = typeof error?.message === 'string' ? error.message : String(error);
          this.logger.error(
            `Tx rejected as too late (currentSlot=${currentSlot}, invalidAfter=${invalidAfter}): ${message}`,
          );
          throw new GrpcInternalException(`Cardano submission failed: ${message}`);
        }

        // If we have retries left, wait until the lower bound should be satisfied and retry.
        if (attempt >= maxRetries) {
          const message = typeof error?.message === 'string' ? error.message : String(error);
          this.logger.error(
            `Tx still too early after ${maxRetries} retries (currentSlot=${currentSlot}, invalidBefore=${invalidBefore}): ${message}`,
          );
          throw new GrpcInternalException(`Cardano submission failed: ${message}`);
        }

        const waitSlots = Math.max(1, invalidBefore - currentSlot);
        const waitMs = waitSlots * slotLengthMs + retryBackoffMs;

        this.logger.warn(
          `Tx rejected as too early (currentSlot=${currentSlot}, invalidBefore=${invalidBefore}); waiting ${waitMs}ms and retrying (attempt ${attempt + 1}/${maxRetries})`,
        );

        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    // Unreachable (loop either returns a tx hash or throws), but keeps TypeScript happy.
    throw new GrpcInternalException('Cardano submission failed: unexpected retry loop exit');
  }

  /**
   * Best-effort detection of Ogmios error code 3118 ("outside of its validity interval") specifically
   * for the "submitted too early" case. This lets the Gateway wait/retry instead of surfacing a
   * transient failure to Hermes.
   */
  private parseTxSubmittedTooEarlyError(
    error: unknown,
  ): { currentSlot: number; invalidBefore: number; invalidAfter?: number } | null {
    const message = typeof (error as any)?.message === 'string' ? (error as any).message : String(error);

    // Ogmios uses code 3118 for validity interval failures.
    // We also check the human-readable substring to reduce false positives.
    const isValidityIntervalError =
      message.includes('outside of its validity interval') || message.includes('"code":3118') || message.includes('"code\\":3118');
    if (!isValidityIntervalError) return null;

    const currentSlot = this.extractNumberAfterToken(message, 'currentSlot');
    const invalidBefore = this.extractNumberAfterToken(message, 'invalidBefore');
    const invalidAfter = this.extractNumberAfterToken(message, 'invalidAfter');

    if (currentSlot === null || invalidBefore === null) return null;

    // We only treat "too early" as retryable. "too late" must be handled by the caller.
    if (currentSlot >= invalidBefore) return null;

    return {
      currentSlot,
      invalidBefore,
      invalidAfter: invalidAfter === null ? undefined : invalidAfter,
    };
  }

  private extractNumberAfterToken(message: string, token: string): number | null {
    const match = new RegExp(`${token}[^0-9]*([0-9]+)`).exec(message);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  private parseUnknownInputVisibilityError(error: unknown): { refs: string[] } | null {
    const message = typeof (error as any)?.message === 'string' ? (error as any).message : String(error);
    const isUnknownInputError =
      message.includes('unknown UTxO references as inputs') ||
      message.includes('"code":3117') ||
      message.includes('"code\\":3117');
    if (!isUnknownInputError) return null;

    const refs: string[] = [];
    const refPattern = /"transaction":\{"id":"([0-9a-f]+)"\},"index":([0-9]+)/gi;
    for (const match of message.matchAll(refPattern)) {
      refs.push(`${match[1]}#${match[2]}`);
    }

    return { refs };
  }

  /**
   * Wait for transaction confirmation on-chain.
   * Polls Kupo/Ogmios until the transaction appears in a block.
   */
  private async waitForConfirmation(txHash: string, timeoutMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check if transaction is confirmed via Lucid's awaitTx
        const isConfirmed = await this.lucidService.lucid.awaitTx(txHash, pollInterval);
        if (isConfirmed) {
          this.logger.log(`Transaction ${txHash} confirmed`);
          return true;
        }
      } catch (error) {
        // awaitTx throws if timeout reached, continue polling
        this.logger.debug(`Polling for tx confirmation: ${txHash}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    this.logger.warn(`Transaction ${txHash} confirmation timeout after ${timeoutMs}ms`);
    throw new GrpcInternalException(`Transaction ${txHash} confirmation timeout after ${timeoutMs}ms`);
  }

  private async waitForTxInclusionBlockHeight(
    txHash: string,
    fromPoint: { slot: number; id: string } | 'origin',
    timeoutMs: number = 60000,
  ): Promise<number> {
    const ogmiosEndpoint = this.configService.get<string>('ogmiosEndpoint');
    if (!ogmiosEndpoint) {
      throw new GrpcInternalException('Missing OGMIOS_ENDPOINT for inclusion height lookup');
    }

    try {
      return await queryTransactionInclusionBlockHeight(ogmiosEndpoint, txHash, fromPoint, timeoutMs);
    } catch (error) {
      throw new GrpcInternalException(
        `Failed to resolve exact inclusion height for tx ${txHash} from Ogmios: ${error?.message ?? error}`,
      );
    }
  }
}
