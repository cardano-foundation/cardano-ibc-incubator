import { InjectEntityManager } from '@nestjs/typeorm';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { connect } from 'net';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import { Cbor } from '@harmoniclabs/cbor';
import {
  BlockFetchBlock,
  BlockFetchClient,
  HandshakeAcceptVersion,
  HandshakeProposeVersion,
  MiniProtocol,
  Multiplexer,
  RealPoint,
  VersionData,
  handshakeMessageFromCborObj,
} from '@harmoniclabs/ouroboros-miniprotocols-ts';
import { fromHex } from '@harmoniclabs/uint8array-utils';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { CLIENT_PREFIX } from '../../constant';
import { decodeHostStateDatum } from '../../shared/types/host-state-datum';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { UtxoDto } from '../dtos/utxo.dto';
import { TxDto } from '../dtos/tx.dto';
import { HistoryService, HistoryTxEvidence, HistoryTxRedeemer } from './history.service';

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

@Injectable()
export class YaciHistoryService implements HistoryService {
  private readonly logger = new Logger(YaciHistoryService.name);

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
    if (rows.length > 0) {
      return this.mapTxEvidenceRow(rows[0]);
    }

    const txHistory = await this.findBridgeTxHistoryByHash(hash);
    if (!txHistory?.block_hash || txHistory.slot_no === undefined || txHistory.slot_no === null) {
      return null;
    }

    const txCborHex = await this.fetchTransactionCborHexFromNode(
      txHistory.block_hash,
      BigInt(txHistory.slot_no),
      hash.toLowerCase(),
    );
    const { txBodyCborHex, redeemers } = this.decodeTransactionEvidence(txCborHex);
    const hostStateEvidence = await this.findHostStateEvidenceByTxHash(hash.toLowerCase());

    this.logger.warn(
      `Transaction evidence for ${hash.toLowerCase()} was missing from bridge_tx_evidence; fetched from node using bridge_tx_history metadata`,
    );

    return {
      txHash: hash.toLowerCase(),
      blockNo: Number(txHistory.block_no),
      blockHash: txHistory.block_hash,
      slotNo: BigInt(txHistory.slot_no),
      txIndex: Number(txHistory.tx_index ?? 0),
      txCborHex,
      txBodyCborHex,
      redeemers,
      hostStateOutputIndex: hostStateEvidence.hostStateOutputIndex,
      hostStateDatum: hostStateEvidence.hostStateDatum,
      hostStateDatumHash: hostStateEvidence.hostStateDatumHash,
      hostStateRoot: hostStateEvidence.hostStateRoot,
      gasFee: txHistory.gas_fee === undefined || txHistory.gas_fee === null ? null : Number(txHistory.gas_fee),
      txSize: txHistory.tx_size === undefined || txHistory.tx_size === null ? null : Number(txHistory.tx_size),
    };
  }

  private async findBridgeTxHistoryByHash(hash: string): Promise<BridgeTxHistoryRow | null> {
    const query = `
      SELECT
        tx_hash,
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
    return rows[0] ?? null;
  }

  private async findHostStateEvidenceByTxHash(txHash: string): Promise<{
    hostStateOutputIndex: number | null;
    hostStateDatum: string | null;
    hostStateDatumHash: string | null;
    hostStateRoot: string | null;
  }> {
    const deploymentConfig = this.configService.get('deployment');
    const hostStateNFT = deploymentConfig.hostStateNFT;
    const query = `
      SELECT
        output_index,
        datum,
        datum_hash
      FROM bridge_utxo_history
      WHERE tx_hash = $1
        AND assets_policy = $2
        AND assets_name = $3
      ORDER BY output_index ASC
      LIMIT 1
    `;
    const rows = await this.entityManager.query(query, [txHash.toLowerCase(), hostStateNFT.policyId, hostStateNFT.name]);
    if (rows.length === 0) {
      return {
        hostStateOutputIndex: null,
        hostStateDatum: null,
        hostStateDatumHash: null,
        hostStateRoot: null,
      };
    }

    const row = rows[0] as { output_index: string | number; datum?: string | null; datum_hash?: string | null };
    if (!row.datum) {
      return {
        hostStateOutputIndex: Number(row.output_index),
        hostStateDatum: null,
        hostStateDatumHash: row.datum_hash ?? null,
        hostStateRoot: null,
      };
    }

    const hostStateDatum = await decodeHostStateDatum(row.datum, this.lucidService.LucidImporter);
    return {
      hostStateOutputIndex: Number(row.output_index),
      hostStateDatum: row.datum,
      hostStateDatumHash: row.datum_hash ?? null,
      hostStateRoot: hostStateDatum.state.ibc_state_root.toLowerCase(),
    };
  }

  private getCardanoChainHost(): string {
    return process.env.CARDANO_CHAIN_HOST || 'cardano-node';
  }

  private getCardanoChainPort(): number {
    return Number(process.env.CARDANO_CHAIN_PORT || 3001);
  }

  private getCardanoChainNetworkMagic(): number {
    return Number(
      process.env.CARDANO_CHAIN_NETWORK_MAGIC ||
        process.env.CARDANO_NETWORK_MAGIC ||
        this.configService.get('cardanoChainNetworkMagic') ||
        42,
    );
  }

  private async performHandshake(multiplexer: Multiplexer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      multiplexer.on(MiniProtocol.Handshake, (chunk) => {
        try {
          const msg = handshakeMessageFromCborObj(Cbor.parse(chunk));
          if (msg instanceof HandshakeAcceptVersion) {
            multiplexer.clearListeners(MiniProtocol.Handshake);
            resolve();
            return;
          }
          multiplexer.clearListeners(MiniProtocol.Handshake);
          reject(new Error(`Handshake rejected by node: ${JSON.stringify(msg)}`));
        } catch (error) {
          multiplexer.clearListeners(MiniProtocol.Handshake);
          reject(error);
        }
      });

      multiplexer.send(
        new HandshakeProposeVersion({
          versionTable: {
            [14]: new VersionData({
              initiatorOnlyDiffusionMode: false,
              peerSharing: false,
              query: false,
              networkMagic: this.getCardanoChainNetworkMagic(),
            }),
            [13]: new VersionData({
              initiatorOnlyDiffusionMode: false,
              peerSharing: false,
              query: false,
              networkMagic: this.getCardanoChainNetworkMagic(),
            }),
          },
        })
          .toCbor()
          .toBuffer(),
        {
          hasAgency: true,
          protocol: MiniProtocol.Handshake,
        },
      );
    });
  }

  private async fetchBlock(blockHash: string, slot: bigint): Promise<CML.Block> {
    const startPoint = new RealPoint({
      blockHeader: {
        hash: fromHex(blockHash),
        slotNumber: slot,
      },
    });

    const socket = connect({
      host: this.getCardanoChainHost(),
      port: this.getCardanoChainPort(),
      keepAlive: false,
      keepAliveInitialDelay: 0,
      timeout: 1000,
    });

    const multiplexer = new Multiplexer({
      protocolType: 'node-to-node',
      connect: () => socket,
    });

    const closeTransport = () => {
      socket.destroy();
      multiplexer.close({ closeSocket: true });
    };
    socket.on('close', () => multiplexer.close({ closeSocket: true }));
    socket.on('error', () => closeTransport());

    try {
      await this.performHandshake(multiplexer);
      const client = new BlockFetchClient(multiplexer);
      const fetched = await client.request(startPoint);
      client.removeAllListeners();
      client.mplexer.close({ closeSocket: true });
      socket.destroy();

      if (!(fetched instanceof BlockFetchBlock)) {
        throw new Error(`Block ${blockHash} not available from local node`);
      }

      const blockBytes = fetched.getBlockBytes();
      if (!blockBytes) {
        throw new Error(`Block ${blockHash} returned no bytes`);
      }
      return CML.Block.from_cbor_bytes(blockBytes.slice(2));
    } catch (error) {
      closeTransport();
      throw error;
    }
  }

  private findTransactionCbor(block: CML.Block, txHash: string): string {
    const wanted = txHash.toLowerCase();
    const txBodies = block.transaction_bodies();
    const txWitnesses = block.transaction_witness_sets();
    const txAuxData = block.auxiliary_data_set();
    const invalidTransactions = new Set(Array.from(block.invalid_transactions()));

    for (let i = 0; i < txBodies.len(); i += 1) {
      const body = txBodies.get(i) as CML.TransactionBody;
      const computedHash = CML.hash_transaction(body).to_hex().toLowerCase();
      if (computedHash !== wanted) {
        continue;
      }

      const witnessSet = txWitnesses.get(i) as CML.TransactionWitnessSet;
      const auxiliaryData = txAuxData.get(i) as CML.AuxiliaryData | undefined;
      const tx = CML.Transaction.new(body, witnessSet, !invalidTransactions.has(i), auxiliaryData);
      return tx.to_cbor_hex().toLowerCase();
    }

    throw new Error(`Transaction ${txHash} not found in fetched block`);
  }

  private async fetchTransactionCborHexFromNode(blockHash: string, slot: bigint, txHash: string): Promise<string> {
    const block = await this.fetchBlock(blockHash, slot);
    return this.findTransactionCbor(block, txHash);
  }

  private decodeTransactionEvidence(txCborHex: string): { txBodyCborHex: string; redeemers: HistoryTxRedeemer[] } {
    const transaction = CML.Transaction.from_cbor_hex(txCborHex.toLowerCase());
    const txBodyCborHex = transaction.body().to_cbor_hex().toLowerCase();
    const redeemers = transaction.witness_set().redeemers();
    if (!redeemers) {
      return { txBodyCborHex, redeemers: [] };
    }

    const parsedRedeemers: HistoryTxRedeemer[] = [];
    const redeemerMap = redeemers.as_map_redeemer_key_to_redeemer_val();
    const keys = redeemerMap?.keys();
    if (redeemerMap && keys) {
      for (let index = 0; index < keys.len(); index += 1) {
        const key = keys.get(index);
        const value = redeemerMap.get(key);
        if (!value) continue;
        parsedRedeemers.push({
          type: this.redeemerTagToType(key.tag()),
          index: Number(key.index()),
          data: value.data().to_cbor_hex().toLowerCase(),
        });
      }

      return { txBodyCborHex, redeemers: parsedRedeemers };
    }

    const legacyRedeemers = redeemers.as_arr_legacy_redeemer();
    if (!legacyRedeemers) {
      return { txBodyCborHex, redeemers: [] };
    }

    for (let index = 0; index < legacyRedeemers.len(); index += 1) {
      const redeemer = legacyRedeemers.get(index);
      parsedRedeemers.push({
        type: this.redeemerTagToType(redeemer.tag()),
        index: Number(redeemer.index()),
        data: redeemer.data().to_cbor_hex().toLowerCase(),
      });
    }

    return { txBodyCborHex, redeemers: parsedRedeemers };
  }

  private redeemerTagToType(tag: number): string {
    switch (tag) {
      case CML.RedeemerTag.Mint:
        return 'mint';
      case CML.RedeemerTag.Spend:
        return 'spend';
      default:
        return `tag_${tag}`;
    }
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
}
