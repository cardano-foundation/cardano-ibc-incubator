import { InjectEntityManager } from '@nestjs/typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { CLIENT_PREFIX } from '../../constant';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { UtxoDto } from '../dtos/utxo.dto';
import { TxDto } from '../dtos/tx.dto';
import {
  HistoryBlock,
  HistoryService,
  HistoryStakeDistributionEntry,
  HistoryTxEvidence,
  HistoryTxRedeemer,
} from './history.service';

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
  block_hash?: string | null;
  slot_no?: string | number | null;
  tx_index?: string | number | null;
};

type BridgeTxEvidenceRow = {
  tx_hash: string;
  block_no: string | number;
  block_hash?: string | null;
  slot_no?: string | number | null;
  tx_index: string | number;
  tx_cbor_hex: string;
  tx_body_cbor_hex: string;
  redeemers_json: HistoryTxRedeemer[] | null;
  host_state_output_index?: string | number | null;
  host_state_datum?: string | null;
  host_state_datum_hash?: string | null;
  host_state_root?: string | null;
  gas_fee?: string | number | null;
  tx_size?: string | number | null;
};

type HistoryBlockRow = {
  number: string | number;
  hash: string;
  prev_hash: string;
  slot: string | number;
  epoch: string | number;
  block_time: string | Date;
  slot_leader?: string | null;
};

type EpochStakeRow = {
  pool_id: string | null;
  active_stake: string | number;
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

  async findLatestBlock(): Promise<HistoryBlock | null> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      ORDER BY number DESC
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query);
    return rows[0] ? this.mapHistoryBlockRow(rows[0]) : null;
  }

  async findBlockByHeight(height: bigint): Promise<HistoryBlock | null> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      WHERE number = $1
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [height.toString()]);
    return rows[0] ? this.mapHistoryBlockRow(rows[0]) : null;
  }

  async findDescendantBlocks(anchorHeight: bigint, limit: number): Promise<HistoryBlock[]> {
    const query = `
      SELECT
        number,
        hash,
        prev_hash,
        slot,
        epoch,
        block_time,
        slot_leader
      FROM block
      WHERE number > $1
      ORDER BY number ASC
      LIMIT $2
    `;
    const rows = await this.entityManager.query(query, [anchorHeight.toString(), limit]);
    return rows.map((row: HistoryBlockRow) => this.mapHistoryBlockRow(row));
  }

  async findEpochStakeDistribution(epoch: number): Promise<HistoryStakeDistributionEntry[]> {
    const queries = [
      `
        SELECT
          pool_id,
          SUM(amount) AS active_stake
        FROM epoch_stake_default
        WHERE active_epoch = $1
          AND pool_id IS NOT NULL
        GROUP BY pool_id
        ORDER BY SUM(amount) DESC
      `,
      `
        SELECT
          pool_id,
          SUM(amount) AS active_stake
        FROM epoch_stake_default
        WHERE epoch = $1
          AND pool_id IS NOT NULL
        GROUP BY pool_id
        ORDER BY SUM(amount) DESC
      `,
    ];

    for (const query of queries) {
      const rows = await this.entityManager.query(query, [epoch]);
      if (rows.length > 0) {
        return rows
          .filter((row: EpochStakeRow) => !!row.pool_id)
          .map((row: EpochStakeRow) => ({
            poolId: row.pool_id!,
            stake: BigInt(row.active_stake),
          }));
      }
    }

    return [];
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
        block_no,
        block_hash,
        slot_no,
        tx_index
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

  async findTransactionEvidenceByHash(hash: string): Promise<HistoryTxEvidence | null> {
    const query = `
      SELECT
        tx_hash,
        block_no,
        block_hash,
        slot_no,
        tx_index,
        encode(tx_cbor, 'hex') AS tx_cbor_hex,
        encode(tx_body_cbor, 'hex') AS tx_body_cbor_hex,
        redeemers_json,
        host_state_output_index,
        host_state_datum,
        host_state_datum_hash,
        host_state_root,
        gas_fee,
        tx_size
      FROM bridge_tx_evidence
      WHERE tx_hash = $1
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [hash.toLowerCase()]);
    return rows[0] ? this.mapTxEvidenceRow(rows[0]) : null;
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

  private mapTxEvidenceRow(row: BridgeTxEvidenceRow): HistoryTxEvidence {
    return {
      txHash: row.tx_hash,
      blockNo: Number(row.block_no),
      blockHash: row.block_hash ?? null,
      slotNo: row.slot_no === undefined || row.slot_no === null ? null : BigInt(row.slot_no),
      txIndex: Number(row.tx_index),
      txCborHex: row.tx_cbor_hex,
      txBodyCborHex: row.tx_body_cbor_hex,
      redeemers: Array.isArray(row.redeemers_json) ? row.redeemers_json : [],
      hostStateOutputIndex:
        row.host_state_output_index === undefined || row.host_state_output_index === null
          ? null
          : Number(row.host_state_output_index),
      hostStateDatum: row.host_state_datum ?? null,
      hostStateDatumHash: row.host_state_datum_hash ?? null,
      hostStateRoot: row.host_state_root ?? null,
      gasFee: row.gas_fee === undefined || row.gas_fee === null ? null : Number(row.gas_fee),
      txSize: row.tx_size === undefined || row.tx_size === null ? null : Number(row.tx_size),
    };
  }

  private mapHistoryBlockRow(row: HistoryBlockRow): HistoryBlock {
    const blockTime = row.block_time instanceof Date ? row.block_time : new Date(row.block_time);
    return {
      height: Number(row.number),
      hash: row.hash,
      prevHash: row.prev_hash,
      slotNo: BigInt(row.slot),
      epochNo: Number(row.epoch),
      timestampUnixNs: BigInt(blockTime.valueOf()) * 1_000_000n,
      slotLeader: row.slot_leader ?? '',
    };
  }
}
