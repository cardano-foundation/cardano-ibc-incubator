import { PacketInputsBusyError, TxInputReservations } from './tx-input-reservations';
import { HistoricalReadOnlyGuard } from '../security/historical-read-only.guard';
import { Injectable } from '@nestjs/common';
import { TxBuilder, UTxO } from '@lucid-evolution/lucid';

import { TRANSACTION_SET_COLLATERAL } from '~@/config/constant.config';

import { LucidService } from '../shared/modules/lucid/lucid.service';
import { IbcTreePendingUpdatesService, PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';

import { GatewayEvent, TxEventsService } from './tx-events.service';
import { WalletContextService } from './wallet-context.service';

export type CompletedUnsignedTx = {
  toCBOR(): string;
  toHash(): string;
};

export type TxValidityPolicy = {
  apply: (builder: TxBuilder) => TxBuilder;
};

export type TxWalletInstruction =
  | {
      mode: 'refresh_from_address';
      address: string;
      context: string;
    }
  | {
      mode: 'custom_before_complete';
      run: () => Promise<void>;
    };

export type TxCompleteOptions = {
  localUPLCEval?: boolean;
  setCollateral?: bigint;
};

export type TxCompleteRetryPolicy = {
  maxAttempts: number;
  isRetryable: (error: unknown) => boolean;
  getDelayMs: (attempt: number) => number;
  onRetry?: (error: unknown, attempt: number, maxAttempts: number, delayMs: number) => Promise<void> | void;
};

export type TxOperationPlan<TExtraResponseFields = Record<string, never>> = {
  operationName: string;
  /** A factory captures the freshly selected wallet inside the completion lock. */
  unsignedTx: TxBuilder | (() => Promise<TxBuilder> | TxBuilder);
  rebuildUnsignedTx?: () => Promise<TxBuilder> | TxBuilder;
  validity: TxValidityPolicy;
  wallet: TxWalletInstruction;
  completeOptions?: TxCompleteOptions;
  completeRetry?: TxCompleteRetryPolicy;
  pendingTreeUpdate?: PendingTreeUpdate | (() => PendingTreeUpdate | undefined);
  syntheticEvents?: GatewayEvent[];
  extraResponseFields?: TExtraResponseFields;
};

export type TxOperationRunnerResult<TExtraResponseFields = Record<string, never>> = {
  unsignedTxHash: string;
  unsignedTxCbor: string;
  unsignedTxBytes: Uint8Array;
  completedUnsignedTx: CompletedUnsignedTx;
  extraResponseFields?: TExtraResponseFields;
};

type TxChainLinkPlan = {
  operationName: string;
  /** Hermes requires an ordinary signer input even when script inputs fund the transaction. */
  requireWalletInput?: boolean;
  spendingInputs?: UTxO[];
  unsignedTx: TxBuilder;
  validity: TxValidityPolicy;
  completeOptions?: TxCompleteOptions;
  pendingTreeUpdate?: PendingTreeUpdate;
  syntheticEvents?: GatewayEvent[];
};

type TxChainLinkResult = TxOperationRunnerResult & {
  walletInputs: UTxO[];
  derivedOutputs: UTxO[];
};

type TxChainOperationContext = {
  complete(link: TxChainLinkPlan): Promise<TxChainLinkResult>;
};

type TxChainOperationPlan<T> = {
  reservation?: { now: number; expiresAt: number };
  operationName: string;
  wallet: TxWalletInstruction;
  /** Register metadata only for the final dependency-ordered link. */
  finalPendingTreeUpdate?: PendingTreeUpdate;
  build: (context: TxChainOperationContext) => Promise<T>;
};

type TxChainOperationResult<T> = {
  value: T;
  links: TxChainLinkResult[];
};

@Injectable()
export class TxOperationRunnerService {
  private readonly transactionMode = new HistoricalReadOnlyGuard();
  private completionChain: Promise<void> = Promise.resolve();
  private readonly inputReservations = new TxInputReservations();

  constructor(
    private readonly lucidService: LucidService,
    private readonly walletContextService: WalletContextService,
    private readonly txEventsService: TxEventsService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
  ) {}

  async run<TExtraResponseFields = Record<string, never>>(
    plan: TxOperationPlan<TExtraResponseFields>,
  ): Promise<TxOperationRunnerResult<TExtraResponseFields>> {
    this.transactionMode.canActivate();
    const completedUnsignedTx = await this.withCompletionLock(() => this.completeWithExplicitWalletSelection(plan));

    const unsignedTxCbor = completedUnsignedTx.toCBOR();
    const unsignedTxHash = completedUnsignedTx.toHash();
    const unsignedTxBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

    const pendingTreeUpdate =
      typeof plan.pendingTreeUpdate === 'function' ? plan.pendingTreeUpdate() : plan.pendingTreeUpdate;
    if (pendingTreeUpdate) {
      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);
    }

    if (plan.syntheticEvents && plan.syntheticEvents.length > 0) {
      this.txEventsService.register(unsignedTxHash, plan.syntheticEvents, pendingTreeUpdate?.expectedNewRoot);
    }

    return {
      unsignedTxHash,
      unsignedTxCbor,
      unsignedTxBytes,
      completedUnsignedTx,
      extraResponseFields: plan.extraResponseFields,
    };
  }

  async runChain<T>(plan: TxChainOperationPlan<T>): Promise<TxChainOperationResult<T>> {
    this.transactionMode.canActivate();
    return this.withCompletionLock(async () => {
      const walletScopeId = this.lucidService.beginWalletSelectionScope();
      const links: Array<{ result: TxChainLinkResult; plan: TxChainLinkPlan }> = [];
      let walletInputs: UTxO[] | undefined;

      try {
        if (plan.reservation) {
          await this.inputReservations.refresh(plan.reservation.now, (inputs) =>
            this.lucidService.lucid.utxosByOutRef(inputs),
          );
        }
        await this.applyWalletInstruction(plan.wallet);
        this.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, plan.operationName);
        if (plan.reservation && plan.wallet.mode === 'refresh_from_address') {
          const available = this.inputReservations.available(await this.lucidService.lucid.wallet().getUtxos());
          this.lucidService.selectWalletFromAddress(plan.wallet.address, available);
        }

        const value = await plan.build({
          complete: async (link) => {
            if (plan.reservation && link.spendingInputs) this.inputReservations.assertAvailable(link.spendingInputs);
            if (walletInputs && plan.wallet.mode === 'refresh_from_address') {
              this.lucidService.selectWalletFromAddress(plan.wallet.address, walletInputs);
            }
            if (link.requireWalletInput) {
              const available = walletInputs ?? (await this.lucidService.lucid.wallet().getUtxos());
              // Prefer ADA-only inputs to avoid pulling unrelated wallet assets into a stage.
              const funding =
                available.find((utxo) => Object.keys(utxo.assets).every((unit) => unit === 'lovelace')) ?? available[0];
              if (!funding) {
                throw new PacketInputsBusyError(
                  `${link.operationName} requires an ordinary signer wallet input that is not reserved`,
                );
              }
              link.unsignedTx.collectFrom([funding]);
            }
            const txWithValidity = link.validity.apply(link.unsignedTx);
            const [updatedWalletInputs, derivedOutputs, completedUnsignedTx] = await txWithValidity.chain({
              localUPLCEval: false,
              setCollateral: TRANSACTION_SET_COLLATERAL,
              ...(link.completeOptions || {}),
              ...(walletInputs ? { presetWalletInputs: walletInputs } : {}),
            });
            walletInputs = updatedWalletInputs;
            const unsignedTxCbor = completedUnsignedTx.toCBOR();
            const unsignedTxHash = completedUnsignedTx.toHash();
            const result: TxChainLinkResult = {
              unsignedTxHash,
              unsignedTxCbor,
              unsignedTxBytes: new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8')),
              completedUnsignedTx,
              walletInputs: updatedWalletInputs,
              derivedOutputs,
            };
            links.push({ result, plan: link });
            return result;
          },
        });

        if (plan.finalPendingTreeUpdate && links.length === 0) {
          throw new Error(`${plan.operationName} cannot register a final pending update without a transaction`);
        }
        if (plan.reservation) {
          const { CML } = this.lucidService.LucidImporter;
          // Packet operations return one transaction. Do not partially reserve a
          // dependent transaction chain if later construction fails.
          if (links.length !== 1) throw new Error('Input reservations require one packet transaction');
          const result = links[0].result;
          const body = CML.Transaction.from_cbor_hex(result.unsignedTxCbor).body();
          const refs: Pick<UTxO, 'txHash' | 'outputIndex'>[] = [];
          for (const inputs of [body.inputs(), body.collateral_inputs()]) {
            if (!inputs) continue;
            for (let i = 0; i < inputs.len(); i++) {
              refs.push({
                txHash: inputs.get(i).transaction_id().to_hex(),
                outputIndex: Number(inputs.get(i).index()),
              });
            }
          }
          const inputs = await this.lucidService.lucid.utxosByOutRef(refs);
          if (inputs.length !== refs.length)
            throw new Error('Packet inputs changed during construction. Retry from canonical state');
          const referenceList = body.reference_inputs();
          const referenceRefs: Pick<UTxO, 'txHash' | 'outputIndex'>[] = [];
          if (referenceList)
            for (let i = 0; i < referenceList.len(); i++) {
              referenceRefs.push({
                txHash: referenceList.get(i).transaction_id().to_hex(),
                outputIndex: Number(referenceList.get(i).index()),
              });
            }
          const references = referenceRefs.length ? await this.lucidService.lucid.utxosByOutRef(referenceRefs) : [];
          if (references.length !== referenceRefs.length)
            throw new Error('Packet reference inputs changed during construction. Retry from canonical state');
          this.inputReservations.reserve(result.unsignedTxHash, inputs, plan.reservation.expiresAt, references);
        }
        for (const [index, link] of links.entries()) {
          const isFinalLink = index === links.length - 1;
          if (isFinalLink && plan.finalPendingTreeUpdate && link.plan.pendingTreeUpdate) {
            throw new Error(`${plan.operationName} cannot register two pending updates for its final transaction`);
          }
          this.registerCompletedTransaction(
            link.result.unsignedTxHash,
            isFinalLink ? (plan.finalPendingTreeUpdate ?? link.plan.pendingTreeUpdate) : link.plan.pendingTreeUpdate,
            link.plan.syntheticEvents,
          );
        }
        return { value, links: links.map((link) => link.result) };
      } finally {
        this.lucidService.endWalletSelectionScope(walletScopeId);
      }
    });
  }

  private async withCompletionLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.completionChain;
    let release!: () => void;
    this.completionChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private registerCompletedTransaction(
    unsignedTxHash: string,
    pendingTreeUpdate?: PendingTreeUpdate,
    syntheticEvents?: GatewayEvent[],
  ): void {
    if (pendingTreeUpdate) {
      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);
    }
    if (syntheticEvents && syntheticEvents.length > 0) {
      this.txEventsService.register(unsignedTxHash, syntheticEvents, pendingTreeUpdate?.expectedNewRoot);
    }
  }

  private async completeWithExplicitWalletSelection<TExtraResponseFields>(
    plan: TxOperationPlan<TExtraResponseFields>,
  ): Promise<CompletedUnsignedTx> {
    const maxAttempts = Math.max(1, plan.completeRetry?.maxAttempts ?? 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const walletScopeId = this.lucidService.beginWalletSelectionScope();
      try {
        await this.applyWalletInstruction(plan.wallet);
        this.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, plan.operationName);
        const selected = attempt > 1 && plan.rebuildUnsignedTx ? plan.rebuildUnsignedTx : plan.unsignedTx;
        const txBuilder = typeof selected === 'function' ? await selected() : selected;
        const txWithValidity = plan.validity.apply(txBuilder);
        // Lucid newTx() captures its wallet before this serialized refresh.
        txWithValidity.lucidConfig().wallet = this.lucidService.lucid.wallet();

        return (await txWithValidity.complete({
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
          ...(plan.completeOptions || {}),
        })) as CompletedUnsignedTx;
      } catch (error) {
        lastError = error;
        const retryPolicy = plan.completeRetry;
        const shouldRetry = retryPolicy && attempt < maxAttempts && retryPolicy.isRetryable(error);

        if (!shouldRetry) {
          throw error;
        }
        if (!plan.rebuildUnsignedTx && typeof plan.unsignedTx !== 'function') {
          console.warn(
            `[txRunner] ${plan.operationName} retryable failure but no rebuildUnsignedTx callback was provided; not retrying mutable tx builder`,
          );
          throw error;
        }

        const delayMs = Math.max(0, retryPolicy.getDelayMs(attempt));
        await retryPolicy.onRetry?.(error, attempt, maxAttempts, delayMs);
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } finally {
        this.lucidService.endWalletSelectionScope(walletScopeId);
      }
    }

    throw lastError;
  }

  private async applyWalletInstruction(wallet: TxWalletInstruction): Promise<void> {
    if (wallet.mode === 'refresh_from_address') {
      await this.walletContextService.selectWalletFromAddressWithRetry(wallet.address, wallet.context);
      if (this.inputReservations.pending) {
        // Expiry is checked against the ledger clock in runChain. A local
        // wall clock ahead of the ledger must not release a still-valid spend.
        await this.inputReservations.refresh(Number.NEGATIVE_INFINITY, (inputs) =>
          this.lucidService.lucid.utxosByOutRef(inputs),
        );
        const available = this.inputReservations.available(await this.lucidService.lucid.wallet().getUtxos());
        this.lucidService.selectWalletFromAddress(wallet.address, available);
      }
      return;
    }

    await wallet.run();
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
