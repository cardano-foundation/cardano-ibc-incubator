import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom, map } from 'rxjs';
import { Transaction } from '@dcspark/cardano-multiplatform-lib-nodejs';

@Injectable()
export class MiniProtocalsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly logger: Logger,
  ) {}

  async fetchTransactionBodyCbor(txHash: string): Promise<Buffer> {
    const blockfrostApiUrl = this.configService.get<string>('blockfrostApiUrl')?.trim();
    const blockfrostProjectId = this.configService.get<string>('blockfrostProjectId')?.trim();

    if (!blockfrostApiUrl || !blockfrostProjectId) {
      throw new Error(
        'Missing BLOCKFROST_API_URL or BLOCKFROST_PROJECT_ID. Configure a Blockfrost-compatible transaction CBOR API for hosted Cardano header assembly.',
      );
    }

    const normalizedBaseUrl = blockfrostApiUrl.replace(/\/+$/, '');
    const requestUrl = `${normalizedBaseUrl}/txs/${txHash}/cbor`;

    const response = await lastValueFrom(
      this.httpService
        .get(requestUrl, {
          headers: {
            project_id: blockfrostProjectId,
          },
        })
        .pipe(map((res) => res.data)),
    );

    const fullTxCborHex = response?.cbor;
    if (typeof fullTxCborHex !== 'string' || fullTxCborHex.length === 0) {
      this.logger.error(`Transaction CBOR API returned no cbor field for tx ${txHash}`);
      throw new Error(`Transaction CBOR unavailable for tx ${txHash}`);
    }

    const tx = Transaction.from_cbor_hex(fullTxCborHex);
    return Buffer.from(tx.body().to_cbor_hex(), 'hex');
  }
}
