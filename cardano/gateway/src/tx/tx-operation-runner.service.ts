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
  unsignedTx: TxBuilder;
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

export type TxChainLinkPlan = {
  operationName: string;
  unsignedTx: TxBuilder;
  validity: TxValidityPolicy;
  completeOptions?: TxCompleteOptions;
  pendingTreeUpdate?: PendingTreeUpdate;
  syntheticEvents?: GatewayEvent[];
};

export type TxChainLinkResult = TxOperationRunnerResult & {
  walletInputs: UTxO[];
  derivedOutputs: UTxO[];
};

export type TxChainOperationContext = {
  complete(link: TxChainLinkPlan): Promise<TxChainLinkResult>;
};

export type TxChainOperationPlan<T> = {
  operationName: string;
  wallet: TxWalletInstruction;
  /** Register metadata only for the final dependency-ordered link. */
  finalPendingTreeUpdate?: PendingTreeUpdate;
  build: (context: TxChainOperationContext) => Promise<T>;
};

export type TxChainOperationResult<T> = {
  value: T;
  links: TxChainLinkResult[];
};

@Injectable()
export class TxOperationRunnerService {
  private completionChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly lucidService: LucidService,
    private readonly walletContextService: WalletContextService,
    private readonly txEventsService: TxEventsService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
  ) {}

  async run<TExtraResponseFields = Record<string, never>>(
    plan: TxOperationPlan<TExtraResponseFields>,
  ): Promise<TxOperationRunnerResult<TExtraResponseFields>> {
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
      this.txEventsService.register(unsignedTxHash, plan.syntheticEvents);
      if (pendingTreeUpdate?.expectedNewRoot) {
        this.txEventsService.registerByExpectedRoot(pendingTreeUpdate.expectedNewRoot, plan.syntheticEvents);
      }
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
    return this.withCompletionLock(async () => {
      const walletScopeId = this.lucidService.beginWalletSelectionScope();
      const links: Array<{ result: TxChainLinkResult; plan: TxChainLinkPlan }> = [];
      let walletInputs: UTxO[] | undefined;

      try {
        await this.applyWalletInstruction(plan.wallet);
        this.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, plan.operationName);

        const value = await plan.build({
          complete: async (link) => {
            if (walletInputs && plan.wallet.mode === 'refresh_from_address') {
              this.lucidService.selectWalletFromAddress(plan.wallet.address, walletInputs);
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
      this.txEventsService.register(unsignedTxHash, syntheticEvents);
      if (pendingTreeUpdate?.expectedNewRoot) {
        this.txEventsService.registerByExpectedRoot(pendingTreeUpdate.expectedNewRoot, syntheticEvents);
      }
    }
  }

  private async completeWithExplicitWalletSelection<TExtraResponseFields>(
    plan: TxOperationPlan<TExtraResponseFields>,
  ): Promise<CompletedUnsignedTx> {
    const maxAttempts = Math.max(1, plan.completeRetry?.maxAttempts ?? 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const txBuilder = attempt === 1 || !plan.rebuildUnsignedTx ? plan.unsignedTx : await plan.rebuildUnsignedTx();
      const txWithValidity = plan.validity.apply(txBuilder);
      const walletScopeId = this.lucidService.beginWalletSelectionScope();
      try {
        await this.applyWalletInstruction(plan.wallet);
        this.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, plan.operationName);

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
        if (!plan.rebuildUnsignedTx) {
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
      return;
    }

    await wallet.run();
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
