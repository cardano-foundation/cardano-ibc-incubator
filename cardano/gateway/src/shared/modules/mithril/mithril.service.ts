import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Method } from 'axios';
import { catchError, firstValueFrom, lastValueFrom, map } from 'rxjs';
import { CurrentEpochSettingsResponseDTO } from './dtos/get-current-epoch-settings.dto';
import { CertificateDTO } from './dtos/get-most-recent-certificates.dto';
import { RegisterdSignersResponseDTO } from './dtos/get-registerd-signers-for-epoch.dto';
import { CertificateDetailDTO } from './dtos/get-certificate-by-hash.dto';
import { SnapshotDTO } from './dtos/get-most-recent-snapshots.dto';
import { MithrilClient } from '@mithril-dev/mithril-client-wasm';
import { CardanoTransactionSetSnapshotDTO } from './dtos/get-most-recent-cardano-transactions.dto';
import { MithrilStakeDistributionDTO } from './dtos/get-most-recent-mithril-stake-distributions.dto';

@Injectable()
export class MithrilService {
  public mithrilClient: MithrilClient;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.mithrilClient = new MithrilClient(
      this.configService.get('mithrilEndpoint'),
      this.configService.get('mtithrilGenesisVerificationKey'),
      {}
    );
  }

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
    return response;
  }
}
