import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '../shared/modules/lucid/lucid.service';
import { GrpcInternalException, GrpcInvalidArgumentException } from '../exception/grpc_exceptions';
import { SubmitSignedTxRequest, SubmitSignedTxResponse } from './dto/submit-signed-tx.dto';
import { TxEventsService } from './tx-events.service';
import { HostStateDatum } from '../shared/types/host-state-datum';
import { IbcTreePendingUpdatesService, PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';
import {
  CURRENT_IBC_TREE_CACHE_ID,
  IbcTreeCacheService,
  ibcTreeCacheIdForHeight,
  ibcTreeCacheIdForRoot,
} from '../shared/services/ibc-tree-cache.service';
import { getCurrentTree } from '../shared/helpers/ibc-state-root';
import { HISTORY_SERVICE, HistoryService, HistoryTxEvidence } from '../query/services/history.service';
import { QueryService } from '../query/services/query.service';
import { GatewayEvent } from './tx-events.service';
import { ObserveTxRequest, ObserveTxResponse } from './dto/observe-tx.dto';
import { queryNetworkTipPoint } from '../shared/helpers/time';

const MAX_COMPLETED_OBSERVATIONS = 1024;
const MAX_BACKPRESSURE_RETRIES = 360;
const BACKPRESSURE_RETRY_INTERVAL_MS = 5_000;
const MAX_BACKPRESSURE_RETRY_WINDOW_MS = 30 * 60 * 1000;
const FIRST_LINK_DEPENDENCY_RECONCILIATION_GRACE_MS = 30_000;
const FIRST_LINK_DEPENDENCY_RECONCILIATION_POLL_MS = 2_000;

type ConfirmedHostStateEvidence = {
  root: string;
  datumCborHex: string;
  outputIndex: number;
};

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);
  private readonly observationInFlight = new Map<string, Promise<ObserveTxResponse>>();
  private readonly completedObservations = new Map<string, ObserveTxResponse>();

  constructor(
    private readonly lucidService: LucidService,
    private readonly configService: ConfigService,
    private readonly txEventsService: TxEventsService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
    private readonly ibcTreeCacheService: IbcTreeCacheService,
    @Inject(HISTORY_SERVICE) private readonly historyService: HistoryService,
    private readonly queryService: QueryService,
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

      // Hermes expects the exact tx inclusion height in "revisionNumber-revisionHeight" form.
      // Yaci/bridge history is the runtime history contract in stake-weighted-stability mode,
      // so wait for that backend to index the submitted tx and use its block number.
      const confirmedBlockNo = await this.waitForIndexedConfirmation(txHash);

      const confirmedRoot = await this.applyPendingIbcTreeUpdate(signedTxCbor, txHash, BigInt(confirmedBlockNo));

      let events = this.txEventsService.take(txHash) || this.txEventsService.takeByExpectedRoot(confirmedRoot) || [];
      if (events.length === 0) {
        events = await this.findIndexedIbcEvents(txHash);
      }
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
   * Waits for a transaction Hermes submitted directly through its trusted
   * Cardano node connection, verifies the exact confirmed transaction body,
   * and commits the matching in-memory IBC tree update.
   *
   * The request deliberately contains only the canonical transaction hash;
   * signed transaction bytes are loaded from confirmed chain history and
   * never cross the Hermes-to-Gateway RPC boundary.
   */
  async observeTransaction(request: ObserveTxRequest): Promise<ObserveTxResponse> {
    const txHash = request?.tx_hash;
    if (typeof txHash !== 'string' || !/^[0-9a-f]{64}$/.test(txHash)) {
      throw new GrpcInvalidArgumentException(
        'Invalid argument: "tx_hash" must be a canonical lowercase 32-byte hexadecimal transaction hash',
      );
    }

    const completed = this.completedObservations.get(txHash);
    if (completed) {
      return completed;
    }

    const existing = this.observationInFlight.get(txHash);
    if (existing) {
      return existing;
    }

    const pending = this.ibcTreePendingUpdatesService.peek(txHash);
    if (!pending) {
      throw new GrpcInternalException(
        `Missing exact pending IBC update for tx ${txHash}; refusing to observe a transaction the Gateway did not build`,
      );
    }

    const observation = this.observeTransactionOnce(txHash, pending)
      .then((response) => {
        this.cacheCompletedObservation(txHash, response);
        return response;
      })
      .catch((error) => {
        this.logger.error(`observeTransaction error for ${txHash}: ${error?.message ?? error}`, error?.stack);
        if (error instanceof GrpcInternalException || error instanceof GrpcInvalidArgumentException) {
          throw error;
        }
        throw new GrpcInternalException(`Failed to observe transaction ${txHash}: ${error?.message ?? error}`);
      })
      .finally(() => {
        this.observationInFlight.delete(txHash);
      });

    this.observationInFlight.set(txHash, observation);
    return observation;
  }

  private async observeTransactionOnce(txHash: string, pending: PendingTreeUpdate): Promise<ObserveTxResponse> {
    const evidence = await this.waitForIndexedTransactionEvidence(txHash);
    const confirmedBodyCborHex = this.verifyObservedTransactionEvidence(txHash, evidence);

    if (pending.kind === 'tree_neutral') {
      if (!this.ibcTreePendingUpdatesService.commit(txHash, pending)) {
        throw new GrpcInternalException(
          `Pending tree-neutral update for confirmed tx ${txHash} changed during observation`,
        );
      }
      return { tx_hash: txHash, height: `0-${evidence.blockNo}`, events: [] };
    }

    const confirmedRoot = await this.applyExactPendingIbcTreeUpdate(
      confirmedBodyCborHex,
      txHash,
      BigInt(evidence.blockNo),
      pending,
      evidence,
    );

    let events = this.txEventsService.take(txHash) || this.txEventsService.takeByExpectedRoot(confirmedRoot) || [];
    if (events.length === 0) {
      events = await this.findIndexedIbcEvents(txHash);
    }

    return {
      tx_hash: txHash,
      height: `0-${evidence.blockNo}`,
      events,
    };
  }

  private verifyObservedTransactionEvidence(txHash: string, evidence: HistoryTxEvidence): string {
    if (!evidence || evidence.txHash?.toLowerCase() !== txHash) {
      throw new GrpcInternalException(
        `History returned transaction evidence that does not match requested hash ${txHash}`,
      );
    }
    if (!Number.isSafeInteger(evidence.blockNo) || evidence.blockNo <= 0) {
      throw new GrpcInternalException(`History returned an invalid inclusion height for transaction ${txHash}`);
    }
    if (!this.isNonEmptyHex(evidence.txCborHex)) {
      throw new GrpcInternalException(`History returned invalid transaction CBOR for transaction ${txHash}`);
    }
    if (!this.isNonEmptyHex(evidence.txBodyCborHex)) {
      throw new GrpcInternalException(`History returned invalid transaction-body CBOR for transaction ${txHash}`);
    }

    const canonicalBodyCborHex = this.canonicalizeTransactionBodyCbor(evidence.txBodyCborHex, txHash);
    const bodyFromTransactionCbor = this.extractBodyCborFromHistoryTransactionCbor(evidence.txCborHex, txHash);
    if (bodyFromTransactionCbor !== canonicalBodyCborHex) {
      throw new GrpcInternalException(`History transaction/body CBOR mismatch for transaction ${txHash}`);
    }

    const observedBodyHash = this.computeTransactionBodyHashHex(canonicalBodyCborHex)?.toLowerCase();
    if (observedBodyHash !== txHash) {
      throw new GrpcInternalException(
        `Confirmed transaction body hash mismatch: requested ${txHash}, observed ${observedBodyHash ?? 'unavailable'}`,
      );
    }

    return canonicalBodyCborHex;
  }

  private isNonEmptyHex(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
  }

  private canonicalizeTransactionBodyCbor(txBodyCborHex: string, txHash: string): string {
    try {
      const { CML } = this.lucidService.LucidImporter as any;
      const body = CML.TransactionBody.from_cbor_hex(txBodyCborHex.toLowerCase());
      return body.to_cbor_hex().toLowerCase();
    } catch (error) {
      throw new GrpcInternalException(
        `Failed to decode indexed transaction body for tx ${txHash}: ${error?.message ?? error}`,
      );
    }
  }

  private extractBodyCborFromHistoryTransactionCbor(txCborHex: string, txHash: string): string {
    const normalizedCbor = txCborHex.toLowerCase();
    const { CML } = this.lucidService.LucidImporter as any;

    let transaction: any;
    try {
      transaction = CML.Transaction.from_cbor_hex(normalizedCbor);
    } catch {
      try {
        // Depending on Yaci mode, transaction_cbor contains a TransactionBody
        // directly rather than a complete transaction envelope.
        return CML.TransactionBody.from_cbor_hex(normalizedCbor).to_cbor_hex().toLowerCase();
      } catch (error) {
        throw new GrpcInternalException(
          `Failed to decode indexed transaction evidence for tx ${txHash}: ${error?.message ?? error}`,
        );
      }
    }

    // The body hash does not commit to this wrapper flag. A false flag causes
    // script outputs not to be applied, so never finalize a pending tree update
    // from an explicitly invalid transaction envelope.
    if (transaction.is_valid() !== true) {
      throw new GrpcInternalException(`Confirmed transaction ${txHash} is marked invalid`);
    }
    return transaction.body().to_cbor_hex().toLowerCase();
  }

  private computeTransactionBodyHashHex(txBodyCborHex: string): string | null {
    try {
      const { CML } = this.lucidService.LucidImporter as any;
      const body = CML.TransactionBody.from_cbor_hex(txBodyCborHex);
      if (typeof CML.hash_transaction === 'function') {
        return CML.hash_transaction(body).to_hex();
      }
      return null;
    } catch {
      return null;
    }
  }

  private async applyExactPendingIbcTreeUpdate(
    confirmedBodyCborHex: string,
    txHash: string,
    confirmedBlockNo: bigint,
    pending: PendingTreeUpdate,
    indexedEvidence: HistoryTxEvidence,
  ): Promise<string> {
    const confirmedHostState = await this.readConfirmedHostStateFromBody(confirmedBodyCborHex, txHash);
    const confirmedRoot = confirmedHostState.root;

    if (
      indexedEvidence.hostStateOutputIndex !== undefined &&
      indexedEvidence.hostStateOutputIndex !== null &&
      indexedEvidence.hostStateOutputIndex !== confirmedHostState.outputIndex
    ) {
      throw new GrpcInternalException(
        `Indexed HostState output mismatch for tx ${txHash}: parsed ${confirmedHostState.outputIndex}, indexed ${indexedEvidence.hostStateOutputIndex}`,
      );
    }
    if (
      indexedEvidence.hostStateDatum &&
      indexedEvidence.hostStateDatum.toLowerCase() !== confirmedHostState.datumCborHex
    ) {
      throw new GrpcInternalException(`Indexed HostState datum mismatch for tx ${txHash}`);
    }
    if (indexedEvidence.hostStateRoot && indexedEvidence.hostStateRoot.toLowerCase() !== confirmedRoot) {
      throw new GrpcInternalException(
        `Indexed HostState root mismatch for tx ${txHash}: parsed ${confirmedRoot.substring(0, 16)}..., indexed ${indexedEvidence.hostStateRoot.substring(0, 16)}...`,
      );
    }
    if (confirmedRoot !== pending.expectedNewRoot) {
      throw new GrpcInternalException(
        `Confirmed tx root mismatch for tx ${txHash}: expected ${pending.expectedNewRoot.substring(0, 16)}..., got ${confirmedRoot.substring(0, 16)}...`,
      );
    }

    if (!this.ibcTreePendingUpdatesService.commit(txHash, pending)) {
      throw new GrpcInternalException(`Pending IBC update for confirmed tx ${txHash} changed during finalization`);
    }

    await this.persistIbcTreeUpdate(confirmedRoot, txHash, confirmedBlockNo);
    return confirmedRoot;
  }

  private async readConfirmedHostStateFromBody(
    txBodyCborHex: string,
    txHash: string,
  ): Promise<ConfirmedHostStateEvidence> {
    try {
      const { CML } = this.lucidService.LucidImporter as any;
      const body = CML.TransactionBody.from_cbor_hex(txBodyCborHex);
      const { output, outputIndex } = this.findHostStateOutputInBody(body, txHash);
      const datumOption = output.datum?.();
      const plutusDatum = datumOption?.as_datum?.();
      if (!plutusDatum) {
        throw new Error(`Missing inline HostState datum in confirmed tx ${txHash}`);
      }

      const datumCborHex = plutusDatum.to_cbor_hex().toLowerCase();
      const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(datumCborHex, 'host_state');
      const root = hostStateDatum?.state?.ibc_state_root?.toLowerCase();
      if (typeof root !== 'string' || !/^[0-9a-f]{64}$/.test(root)) {
        throw new Error(`Invalid HostState root in confirmed tx ${txHash}`);
      }

      return { root, datumCborHex, outputIndex };
    } catch (error) {
      throw new GrpcInternalException(
        `Failed to resolve HostState root for tx ${txHash} from the confirmed transaction body: ${error?.message ?? error}`,
      );
    }
  }

  private cacheCompletedObservation(txHash: string, response: ObserveTxResponse): void {
    if (this.completedObservations.size >= MAX_COMPLETED_OBSERVATIONS) {
      const oldest = this.completedObservations.keys().next().value;
      if (oldest) this.completedObservations.delete(oldest);
    }
    this.completedObservations.set(txHash, response);
  }
  private async applyPendingIbcTreeUpdate(
    signedTxCbor: string,
    txHash: string,
    confirmedBlockNo: bigint,
  ): Promise<string> {
    // Tree updates are registered when building unsigned txs and keyed by tx hash.
    // We only commit them after confirmation, to avoid stale in-memory state if submission fails.
    let pending = this.ibcTreePendingUpdatesService.peek(txHash);
    let pendingKey = txHash;
    let pendingWasTakenByRoot = false;
    let confirmedRoot: string | undefined;

    // Best-effort: if hashes don't line up due to encoding/formatting, compute the canonical body hash.
    if (!pending) {
      const fallbackHash = this.computeTxBodyHashHex(signedTxCbor);
      if (fallbackHash && fallbackHash.toLowerCase() !== txHash.toLowerCase()) {
        pending = this.ibcTreePendingUpdatesService.peek(fallbackHash);
        pendingKey = fallbackHash;
      }
    }

    if (pending?.kind === 'tree_neutral') {
      throw new GrpcInternalException(
        `Tree-neutral staged transaction ${txHash} must be submitted by Hermes and finalized through ObserveTx`,
      );
    }

    // Strict fallback: if hash matching fails, resolve the pending update by the resulting
    // confirmed transaction root. This keeps correctness strict (root must match exactly) while handling
    // signer/tooling paths that produce a different tx hash key than we recorded pre-signing.
    if (!pending) {
      confirmedRoot = await this.readConfirmedTxRoot(signedTxCbor, txHash);
      pending = this.ibcTreePendingUpdatesService.takeByExpectedRoot(confirmedRoot);
      if (pending) {
        pendingWasTakenByRoot = true;
        this.logger.warn(
          `Resolved pending IBC update for tx ${txHash} via confirmed-tx root fallback (hash-key lookup missed)`,
        );
      }
    }

    if (!pending) {
      throw new GrpcInternalException(
        `Missing pending IBC update for confirmed tx ${txHash}; refusing to skip state-tree finalization`,
      );
    }

    // Resolve HostState from the exact confirmed transaction.
    // We intentionally do not accept "latest HostState" here because that can
    // mask runtime failures and attach traces to the wrong tx context.
    // Verify the confirmed transaction root matches what we computed when building the tx.
    if (!confirmedRoot) {
      confirmedRoot = await this.readConfirmedTxRoot(signedTxCbor, txHash);
    }

    if (confirmedRoot !== pending.expectedNewRoot) {
      throw new GrpcInternalException(
        `Confirmed tx root mismatch for tx ${txHash}: expected ${pending.expectedNewRoot.substring(0, 16)}..., got ${confirmedRoot.substring(0, 16)}...`,
      );
    }

    if (pendingWasTakenByRoot) {
      pending.commit();
    } else if (!this.ibcTreePendingUpdatesService.commit(pendingKey, pending)) {
      throw new GrpcInternalException(`Pending IBC update for confirmed tx ${txHash} changed during finalization`);
    }

    await this.persistIbcTreeUpdate(confirmedRoot, txHash, confirmedBlockNo);

    return confirmedRoot;
  }

  private async persistIbcTreeUpdate(confirmedRoot: string, txHash: string, confirmedBlockNo: bigint): Promise<void> {
    // Persist the updated tree so restarts don't require scanning all IBC UTxOs.
    if (process.env.IBC_TREE_CACHE_ENABLED === 'false') return;
    try {
      await this.ibcTreeCacheService.saveAliases(getCurrentTree(), [
        CURRENT_IBC_TREE_CACHE_ID,
        ibcTreeCacheIdForRoot(confirmedRoot),
        ibcTreeCacheIdForHeight(confirmedBlockNo),
      ]);
    } catch (error) {
      this.logger.warn(`Failed to persist IBC tree cache after tx ${txHash}: ${error?.message ?? error}`);
    }
  }

  private async findIndexedIbcEvents(txHash: string): Promise<GatewayEvent[]> {
    let clientEvents: GatewayEvent[] = [];
    let packetEvents: GatewayEvent[] = [];
    try {
      clientEvents = (await this.queryService.queryClientEventsByTxHash(txHash)).events;
    } catch (error) {
      this.logger.debug(`No indexed client events found for tx ${txHash}: ${error?.message ?? error}`);
    }
    try {
      const response = await this.queryService.queryPacketEventsByTxHash(txHash);
      packetEvents = response.events.map((event) => ({
        type: event.type,
        attributes: Object.entries(event.attributes).map(([key, value]) => ({
          key,
          value,
        })),
      }));
    } catch (error) {
      this.logger.debug(`No indexed packet events found for tx ${txHash}: ${error?.message ?? error}`);
    }

    const unique = new Map<string, GatewayEvent>();
    for (const event of [...clientEvents, ...packetEvents]) {
      const key = JSON.stringify([event.type, event.attributes]);
      if (!unique.has(key)) unique.set(key, event);
    }
    return [...unique.values()];
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
    const transaction = CML.Transaction.from_cbor_hex(signedTxCbor);
    return this.findHostStateOutputInBody(transaction.body(), txHash).output;
  }

  private findHostStateOutputInBody(body: any, txHash: string): { output: any; outputIndex: number } {
    const { CML } = this.lucidService.LucidImporter as any;
    const hostStateNft = this.configService.get('deployment').hostStateNFT;
    const outputs = body.outputs();
    const policyId = CML.ScriptHash.from_hex(hostStateNft.policyId);
    const tokenName = CML.AssetName.from_hex(hostStateNft.name);
    let found: { output: any; outputIndex: number } | undefined;

    for (let index = 0; index < outputs.len(); index += 1) {
      const output = outputs.get(index);
      const amount = output.amount?.();
      if (!amount?.has_multiassets?.()) {
        continue;
      }

      const quantity = amount.multi_asset?.()?.get?.(policyId, tokenName);
      if (typeof quantity === 'bigint' ? quantity > 0n : quantity !== undefined) {
        if (found) {
          throw new Error(`Confirmed tx ${txHash} contains multiple HostState outputs`);
        }
        found = { output, outputIndex: index };
      }
    }

    if (!found) {
      throw new Error(`Confirmed tx ${txHash} does not contain a HostState output`);
    }
    return found;
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

  /**
   * Submit signed CBOR transaction to Cardano via Lucid/Ogmios.
   */
  private async submitToCardano(
    signedTxCbor: string,
    options: {
      expectedTxHash?: string;
      allowMempoolBackpressure?: boolean;
      allowDependencyBackpressure?: boolean;
      reconcileFirstLinkDependencyFailure?: boolean;
    } = {},
  ): Promise<string> {
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
    const maxTooEarlyRetries = 5;
    const slotLengthMs = 1000; // Devnet + mainnet are 1s slots in Shelley+ eras.
    const retryBackoffMs = 250; // Small cushion to avoid edge-of-slot races.
    let tooEarlyRetries = 0;
    let backpressureRetries = 0;
    let backpressureDeadline: { deadlineMs: number; validityUpperBoundSlot: bigint } | undefined;

    while (true) {
      try {
        // Submit the signed transaction directly using Lucid Evolution's wallet submitTx.
        return await this.lucidService.lucid.wallet().submitTx(signedTxCbor);
      } catch (error) {
        const message = typeof error?.message === 'string' ? error.message : String(error);
        if (
          options.expectedTxHash &&
          (this.isAlreadyAcceptedSubmissionError(message) ||
            (await this.isTransactionAlreadyIndexed(options.expectedTxHash)))
        ) {
          this.logger.warn(`Treating idempotent resubmission of ${options.expectedTxHash} as accepted`);
          return options.expectedTxHash;
        }

        const tooEarly = this.parseTxSubmittedTooEarlyError(error);
        if (tooEarly) {
          const { currentSlot, invalidBefore, invalidAfter } = tooEarly;
          if (typeof invalidAfter === 'number' && currentSlot > invalidAfter) {
            throw new GrpcInternalException(
              `Cardano submission failed after validity upper bound ${invalidAfter}: ${message}`,
            );
          }
          if (tooEarlyRetries >= maxTooEarlyRetries) {
            throw new GrpcInternalException(
              `Cardano submission remained too early after ${maxTooEarlyRetries} retries: ${message}`,
            );
          }

          const waitSlots = Math.max(1, invalidBefore - currentSlot);
          const waitMs = waitSlots * slotLengthMs + retryBackoffMs;
          tooEarlyRetries += 1;
          this.logger.warn(
            `Tx rejected as too early (currentSlot=${currentSlot}, invalidBefore=${invalidBefore}); waiting ${waitMs}ms and retrying (${tooEarlyRetries}/${maxTooEarlyRetries})`,
          );
          await this.waitBeforeSubmissionRetry(waitMs);
          continue;
        }

        const retryableKind = this.chainSubmissionRetryableKind(message);
        const retryAllowed =
          retryableKind === 'mempool'
            ? options.allowMempoolBackpressure
            : retryableKind === 'dependency'
              ? options.allowDependencyBackpressure
              : false;
        if (retryAllowed) {
          backpressureDeadline ??= await this.computeBackpressureDeadline(signedTxCbor);
          const nextAttemptAt = Date.now() + BACKPRESSURE_RETRY_INTERVAL_MS;
          if (backpressureRetries >= MAX_BACKPRESSURE_RETRIES || nextAttemptAt >= backpressureDeadline.deadlineMs) {
            throw new GrpcInternalException(
              `Cardano chained submission backpressure deadline reached before transaction validity upper bound slot ${backpressureDeadline.validityUpperBoundSlot} after ${backpressureRetries} retries: ${message}`,
            );
          }

          backpressureRetries += 1;
          this.logger.warn(
            `Cardano mempool/dependency backpressure for chained transaction; retrying in ${BACKPRESSURE_RETRY_INTERVAL_MS}ms (${backpressureRetries}/${MAX_BACKPRESSURE_RETRIES}): ${message}`,
          );
          await this.waitBeforeSubmissionRetry(BACKPRESSURE_RETRY_INTERVAL_MS);
          continue;
        }

        if (
          retryableKind === 'dependency' &&
          options.allowMempoolBackpressure &&
          !options.allowDependencyBackpressure
        ) {
          let reconciliationFailure = 'exact-hash reconciliation was unavailable';
          if (options.reconcileFirstLinkDependencyFailure && options.expectedTxHash) {
            if (await this.reconcileFirstLinkDependencyFailure(options.expectedTxHash)) {
              return options.expectedTxHash;
            }
            reconciliationFailure = `it was not indexed during the ${FIRST_LINK_DEPENDENCY_RECONCILIATION_GRACE_MS / 1000}-second exact-hash reconciliation grace`;
          }
          throw new GrpcInternalException(
            `First chained transaction has an unknown input; ${reconciliationFailure}; refusing a TTL-long dependency retry because it has no prior in-chain dependency: ${message}`,
          );
        }

        this.logger.error(`Failed to submit to Cardano: ${message}`);
        throw new GrpcInternalException(`Cardano submission failed: ${message}`);
      }
    }
  }

  private chainSubmissionRetryableKind(message: string): 'mempool' | 'dependency' | null {
    const normalized = message.toLowerCase();
    if (
      [
        'mempool is full',
        'mempool full',
        'mempoolfull',
        'mempool capacity',
        'temporarily unavailable',
        'resource exhausted',
      ].some((fragment) => normalized.includes(fragment))
    ) {
      return 'mempool';
    }
    if (
      [
        'unknown output reference',
        'unknownoutputreference',
        'unknown transaction input',
        'badinputsutxo',
        'missing transaction input',
        '"code":3117',
        '"code\\":3117',
      ].some((fragment) => normalized.includes(fragment))
    ) {
      return 'dependency';
    }
    return null;
  }

  private isAlreadyAcceptedSubmissionError(message: string): boolean {
    const normalized = message.toLowerCase();
    return [
      'already in mempool',
      'already submitted',
      'already known',
      'knowntransaction',
      'transaction already exists',
    ].some((fragment) => normalized.includes(fragment));
  }

  private async isTransactionAlreadyIndexed(txHash: string): Promise<boolean> {
    try {
      return Boolean(await this.historyService.findTxByHash(txHash));
    } catch {
      return false;
    }
  }

  private async reconcileFirstLinkDependencyFailure(expectedTxHash: string): Promise<boolean> {
    const deadlineMs = Date.now() + FIRST_LINK_DEPENDENCY_RECONCILIATION_GRACE_MS;
    this.logger.warn(
      `First chained transaction ${expectedTxHash} reported an unknown input; polling its exact hash for up to ${FIRST_LINK_DEPENDENCY_RECONCILIATION_GRACE_MS / 1000} seconds before treating the input as stale`,
    );

    while (Date.now() < deadlineMs) {
      await this.waitBeforeHistoryReconciliationPoll(
        Math.min(FIRST_LINK_DEPENDENCY_RECONCILIATION_POLL_MS, deadlineMs - Date.now()),
      );
      if (await this.isTransactionAlreadyIndexed(expectedTxHash)) {
        this.logger.warn(
          `Treating first chained transaction ${expectedTxHash} as accepted after exact-hash history reconciliation`,
        );
        return true;
      }
    }

    return false;
  }

  private async waitBeforeHistoryReconciliationPoll(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async computeBackpressureDeadline(
    signedTxCbor: string,
  ): Promise<{ deadlineMs: number; validityUpperBoundSlot: bigint }> {
    const { CML, SLOT_CONFIG_NETWORK } = this.lucidService.LucidImporter as any;
    const transaction = CML.Transaction.from_cbor_hex(signedTxCbor);
    const validityUpperBoundSlot = transaction.body().ttl?.();
    if (validityUpperBoundSlot === undefined) {
      throw new GrpcInternalException('Cannot retry chained transaction backpressure without a validity upper bound');
    }

    const ogmiosEndpoint = this.configService.getOrThrow<string>('ogmiosEndpoint');
    const network = this.configService.getOrThrow<string>('cardanoNetwork');
    const slotLength = SLOT_CONFIG_NETWORK?.[network]?.slotLength;
    if (!ogmiosEndpoint || !Number.isFinite(slotLength) || slotLength <= 0) {
      throw new GrpcInternalException(
        'Cannot establish chained submission deadline without Ogmios and Cardano slot configuration',
      );
    }
    const tip = await queryNetworkTipPoint(ogmiosEndpoint);
    const currentSlot = BigInt(tip === 'origin' ? 0 : tip.slot);
    if (validityUpperBoundSlot <= currentSlot) {
      throw new GrpcInternalException(
        `Chained transaction validity upper bound slot ${validityUpperBoundSlot} has expired at node slot ${currentSlot}`,
      );
    }

    const remainingMs = Number(validityUpperBoundSlot - currentSlot) * slotLength;
    return {
      deadlineMs: Date.now() + Math.min(remainingMs, MAX_BACKPRESSURE_RETRY_WINDOW_MS),
      validityUpperBoundSlot,
    };
  }

  private async waitBeforeSubmissionRetry(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
      message.includes('outside of its validity interval') ||
      message.includes('"code":3118') ||
      message.includes('"code\\":3118');
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

  /**
   * Wait for the submitted transaction to be indexed by the configured history backend.
   */
  private async waitForIndexedConfirmation(txHash: string, timeoutMs: number = 180000): Promise<number> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeoutMs) {
      try {
        const indexedTx = await this.historyService.findTxByHash(txHash);
        if (indexedTx?.height) {
          this.logger.log(`Transaction ${txHash} indexed at block ${indexedTx.height}`);
          return indexedTx.height;
        }
      } catch (error) {
        this.logger.debug(`Polling history backend for tx confirmation ${txHash}: ${error?.message ?? error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    this.logger.warn(`Transaction ${txHash} history indexing timeout after ${timeoutMs}ms`);
    throw new GrpcInternalException(`Transaction ${txHash} history indexing timeout after ${timeoutMs}ms`);
  }

  private async waitForIndexedTransactionEvidence(
    txHash: string,
    timeoutMs: number = 180000,
  ): Promise<HistoryTxEvidence> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const evidence = await this.historyService.findTransactionEvidenceByHash(txHash);
        if (evidence) {
          this.logger.log(`Transaction ${txHash} evidence indexed at block ${evidence.blockNo}`);
          return evidence;
        }
      } catch (error) {
        this.logger.debug(`Polling history evidence for tx ${txHash}: ${error?.message ?? error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new GrpcInternalException(`Transaction ${txHash} history evidence indexing timeout after ${timeoutMs}ms`);
  }
}
