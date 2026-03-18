import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { lastValueFrom } from 'rxjs';
import { Transaction } from '@dcspark/cardano-multiplatform-lib-nodejs';

@Injectable()
export class MiniProtocalsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly logger: Logger,
  ) {}

  async fetchTransactionCborHex(txHash: string): Promise<string> {
    const txCborApiUrl = this.configService.get<string>('blockfrostApiUrl')?.trim();
    const txCborApiKey = this.configService.get<string>('blockfrostProjectId')?.trim();

    if (!txCborApiUrl) {
      throw new Error(
        'Missing BLOCKFROST_API_URL. Configure a transaction CBOR API for Cardano header assembly.',
      );
    }

    const normalizedBaseUrl = txCborApiUrl.replace(/\/+$/, '');
    const requestUrl = `${normalizedBaseUrl}/txs/${txHash}/cbor`;
    const headers: Record<string, string> = {};
    if (txCborApiKey) {
      headers.project_id = txCborApiKey;
    }

    const response = await lastValueFrom<AxiosResponse<ArrayBuffer>>(
      this.httpService.get<ArrayBuffer>(requestUrl, {
        headers,
        responseType: 'arraybuffer',
      }),
    );

    const responseBuffer = Buffer.from(new Uint8Array(response.data ?? new ArrayBuffer(0)));
    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();

    if (contentType.includes('application/octet-stream')) {
      if (responseBuffer.length === 0) {
        this.logger.error(`Transaction CBOR API returned an empty binary body for tx ${txHash}`);
        throw new Error(`Transaction CBOR unavailable for tx ${txHash}`);
      }
      return responseBuffer.toString('hex');
    }

    if (contentType.includes('application/json') || contentType.includes('text/json')) {
      const parsed = JSON.parse(responseBuffer.toString('utf8'));
      const fullTxCborHex = parsed?.cbor ?? parsed?.cborHex;
      if (typeof fullTxCborHex === 'string' && fullTxCborHex.length > 0) {
        return fullTxCborHex;
      }
    }

    const rawText = responseBuffer.toString('utf8').trim();
    if (/^[0-9a-fA-F]+$/.test(rawText) && rawText.length > 0) {
      return rawText;
    }

    this.logger.error(`Transaction CBOR API returned an unsupported response for tx ${txHash}`);
    throw new Error(`Transaction CBOR unavailable for tx ${txHash}`);
  }

  async fetchTransactionBodyCbor(txHash: string): Promise<Buffer> {
    const fullTxCborHex = await this.fetchTransactionCborHex(txHash);
    const tx = Transaction.from_cbor_hex(fullTxCborHex);
    return Buffer.from(tx.body().to_cbor_hex(), 'hex');
  }
}
