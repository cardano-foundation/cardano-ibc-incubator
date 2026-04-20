import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { HISTORY_SERVICE, HistoryService } from './history.service';
import { resolveProofHeightForCurrentRoot } from './proof-context';

type GatewayLightClientMode = 'mithril' | 'stake-weighted-stability';

export type GatewayReadinessStatus = {
  status: 'ready' | 'not_ready';
  lightClientMode: GatewayLightClientMode;
  liveHostStateTxHash: string | null;
  proofHeight: string | null;
  detail: string;
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

      return {
        status: 'ready',
        lightClientMode,
        liveHostStateTxHash,
        proofHeight: proofHeight.toString(),
        detail: 'Current HostState root is ready for proof serving',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        status: 'not_ready',
        lightClientMode,
        liveHostStateTxHash,
        proofHeight: null,
        detail,
      };
    }
  }

  private getLightClientMode(): GatewayLightClientMode {
    return this.configService.get('cardanoLightClientMode') === 'mithril'
      ? 'mithril'
      : 'stake-weighted-stability';
  }
}
