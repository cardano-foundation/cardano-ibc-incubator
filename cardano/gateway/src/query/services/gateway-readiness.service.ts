import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { HISTORY_SERVICE, HistoryService } from './history.service';
import { resolveProofHeightForCurrentRoot } from './proof-context';
import { getStabilityHeuristicParams } from './stability-scoring';

type GatewayLightClientMode = 'mithril' | 'stake-weighted-stability';
type GatewayReadinessReason =
  | 'ready'
  | 'waiting_for_yaci_history'
  | 'waiting_for_stability'
  | 'history_status_unknown';

export type GatewayHistoryReadinessStatus = {
  backend: 'yaci';
  reason: GatewayReadinessReason;
  latestIndexedBlock: string | null;
  latestIndexedSlot: string | null;
  liveHostStateTxBlock: string | null;
  indexedDescendantDepth: string | null;
  requiredDescendantDepth: string;
  message: string;
};

export type GatewayReadinessStatus = {
  status: 'ready' | 'not_ready';
  reason: GatewayReadinessReason;
  lightClientMode: GatewayLightClientMode;
  liveHostStateTxHash: string | null;
  proofHeight: string | null;
  detail: string;
  cause?: string;
  history: GatewayHistoryReadinessStatus;
};

@Injectable()
export class GatewayReadinessService {
  private readonly logger = new Logger(GatewayReadinessService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly lucidService: LucidService,
    private readonly mithrilService: MithrilService,
    @Inject(HISTORY_SERVICE) private readonly historyService: HistoryService,
  ) {}

  async getReadinessStatus(): Promise<GatewayReadinessStatus> {
    const lightClientMode = this.getLightClientMode();
    let liveHostStateTxHash: string | null = null;

    try {
      const liveHostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
      liveHostStateTxHash = liveHostStateUtxo?.txHash ?? null;

      const proofHeight = await resolveProofHeightForCurrentRoot({
        logger: this.logger,
        lucidService: this.lucidService,
        mithrilService: this.mithrilService,
        historyService: this.historyService,
        context: 'health/ready',
        lightClientMode,
        maxAttempts: 1,
        delayMs: 0,
      });
      const history = await this.buildHistoryReadinessStatus(liveHostStateTxHash, true);

      return {
        status: 'ready',
        reason: 'ready',
        lightClientMode,
        liveHostStateTxHash,
        proofHeight: proofHeight.toString(),
        detail: 'Current HostState root is ready for proof serving',
        history,
      };
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      const history = await this.buildHistoryReadinessStatus(liveHostStateTxHash, false);
      return {
        status: 'not_ready',
        reason: history.reason,
        lightClientMode,
        liveHostStateTxHash,
        proofHeight: null,
        detail: history.reason === 'history_status_unknown' ? cause : history.message,
        cause,
        history,
      };
    }
  }

  private getLightClientMode(): GatewayLightClientMode {
    return this.configService.get('cardanoLightClientMode') === 'mithril'
      ? 'mithril'
      : 'stake-weighted-stability';
  }

  private async buildHistoryReadinessStatus(
    liveHostStateTxHash: string | null,
    proofReady: boolean,
  ): Promise<GatewayHistoryReadinessStatus> {
    const requiredDescendantDepth = getStabilityHeuristicParams().threshold_depth.toString();
    const baseStatus = {
      backend: 'yaci' as const,
      latestIndexedBlock: null,
      latestIndexedSlot: null,
      liveHostStateTxBlock: null,
      indexedDescendantDepth: null,
      requiredDescendantDepth,
    };

    try {
      const latestIndexedBlock = await this.historyService.findLatestBlock();
      if (!latestIndexedBlock) {
        return {
          ...baseStatus,
          reason: 'waiting_for_yaci_history',
          message: 'Yaci history has not indexed any Cardano blocks yet. Keep Yaci running before starting proof-serving flows.',
        };
      }

      const withLatestBlock = {
        ...baseStatus,
        latestIndexedBlock: latestIndexedBlock.height.toString(),
        latestIndexedSlot: latestIndexedBlock.slotNo.toString(),
      };

      if (!liveHostStateTxHash) {
        return {
          ...withLatestBlock,
          reason: 'history_status_unknown',
          message: `Yaci has indexed through block ${latestIndexedBlock.height}, but Gateway could not identify the current HostState tx.`,
        };
      }

      const txEvidence = await this.historyService.findTransactionEvidenceByHash(liveHostStateTxHash);
      const tx = txEvidence ? null : await this.historyService.findTxByHash(liveHostStateTxHash);
      const liveHostStateTxBlock = txEvidence?.blockNo ?? tx?.height ?? null;

      if (liveHostStateTxBlock === null || liveHostStateTxBlock === undefined) {
        return {
          ...withLatestBlock,
          reason: 'waiting_for_yaci_history',
          message:
            `Yaci has indexed through block ${latestIndexedBlock.height}, but has not indexed the current HostState tx ` +
            `${liveHostStateTxHash}. Keep Yaci running until bridge history reaches that transaction.`,
        };
      }

      const indexedDescendantDepth = Math.max(0, latestIndexedBlock.height - liveHostStateTxBlock);
      const withHostStateTx = {
        ...withLatestBlock,
        liveHostStateTxBlock: liveHostStateTxBlock.toString(),
        indexedDescendantDepth: indexedDescendantDepth.toString(),
      };

      if (proofReady) {
        return {
          ...withHostStateTx,
          reason: 'ready',
          message:
            `Yaci has indexed the current HostState tx at block ${liveHostStateTxBlock} and Gateway has accepted ` +
            `it for proof serving.`,
        };
      }

      if (BigInt(indexedDescendantDepth) < BigInt(requiredDescendantDepth)) {
        return {
          ...withHostStateTx,
          reason: 'waiting_for_stability',
          message:
            `Yaci has indexed the current HostState tx at block ${liveHostStateTxBlock}, but only ` +
            `${indexedDescendantDepth} descendant block(s) are indexed; waiting for at least ` +
            `${requiredDescendantDepth} before proof serving can proceed.`,
        };
      }

      return {
        ...withHostStateTx,
        reason: 'waiting_for_stability',
        message:
          `Yaci has indexed the current HostState tx at block ${liveHostStateTxBlock} with ` +
          `${indexedDescendantDepth} descendant block(s), but stake-weighted stability thresholds are not met yet.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...baseStatus,
        reason: 'history_status_unknown',
        message: `Unable to query Yaci history sync status: ${message}`,
      };
    }
  }
}
