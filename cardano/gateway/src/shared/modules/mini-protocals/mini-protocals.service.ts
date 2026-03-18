import { Inject, Injectable, Logger } from '@nestjs/common';
import { HISTORY_SERVICE, HistoryService, HistoryTxEvidence } from '../../../query/services/history.service';

@Injectable()
export class MiniProtocalsService {
  constructor(
    @Inject(HISTORY_SERVICE) private readonly historyService: HistoryService,
    private readonly logger: Logger,
  ) {}

  async fetchTransactionEvidence(txHash: string): Promise<HistoryTxEvidence> {
    const evidence = await this.historyService.findTransactionEvidenceByHash(txHash);
    if (!evidence) {
      this.logger.error(`Historical tx evidence not found for tx ${txHash}`);
      throw new Error(`Historical tx evidence unavailable for tx ${txHash}`);
    }
    return evidence;
  }

  async fetchTransactionCborHex(txHash: string): Promise<string> {
    const evidence = await this.fetchTransactionEvidence(txHash);
    return evidence.txCborHex;
  }

  async fetchTransactionBodyCbor(txHash: string): Promise<Buffer> {
    const evidence = await this.fetchTransactionEvidence(txHash);
    return Buffer.from(evidence.txBodyCborHex, 'hex');
  }
}
