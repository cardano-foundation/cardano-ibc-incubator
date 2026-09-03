import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Method } from 'axios';
import { lastValueFrom, map } from 'rxjs';
import { CurrentEpochSettingsResponseDTO } from './dtos/get-current-epoch-settings.dto';
import { CertificateDTO } from './dtos/get-most-recent-certificates.dto';
import { RegisterdSignersResponseDTO } from './dtos/get-registerd-signers-for-epoch.dto';
import { CertificateDetailDTO } from './dtos/get-certificate-by-hash.dto';
import { SnapshotDTO } from './dtos/get-most-recent-snapshots.dto';
import { CardanoTransactionSetSnapshotDTO } from './dtos/get-most-recent-cardano-transactions.dto';
import { MithrilStakeDistributionDTO } from './dtos/get-most-recent-mithril-stake-distributions.dto';

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
    const certificates = await this._request<unknown>({
      path: '/certificates',
      method: 'GET',
    });

    return this.expectArray(certificates, '/certificates').map(
      (certificate) => certificate as CertificateDTO,
    );
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
    const snapshots = await this._request<unknown>({
      path: '/artifact/snapshots',
      method: 'GET',
    });

    return this.expectArray(snapshots, '/artifact/snapshots').map(
      (snapshot) => snapshot as SnapshotDTO,
    );
  }

  async getCardanoTransactionsSetSnapshot(): Promise<CardanoTransactionSetSnapshotDTO[]> {
    const cardanoTransactions = await this._request<unknown>({
      path: '/artifact/cardano-transactions',
      method: 'GET',
    });

    return this.expectArray(cardanoTransactions, '/artifact/cardano-transactions').map(
      (tx) => tx as CardanoTransactionSetSnapshotDTO,
    );
  }

  async getMostRecentMithrilStakeDistributions(): Promise<MithrilStakeDistributionDTO[]> {
    const stakeDistributions = await this._request<unknown>({
      path: '/artifact/mithril-stake-distributions',
      method: 'GET',
    });

    return this.expectArray(stakeDistributions, '/artifact/mithril-stake-distributions').map(
      (stakeDistribution) => stakeDistribution as MithrilStakeDistributionDTO,
    );
  }

  async getProofsCardanoTransactionList(transactionHashes: string[]): Promise<unknown> {
    const proofs = await this._request({
      path: '/proof/cardano-transaction',
      method: 'GET',
      params: {
        transaction_hashes: transactionHashes.join(','),
      },
    });

    return proofs;
  }

  private expectArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
      throw new Error(`Mithril ${path} returned a non-array response`);
    }
    return value;
  }

  private async _request<T = unknown>(requestData: {
    path: string;
    payload?: unknown;
    params?: Record<string, unknown>;
    method: Method;
  }): Promise<T> {
    const { path, payload = {}, params = {}, method = 'POST' } = requestData;
    const mithrilEndpoint = this.configService.get<string>('mithrilEndpoint');
    if (!mithrilEndpoint) {
      throw new Error('Mithril endpoint is not configured');
    }
    const pathUrl = `${mithrilEndpoint}${path}`;
    const response = await lastValueFrom(
      this.httpService
        .request({
          url: pathUrl,
          method,
          data: payload,
          params,
        })
        .pipe(map((res) => res.data)),
    );
    return response as T;
  }
}
