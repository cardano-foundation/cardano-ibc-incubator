import { InjectEntityManager } from '@nestjs/typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { CLIENT_PREFIX } from '../../constant';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { UtxoDto } from '../dtos/utxo.dto';
import { TxDto } from '../dtos/tx.dto';
import { HistoryService } from './history.service';

type BridgeUtxoHistoryRow = {
  address: string;
  tx_hash: string;
  tx_id?: string | number;
  output_index: string | number;
  datum?: string | null;
  datum_hash?: string | null;
  assets_policy: string;
  assets_name: string;
  block_no: string | number;
  block_id?: string | number;
};

type BridgeTxHistoryRow = {
  tx_hash: string;
  tx_id?: string | number;
  gas_fee: string | number;
  tx_size: string | number;
  block_no: string | number;
};

@Injectable()
export class YaciHistoryService implements HistoryService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(LucidService) private readonly lucidService: LucidService,
    @InjectEntityManager('history') private readonly entityManager: EntityManager,
  ) {}

  async findUtxosByPolicyIdAndPrefixTokenName(policyId: string, prefixTokenName: string): Promise<UtxoDto[]> {
    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE assets_policy = $1
        AND position(lower($2) in lower(assets_name)) > 0
      ORDER BY block_no DESC, COALESCE(tx_index, 0) DESC, output_index DESC
    `;
    const rows = await this.entityManager.query(query, [policyId, prefixTokenName]);
    return rows.map((row: BridgeUtxoHistoryRow) => this.mapUtxoRow(row));
  }

  async findUtxosByBlockNo(height: number): Promise<UtxoDto[]> {
    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE block_no = $1
      ORDER BY output_index ASC
    `;
    const rows = await this.entityManager.query(query, [height]);
    return rows.map((row: BridgeUtxoHistoryRow) => this.mapUtxoRow(row));
  }

  async findHostStateUtxoAtOrBeforeBlockNo(height: bigint): Promise<UtxoDto> {
    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE block_no <= $1
        AND assets_policy = $2
        AND assets_name = $3
      ORDER BY block_no DESC, COALESCE(tx_index, 0) DESC, output_index DESC
      LIMIT 1
    `;

    const deploymentConfig = this.configService.get('deployment');
    const hostStateNFT = deploymentConfig.hostStateNFT;
    const rows = await this.entityManager.query(query, [
      height.toString(),
      hostStateNFT.policyId,
      hostStateNFT.name,
    ]);
    if (rows.length <= 0) {
      throw new GrpcNotFoundException(
        `Not found: HostState UTxO not found at or before height ${height.toString()}`,
      );
    }

    return this.mapUtxoRow(rows[0]);
  }

  async findUtxoClientOrAuthHandler(height: number): Promise<UtxoDto[]> {
    const deploymentConfig = this.configService.get('deployment');
    const handlerAuthToken = deploymentConfig.handlerAuthToken;
    const mintClientScriptHash = deploymentConfig.validators.mintClientStt.scriptHash;
    const tokenBase = deploymentConfig.hostStateNFT;
    const clientTokenNamePrefix = this.lucidService.generateTokenName(tokenBase, CLIENT_PREFIX, 0n).slice(0, 40);

    const query = `
      SELECT
        address,
        tx_hash,
        tx_id,
        output_index,
        datum,
        datum_hash,
        assets_policy,
        assets_name,
        block_no,
        block_id
      FROM bridge_utxo_history
      WHERE block_no = $1
        AND (
          assets_policy = $2
          OR (assets_policy = $3 AND lower(assets_name) LIKE lower($4))
        )
      ORDER BY COALESCE(tx_index, 0) ASC, output_index ASC
    `;
    const rows = await this.entityManager.query(query, [
      height,
      handlerAuthToken.policyId,
      mintClientScriptHash,
      `${clientTokenNamePrefix}%`,
    ]);
    return rows.map((row: BridgeUtxoHistoryRow) => this.mapUtxoRow(row));
  }

  async checkExistPoolUpdateByBlockNo(height: number): Promise<boolean> {
    const query = `
      SELECT 1
      FROM bridge_spo_event_history
      WHERE block_no = $1 AND event_type = 'register'
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [height]);
    return rows.length > 0;
  }

  async checkExistPoolRetireByBlockNo(height: number): Promise<boolean> {
    const query = `
      SELECT 1
      FROM bridge_spo_event_history
      WHERE block_no = $1 AND event_type = 'unregister'
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [height]);
    return rows.length > 0;
  }

  async findTxByHash(hash: string): Promise<TxDto> {
    const query = `
      SELECT
        tx_hash,
        id AS tx_id,
        gas_fee,
        tx_size,
        block_no
      FROM bridge_tx_history
      WHERE tx_hash = $1
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [hash.toLowerCase()]);
    if (rows.length <= 0) {
      return null;
    }

    return this.mapTxRow(rows[0]);
  }

  private mapUtxoRow(row: BridgeUtxoHistoryRow): UtxoDto {
    return {
      address: row.address,
      txHash: row.tx_hash,
      txId: row.tx_id === undefined ? 0 : Number(row.tx_id),
      outputIndex: Number(row.output_index),
      datum: row.datum ?? undefined,
      datumHash: row.datum_hash ?? undefined,
      assetsName: row.assets_name,
      assetsPolicy: row.assets_policy,
      blockNo: Number(row.block_no),
      blockId: row.block_id === undefined ? Number(row.block_no) : Number(row.block_id),
    } as UtxoDto;
  }

  private mapTxRow(row: BridgeTxHistoryRow): TxDto {
    return {
      hash: row.tx_hash,
      tx_id: row.tx_id === undefined ? 0 : Number(row.tx_id),
      gas_fee: Number(row.gas_fee),
      tx_size: Number(row.tx_size),
      height: Number(row.block_no),
    };
  }
}
