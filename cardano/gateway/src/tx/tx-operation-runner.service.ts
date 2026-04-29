import { Injectable } from '@nestjs/common';
import { TxBuilder } from '@lucid-evolution/lucid';

import { TRANSACTION_SET_COLLATERAL } from '~@/config/constant.config';

import { LucidService } from '../shared/modules/lucid/lucid.service';
import { isTransientRuntimeProviderError } from '../shared/modules/lucid/lucid.provider';
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

@Injectable()
export class TxOperationRunnerService {
  private static readonly DEFAULT_COMPLETE_MAX_ATTEMPTS = 5;
  private static readonly DEFAULT_COMPLETE_BASE_DELAY_MS = 1000;
  private static readonly DEFAULT_COMPLETE_TIMEOUT_MS = 120_000;
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

    const pendingTreeUpdate =
      typeof plan.pendingTreeUpdate === 'function'
        ? plan.pendingTreeUpdate()
        : plan.pendingTreeUpdate;
    if (pendingTreeUpdate) {
      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);
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
    const retryPolicy = plan.completeRetry ?? this.getDefaultCompleteRetryPolicy(plan.operationName);
    const maxAttempts = Math.max(1, retryPolicy?.maxAttempts ?? 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const txBuilder =
        attempt === 1 || !plan.rebuildUnsignedTx
          ? plan.unsignedTx
          : await plan.rebuildUnsignedTx();
      const txWithValidity = plan.validity.apply(txBuilder);
      const walletScopeId = this.lucidService.beginWalletSelectionScope();
      try {
        console.log(`[txRunner] ${plan.operationName} attempt ${attempt}/${maxAttempts}: applying wallet instruction`);
        await this.applyWalletInstruction(plan.wallet);
        this.lucidService.assertWalletSelectionScopeSatisfied(walletScopeId, plan.operationName);

        console.log(`[txRunner] ${plan.operationName} attempt ${attempt}/${maxAttempts}: starting tx completion`);
        const completedTx = await this.withTimeout(
          txWithValidity.complete({
            localUPLCEval: false,
            setCollateral: TRANSACTION_SET_COLLATERAL,
            ...(plan.completeOptions || {}),
          }),
          TxOperationRunnerService.DEFAULT_COMPLETE_TIMEOUT_MS,
          `${plan.operationName} tx completion`,
        );
        console.log(`[txRunner] ${plan.operationName} attempt ${attempt}/${maxAttempts}: tx completion finished`);

        return completedTx as CompletedUnsignedTx;
      } catch (error) {
        const summary = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
        console.error(`[txRunner] ${plan.operationName} attempt ${attempt}/${maxAttempts}: failure: ${summary}`);
        lastError = error;
        const shouldRetry =
          retryPolicy &&
          attempt < maxAttempts &&
          retryPolicy.isRetryable(error);

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

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private getDefaultCompleteRetryPolicy(operationName: string): TxCompleteRetryPolicy {
    return {
      maxAttempts: TxOperationRunnerService.DEFAULT_COMPLETE_MAX_ATTEMPTS,
      isRetryable: (error) => isTransientRuntimeProviderError(error),
      getDelayMs: (attempt) => {
        const exp = Math.max(0, attempt - 1);
        return Math.round(
          TxOperationRunnerService.DEFAULT_COMPLETE_BASE_DELAY_MS * Math.pow(2, exp),
        );
      },
      onRetry: (error, attempt, maxAttempts, delayMs) => {
        const summary = error instanceof Error ? error.message : String(error);
        console.warn(
          `[${operationName}] transient provider failure while completing tx (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms: ${summary}`,
        );
      },
    };
  }
}
