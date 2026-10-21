import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Method } from 'axios';
import { lastValueFrom, map } from 'rxjs';
import { CardanoStakeDistributionDTO } from './dtos/get-cardano-stake-distribution.dto';

// Reads Cardano stake distributions and their certificates from a Mithril
// aggregator.
@Injectable()
export class MithrilService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  // Undefined until Mithril certifies the epoch's distribution, which it does
  // during the following epoch.
  async getCardanoStakeDistributionByEpoch(epoch: number): Promise<CardanoStakeDistributionDTO | undefined> {
    try {
      return await this._request<CardanoStakeDistributionDTO>({
        path: `/artifact/cardano-stake-distribution/epoch/${epoch}`,
        method: 'GET',
      });
    } catch (error) {
      if (error?.response?.status === 404) return undefined;
      throw error;
    }
  }

  // The certificate exactly as the aggregator serves it. Light clients verify
  // these bytes, so they are never re-encoded.
  async getCertificateJsonByHash(hash: string): Promise<string> {
    const certificate = await this._request<unknown>({
      path: `/certificate/${hash}`,
      method: 'GET',
      responseType: 'text',
    });
    if (typeof certificate !== 'string') {
      throw new Error(`Mithril /certificate/${hash} returned a non-text response`);
    }
    return certificate;
  }

  private async _request<T = unknown>(requestData: {
    path: string;
    method: Method;
    responseType?: 'json' | 'text';
  }): Promise<T> {
    const { path, method, responseType = 'json' } = requestData;
    const mithrilEndpoint = this.configService.get<string>('mithrilEndpoint');
    if (!mithrilEndpoint) {
      throw new Error('Mithril endpoint is not configured');
    }
    const response = await lastValueFrom(
      this.httpService
        .request({
          url: `${mithrilEndpoint}${path}`,
          method,
          ...(responseType === 'text' ? { responseType, transformResponse: [(data: unknown) => data] } : {}),
        })
        .pipe(map((res) => res.data)),
    );
    return response as T;
  }
}
