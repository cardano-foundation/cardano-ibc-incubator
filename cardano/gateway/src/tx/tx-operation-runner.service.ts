import { Injectable } from '@nestjs/common';
import { TxBuilder } from '@lucid-evolution/lucid';

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
  pendingTreeUpdate?: PendingTreeUpdate;
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
    const completedUnsignedTx = await this.withCompletionLock(() =>
      this.completeWithExplicitWalletSelection(plan),
    );

    const unsignedTxCbor = completedUnsignedTx.toCBOR();
    const unsignedTxHash = completedUnsignedTx.toHash();
    const unsignedTxBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

    if (plan.pendingTreeUpdate) {
      this.ibcTreePendingUpdatesService.register(unsignedTxHash, plan.pendingTreeUpdate);
    }

    if (plan.syntheticEvents && plan.syntheticEvents.length > 0) {
      this.txEventsService.register(unsignedTxHash, plan.syntheticEvents);
    }

    return {
      unsignedTxHash,
      unsignedTxCbor,
      unsignedTxBytes,
      completedUnsignedTx,
      extraResponseFields: plan.extraResponseFields,
    };
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

  private async completeWithExplicitWalletSelection<TExtraResponseFields>(
    plan: TxOperationPlan<TExtraResponseFields>,
  ): Promise<CompletedUnsignedTx> {
    const maxAttempts = Math.max(1, plan.completeRetry?.maxAttempts ?? 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const txBuilder =
        attempt === 1 || !plan.rebuildUnsignedTx
          ? plan.unsignedTx
          : await plan.rebuildUnsignedTx();
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
        const shouldRetry =
          retryPolicy &&
          attempt < maxAttempts &&
          retryPolicy.isRetryable(error);

        if (!shouldRetry) {
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
