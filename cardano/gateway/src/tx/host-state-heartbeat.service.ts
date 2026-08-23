import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';

import { TRANSACTION_SET_COLLATERAL, TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import {
  GrpcFailedPreconditionException,
  GrpcInternalException,
  GrpcInvalidArgumentException,
} from '~@/exception/grpc_exceptions';

import { alignTreeWithChain, isTreeAligned } from '../shared/helpers/ibc-state-root';
import { computeLedgerAnchoredValidityWindow } from '../shared/helpers/time';
import { LucidService } from '../shared/modules/lucid/lucid.service';
import { HostStateDatum } from '../shared/types/host-state-datum';
import { HISTORY_SERVICE, HistoryService } from '../query/services/history.service';
import {
  BuildHostStateHeartbeatRequest,
  BuildHostStateHeartbeatResponse,
} from './dto/host-state-heartbeat.dto';
import { TxOperationRunnerService } from './tx-operation-runner.service';

type HeartbeatContext = {
  hostStateUtxo: UTxO;
  hostStateDatum: HostStateDatum;
  currentEpoch: number;
  hostStateEpoch: number;
};

@Injectable()
export class HostStateHeartbeatService {
  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    @Inject(LucidService) private readonly lucidService: LucidService,
    @Inject(HISTORY_SERVICE) private readonly historyService: HistoryService,
    private readonly txOperationRunnerService: TxOperationRunnerService,
  ) {}

  async buildHeartbeat(
    request: BuildHostStateHeartbeatRequest,
  ): Promise<BuildHostStateHeartbeatResponse> {
    if (!request.signer?.trim()) {
      throw new GrpcInvalidArgumentException('HostState heartbeat signer is required');
    }

    const context = await this.resolveHeartbeatContext();
    let signerKeyHash: string | undefined;
    try {
      signerKeyHash = await this.lucidService.getPublicKeyHash(request.signer);
    } catch {
      throw new GrpcInvalidArgumentException(
        'HostState heartbeat signer is not a valid Cardano address',
      );
    }
    if (!signerKeyHash) {
      throw new GrpcInvalidArgumentException(
        'HostState heartbeat signer must use a key payment credential',
      );
    }
    if (signerKeyHash.toLowerCase() !== context.hostStateDatum.deployer.toLowerCase()) {
      throw new GrpcFailedPreconditionException(
        'HostState heartbeat signer does not match the deployment heartbeat authority',
      );
    }

    if (context.hostStateEpoch === context.currentEpoch) {
      this.logger.debug(
        `HostState heartbeat not required: epoch ${context.currentEpoch} already has an anchor`,
      );
      return this.statusResponse(context, false);
    }

    if (context.hostStateDatum.control.shutdown !== 'Active') {
      throw new GrpcFailedPreconditionException(
        'HostState heartbeat is disabled while the bridge is shutting down',
      );
    }

    if (!isTreeAligned(context.hostStateDatum.state.ibc_state_root)) {
      this.logger.warn('IBC tree is not aligned with HostState before heartbeat; rebuilding');
      await alignTreeWithChain();
      if (!isTreeAligned(context.hostStateDatum.state.ibc_state_root)) {
        throw new GrpcFailedPreconditionException(
          'IBC tree could not be aligned with HostState before heartbeat',
        );
      }
    }

    const validity = await this.computeTxValidityWindow();
    const updatedHostStateDatum: HostStateDatum = {
      ...context.hostStateDatum,
      state: {
        ...context.hostStateDatum.state,
        version: context.hostStateDatum.state.version + 1n,
        last_update_time: this.nextUpdateTime(
          context.hostStateDatum.state.last_update_time,
          validity.currentLedgerTime,
        ),
      },
    };

    const encodedHostStateRedeemer = await this.lucidService.encode(
      'Heartbeat',
      'host_state_redeemer',
    );
    const encodedUpdatedHostStateDatum = await this.lucidService.encode(
      updatedHostStateDatum,
      'host_state',
    );
    const unsignedTx = this.lucidService.createUnsignedHostStateHeartbeatTransaction(
      context.hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      signerKeyHash,
    );

    const { unsignedTxBytes } = await this.txOperationRunnerService.run({
      operationName: 'hostStateHeartbeat',
      unsignedTx,
      validity: {
        apply: (builder: TxBuilder) =>
          builder.validFrom(validity.validFromTime).validTo(validity.validToTime),
      },
      wallet: {
        mode: 'refresh_from_address',
        address: request.signer,
        context: 'hostStateHeartbeat',
      },
      completeOptions: {
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      },
      // A heartbeat deliberately leaves the commitment tree unchanged, but
      // submission remains strict and still verifies the confirmed HostState root.
      pendingTreeUpdate: {
        expectedNewRoot: context.hostStateDatum.state.ibc_state_root,
        commit: () => undefined,
      },
    });

    this.logger.log(
      `Built HostState heartbeat from epoch ${context.hostStateEpoch} for current epoch ${context.currentEpoch}`,
    );
    return {
      ...this.statusResponse(context, true),
      unsigned_tx: {
        type_url: '',
        value: unsignedTxBytes,
      },
    };
  }

  private async resolveHeartbeatContext(): Promise<HeartbeatContext> {
    const [hostStateUtxo, latestBlock] = await Promise.all([
      this.lucidService.findUtxoAtHostStateNFT(),
      this.historyService.findLatestBlock(),
    ]);
    if (!latestBlock) {
      throw new GrpcFailedPreconditionException(
        'Cannot evaluate HostState heartbeat before Cardano block history is ready',
      );
    }
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTxO has no inline datum');
    }

    const hostStateEvidence = await this.historyService.findTransactionEvidenceByHash(
      hostStateUtxo.txHash,
    );
    if (!hostStateEvidence) {
      throw new GrpcFailedPreconditionException(
        `HostState transaction ${hostStateUtxo.txHash} is not indexed yet`,
      );
    }
    const hostStateBlock = await this.historyService.findBlockByHeight(
      BigInt(hostStateEvidence.blockNo),
    );
    if (!hostStateBlock) {
      throw new GrpcFailedPreconditionException(
        `Block ${hostStateEvidence.blockNo} for HostState transaction ${hostStateUtxo.txHash} is not indexed yet`,
      );
    }
    if (hostStateBlock.epochNo > latestBlock.epochNo) {
      throw new GrpcFailedPreconditionException(
        `History tip epoch ${latestBlock.epochNo} is behind HostState epoch ${hostStateBlock.epochNo}`,
      );
    }

    return {
      hostStateUtxo,
      hostStateDatum: await this.lucidService.decodeDatum<HostStateDatum>(
        hostStateUtxo.datum,
        'host_state',
      ),
      currentEpoch: latestBlock.epochNo,
      hostStateEpoch: hostStateBlock.epochNo,
    };
  }

  private async computeTxValidityWindow() {
    const ogmiosEndpoint = this.configService.get<string>('ogmiosEndpoint');
    const network = this.configService.get('cardanoNetwork') as Network;
    const slotConfig = this.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[network];
    if (!ogmiosEndpoint || !slotConfig || slotConfig.slotLength <= 0) {
      throw new GrpcInternalException(
        `HostState heartbeat has no valid Ogmios/slot configuration for ${network}`,
      );
    }
    return computeLedgerAnchoredValidityWindow(
      ogmiosEndpoint,
      slotConfig,
      TRANSACTION_TIME_TO_LIVE,
    );
  }

  private nextUpdateTime(previous: bigint, currentLedgerTime: number): bigint {
    const ledgerTime = BigInt(Math.trunc(currentLedgerTime));
    return ledgerTime > previous ? ledgerTime : previous + 1n;
  }

  private statusResponse(
    context: Pick<HeartbeatContext, 'currentEpoch' | 'hostStateEpoch'>,
    heartbeatRequired: boolean,
  ): BuildHostStateHeartbeatResponse {
    return {
      heartbeat_required: heartbeatRequired,
      current_epoch: context.currentEpoch,
      host_state_epoch: context.hostStateEpoch,
    };
  }
}
