import { Injectable } from '@nestjs/common';
import { TxBuilder } from '@lucid-evolution/lucid';

import { TRANSACTION_SET_COLLATERAL } from '~@/config/constant.config';

import { IbcTreePendingUpdatesService, PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';

import { GatewayEvent, TxEventsService } from './tx-events.service';
import { WalletContextService } from './wallet-context.service';

type CompletedUnsignedTx = {
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

export type TxOperationPlan<TExtraResponseFields = Record<string, never>> = {
  operationName: string;
  unsignedTx: TxBuilder;
  validity: TxValidityPolicy;
  wallet: TxWalletInstruction;
  completeOptions?: TxCompleteOptions;
  pendingTreeUpdate?: PendingTreeUpdate;
  syntheticEvents?: GatewayEvent[];
  extraResponseFields?: TExtraResponseFields;
};

export type TxOperationRunnerResult<TExtraResponseFields = Record<string, never>> = {
  unsignedTxHash: string;
  unsignedTxCbor: string;
  unsignedTxBytes: Uint8Array;
  extraResponseFields?: TExtraResponseFields;
};

@Injectable()
export class TxOperationRunnerService {
  constructor(
    private readonly walletContextService: WalletContextService,
    private readonly txEventsService: TxEventsService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
  ) {}

  async run<TExtraResponseFields = Record<string, never>>(
    plan: TxOperationPlan<TExtraResponseFields>,
  ): Promise<TxOperationRunnerResult<TExtraResponseFields>> {
    const txWithValidity = plan.validity.apply(plan.unsignedTx);
    await this.applyWalletInstruction(plan.wallet);

    const completedUnsignedTx = (await txWithValidity.complete({
      localUPLCEval: false,
      setCollateral: TRANSACTION_SET_COLLATERAL,
      ...(plan.completeOptions || {}),
    })) as CompletedUnsignedTx;

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
      extraResponseFields: plan.extraResponseFields,
    };
  }

  private async applyWalletInstruction(wallet: TxWalletInstruction): Promise<void> {
    if (wallet.mode === 'refresh_from_address') {
      await this.walletContextService.selectWalletFromAddressWithRetry(wallet.address, wallet.context);
      return;
    }

    await wallet.run();
  }
}
