import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Method } from 'axios';
import { lastValueFrom, map } from 'rxjs';
import http from 'node:http';
import https from 'node:https';
import { CurrentEpochSettingsResponseDTO } from './dtos/get-current-epoch-settings.dto';
import { CertificateDTO } from './dtos/get-most-recent-certificates.dto';
import { RegisterdSignersResponseDTO } from './dtos/get-registerd-signers-for-epoch.dto';
import { CertificateDetailDTO } from './dtos/get-certificate-by-hash.dto';
import { SnapshotDTO } from './dtos/get-most-recent-snapshots.dto';
import { CardanoTransactionSetSnapshotDTO } from './dtos/get-most-recent-cardano-transactions.dto';
import { MithrilStakeDistributionDTO } from './dtos/get-most-recent-mithril-stake-distributions.dto';

const MITHRIL_REQUEST_TIMEOUT_MS = 10_000;
const MITHRIL_MAX_ATTEMPTS = 8;
const MITHRIL_BASE_DELAY_MS = 500;
const MITHRIL_MAX_DELAY_MS = 5_000;
const TRANSIENT_MITHRIL_ERROR_MARKERS = [
  'socket hang up',
  'econnreset',
  'econnrefused',
  'etimedout',
  'timeout',
  'timed out',
  'network error',
  'tls',
  'ssl',
  'handshake',
  'temporary',
  'temporarily unavailable',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
  'response aborted',
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientMithrilError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return TRANSIENT_MITHRIL_ERROR_MARKERS.some((marker) => normalized.includes(marker));
};

const HTTP_AGENT = new http.Agent({ keepAlive: false });
const HTTPS_AGENT = new https.Agent({ keepAlive: false });

@Injectable()
export class MithrilService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getCurrentEpochSettings(): Promise<CurrentEpochSettingsResponseDTO> {
    const res = await this._request({
      path: '/epoch-settings',
      method: 'GET',
    });

    return res as CurrentEpochSettingsResponseDTO;
  }

  async getMostRecentCertificates(): Promise<CertificateDTO[]> {
    const certificates = await this._request({
      path: '/certificates',
      method: 'GET',
    });

    return certificates.map((certificate) => certificate as unknown as CertificateDTO);
  }

  async getRegisteredSignersForEpoch(epoch: number): Promise<RegisterdSignersResponseDTO> {
    const signers = await this._request({
      path: `/signers/registered/${epoch}`,
      params: { epoch },
      method: 'GET',
    });

    return signers as unknown as RegisterdSignersResponseDTO;
  }

  async getCertificateByHash(hash: string): Promise<CertificateDetailDTO> {
    const certificate = await this._request({
      path: `/certificate/${hash}`,
      method: 'GET',
    });

    return certificate as unknown as CertificateDetailDTO;
  }

  async getMostRecentSnapshots(): Promise<SnapshotDTO[]> {
    const snapshots = await this._request({
      path: '/artifact/snapshots',
      method: 'GET',
    });

    return snapshots.map((snapshot) => snapshot as unknown as SnapshotDTO);
  }

  async getCardanoTransactionsSetSnapshot(): Promise<CardanoTransactionSetSnapshotDTO[]> {
    const cardanoTransactions = await this._request({
      path: '/artifact/cardano-transactions',
      method: 'GET',
    });

    return cardanoTransactions.map((tx) => tx as unknown as CardanoTransactionSetSnapshotDTO);
  }

  async getMostRecentMithrilStakeDistributions(): Promise<MithrilStakeDistributionDTO[]> {
    const stakeDistributions = await this._request({
      path: '/artifact/mithril-stake-distributions',
      method: 'GET',
    });

    return stakeDistributions.map((stakeDistribution) => stakeDistribution as unknown as MithrilStakeDistributionDTO);
  }

  async getProofsCardanoTransactionList(transactionHashes: string[]): Promise<any> {
    const proofs = await this._request({
      path: '/proof/cardano-transaction',
      method: 'GET',
      params: {
        transaction_hashes: transactionHashes.join(','),
      },
    });

    return proofs;
  }

  private async _request(requestData: { path: string; payload?: any; params?: any; method: Method }): Promise<any> {
    const { path, payload = {}, params = {}, method = 'POST' } = requestData;
    const mithrilEndpoint = this.configService.get('mithrilEndpoint');
    const pathUrl = `${mithrilEndpoint}${path}`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= MITHRIL_MAX_ATTEMPTS; attempt++) {
      try {
        return await lastValueFrom(
          this.httpService
            .request({
              url: pathUrl,
              method,
              data: payload,
              params,
              timeout: MITHRIL_REQUEST_TIMEOUT_MS,
              httpAgent: HTTP_AGENT,
              httpsAgent: HTTPS_AGENT,
              headers: {
                Connection: 'close',
              },
            })
            .pipe(map((res) => res.data)),
        );
      } catch (error) {
        lastError = error;
        if (!isTransientMithrilError(error) || attempt === MITHRIL_MAX_ATTEMPTS) {
          throw error;
        }

        const delayMs = Math.min(MITHRIL_MAX_DELAY_MS, MITHRIL_BASE_DELAY_MS * 2 ** (attempt - 1));
        await sleep(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Mithril request failed for ${path}`);
  }
}
