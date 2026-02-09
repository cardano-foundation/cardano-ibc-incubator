import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { UtxoDto } from '../dtos/utxo.dto';
import { toHexString } from '../../shared/helpers/hex';
import { ConnectionDatum, decodeConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { ChannelDatum, decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { CLIENT_PREFIX } from '../../constant';
import { BlockDto } from '../dtos/block.dto';
import { EpochParamDto } from '../dtos/epoch-param.dto';
import { RedeemerDto } from '../dtos/redeemer';
import { TxDto } from '../dtos/tx.dto';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';

@Injectable()
export class DbSyncService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @InjectEntityManager('dbsync') private entityManager: EntityManager,
  ) {}

  async findUtxosByPolicyIdAndPrefixTokenName(policyId: string, prefixTokenName: string): Promise<UtxoDto[]> {
    const query = `
      SELECT 
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash, 
        generating_tx.id AS tx_id,
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
        datum.bytes AS datum,
        ma.policy AS assets_policy, 
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        generating_block.id AS block_id
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE ma.policy = $1 AND position($2::bytea in ma.name) > 0
      ORDER BY block_no DESC;
    `;
    const utxos = await this.entityManager.query(query, [`\\x${policyId}`, `\\x${prefixTokenName}`]);
    return utxos.map(
      (e) =>
        <UtxoDto>{
          address: e.address,
          txHash: toHexString(e.tx_hash),
          txId: e.tx_id,
          outputIndex: e.output_index,
          datum: toHexString(e.datum),
          datumHash: toHexString(e.datum_hash),
          assetsName: toHexString(e.assets_name),
          assetsPolicy: toHexString(e.assets_policy),
          blockId: e.block_id,
          blockNo: e.block_no,
        },
    );
  }

  async findUtxosByBlockNo(height: number): Promise<UtxoDto[]> {
    const query = `
      SELECT
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash,
        generating_tx.id AS tx_id,
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
        datum.bytes AS datum,
        ma.policy AS assets_policy, 
        ma.name AS assets_name
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_block.block_no = $1;
    `;

    const results = await this.entityManager.query(query, [height]);
    return results.map(
      (e) =>
        <UtxoDto>{
          address: e.address,
          txHash: toHexString(e.tx_hash),
          txId: e.tx_id,
          outputIndex: e.output_index,
          datum: toHexString(e.datum),
          datumHash: toHexString(e.datum_hash),
          assetsName: toHexString(e.assets_name),
          assetsPolicy: toHexString(e.assets_policy),
        },
    );
  }

  async findHostStateUtxoByBlockNo(height: bigint): Promise<UtxoDto> {
    const hostStateNFT = this.configService.get('deployment').hostStateNFT;

    const query = `
      SELECT
        tx_out.address AS address,
        generating_tx.hash AS tx_hash,
        generating_tx.id AS tx_id,
        tx_out.index AS output_index,
        datum.hash AS datum_hash,
        datum.bytes AS datum,
        ma.policy AS assets_policy,
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        generating_block.id AS block_id
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_block.block_no = $1
        AND ma.policy = $2
        AND ma.name = $3
      ORDER BY tx_out.index DESC
      LIMIT 1;
    `;

    const results = await this.entityManager.query(query, [
      height.toString(),
      `\\x${hostStateNFT.policyId}`,
      `\\x${hostStateNFT.name}`,
    ]);

    if (results.length <= 0) {
      throw new GrpcNotFoundException(`Not found: HostState UTxO not found at height ${height.toString()}`);
    }

    const row = results[0];
    return <UtxoDto>{
      address: row.address,
      txHash: toHexString(row.tx_hash),
      txId: row.tx_id,
      outputIndex: row.output_index,
      datum: toHexString(row.datum),
      datumHash: toHexString(row.datum_hash),
      assetsName: toHexString(row.assets_name),
      assetsPolicy: toHexString(row.assets_policy),
      blockId: row.block_id,
      blockNo: row.block_no,
    };
  }

  async findHostStateUtxoAtOrBeforeBlockNo(height: bigint): Promise<UtxoDto> {
    const hostStateNFT = this.configService.get('deployment').hostStateNFT;

    const query = `
      SELECT
        tx_out.address AS address,
        generating_tx.hash AS tx_hash,
        generating_tx.id AS tx_id,
        tx_out.index AS output_index,
        datum.hash AS datum_hash,
        datum.bytes AS datum,
        ma.policy AS assets_policy,
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        generating_block.id AS block_id
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_block.block_no <= $1
        AND ma.policy = $2
        AND ma.name = $3
      ORDER BY generating_block.block_no DESC, generating_tx.id DESC, tx_out.index DESC
      LIMIT 1;
    `;

    const results = await this.entityManager.query(query, [
      height.toString(),
      `\\x${hostStateNFT.policyId}`,
      `\\x${hostStateNFT.name}`,
    ]);

    if (results.length <= 0) {
      throw new GrpcNotFoundException(
        `Not found: HostState UTxO not found at or before height ${height.toString()}`,
      );
    }

    const row = results[0];
    return <UtxoDto>{
      address: row.address,
      txHash: toHexString(row.tx_hash),
      txId: row.tx_id,
      outputIndex: row.output_index,
      datum: toHexString(row.datum),
      datumHash: toHexString(row.datum_hash),
      assetsName: toHexString(row.assets_name),
      assetsPolicy: toHexString(row.assets_policy),
      blockId: row.block_id,
      blockNo: row.block_no,
    };
  }

  async findUtxoByPolicyAndTokenNameAndState(policyId: string, tokenName: string, state: string): Promise<UtxoDto> {
    const deploymentConfig = this.configService.get('deployment');
    const mintConnScriptHash = deploymentConfig.validators.mintConnectionStt.scriptHash;
    const mintChannelScriptHash = deploymentConfig.validators.mintChannelStt.scriptHash;

    const query = `
    SELECT 
      tx_out.address AS address, 
      generating_tx.hash AS tx_hash, 
      tx_out.index AS output_index, 
      datum.hash AS datum_hash, 
      datum.bytes AS datum,
      ma.policy AS assets_policy, 
      ma.name AS assets_name,
      generating_block.block_no AS block_no,
      tx_out.index AS index
    FROM tx_out
    INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
    INNER JOIN multi_asset ma on mto.ident = ma.id 
    INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
    INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
    INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
    WHERE ma.policy = $1 AND ma.name = $2
    ORDER BY block_no DESC;
  `;
    const utxos = await this.entityManager.query(query, [`\\x${policyId}`, `\\x${tokenName}`]);
    const proofs = await Promise.all(
      utxos
        .map(
          (e) =>
            <UtxoDto>{
              address: e.address,
              txHash: toHexString(e.tx_hash),
              outputIndex: e.output_index,
              datum: toHexString(e.datum),
              datumHash: toHexString(e.datum_hash),
              assetsName: toHexString(e.assets_name),
              assetsPolicy: toHexString(e.assets_policy),
              blockNo: e.block_no,
              index: e.index,
            },
        )
        .map(async (utxo) => {
          switch (utxo.assetsPolicy) {
            case mintConnScriptHash: {
              const datumDecoded: ConnectionDatum = await decodeConnectionDatum(
                utxo.datum!,
                this.lucidService.LucidImporter,
              );
              if (datumDecoded.state.state === state) return utxo;
              break;
            }
            case mintChannelScriptHash: {
              const datumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
              if (datumDecoded.state.channel.state === state) return utxo;
              break;
            }
          }

          return null;
        }),
    );
    const proof = proofs.filter((e) => e);
    return proof.length > 0 ? proof[0] : null;
  }

  async findHeightByTxHash(txHash: string): Promise<number> {
    const query = `
      SELECT
        generating_block.block_no AS height
      FROM tx AS generating_tx
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_tx.hash = $1;
    `;

    const results = await this.entityManager.query(query, [`\\x${txHash}`]);
    return results[0].height;
  }

  async findUtxoClientOrAuthHandler(height: number): Promise<UtxoDto[]> {
    const deploymentConfig = this.configService.get('deployment');
    const handlerAuthToken = deploymentConfig.handlerAuthToken;
    const mintClientScriptHash = deploymentConfig.validators.mintClientStt.scriptHash;
    const tokenBase = deploymentConfig.hostStateNFT;
    const clientTokenNamePrefix = this.lucidService.generateTokenName(tokenBase, CLIENT_PREFIX, 0n).slice(0, 40);

    const query = `
      SELECT 
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash, 
        generating_tx.id AS tx_id, 
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
        datum.bytes AS datum,
        ma.policy AS assets_policy, 
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        tx_out.index AS index
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_block.block_no = $1 AND (ma.policy = $2 OR ma.policy = $3);
    `;
    // ma.policy = ANY($2);
    const utxos = await this.entityManager.query(query, [
      height,
      `\\x${handlerAuthToken.policyId}`,
      `\\x${mintClientScriptHash}`,
      // `\\x${clientTokenName}`,
    ]);

    return utxos
      .map(
        (e) =>
          <UtxoDto>{
            address: e.address,
            txHash: toHexString(e.tx_hash),
            txId: e.tx_id,
            outputIndex: e.output_index,
            datum: toHexString(e.datum),
            datumHash: toHexString(e.datum_hash),
            assetsName: toHexString(e.assets_name),
            assetsPolicy: toHexString(e.assets_policy),
            blockNo: e.block_no,
            index: e.index,
          },
      )
      .filter((utxo) => {
        if ([handlerAuthToken.policyId].includes(utxo.assetsPolicy)) return true;
        if ([mintClientScriptHash].includes(utxo.assetsPolicy) && utxo.assetsName.startsWith(clientTokenNamePrefix))
          return true;

        return false;
      });
  }

  async findBlockByHeight(height: bigint): Promise<BlockDto> {
    // Height semantics:
    // - `height` here refers to db-sync `block_no` (Cardano block number), which we map to IBC
    //   `Height.revision_height` across Gateway/Hermes.
    // - Cardano `slot_no` is returned separately and should not be confused with the IBC height.
    const query =
      'SELECT block_no as height, slot_no as slot, epoch_no as epoch, id, hash, time FROM block WHERE block_no = $1';
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }

    const results = await this.entityManager.query(query, [height.toString()]);
    if (results.length <= 0) {
      throw new GrpcNotFoundException(`Not found: "height" ${height} not found`);
    }

    const blockDto = new BlockDto();
    blockDto.height = Number(results[0].height);
    blockDto.slot = Number(results[0].slot);
    blockDto.epoch = Number(results[0].epoch);
    blockDto.block_id = Number(results[0].id);
    blockDto.hash = toHexString(results[0].hash);
    blockDto.timestamp = new Date(results[0].time + 'Z').valueOf() / 1000; // seconds

    return blockDto;
  }

  async findEpochParamByEpochNo(epochNo: bigint): Promise<EpochParamDto> {
    const query = `SELECT * FROM epoch_param WHERE epoch_no = $1`;
    const results = await this.entityManager.query(query, [epochNo.toString()]);
    if (results.length <= 0) {
      throw new GrpcNotFoundException(`Not found: "epochNo" ${epochNo} not found`);
    }

    const epochParam = new EpochParamDto();
    epochParam.epoch_no = results[0].epoch_no;
    epochParam.nonce = toHexString(results[0].nonce);
    return epochParam;
  }

  async checkExistPoolUpdateByBlockNo(height: number): Promise<boolean> {
    const query = `
    SELECT 
      generating_register.registered_tx_id as registered_tx_id
    FROM block AS generating_block
    INNER JOIN tx AS generating_tx on generating_tx.block_id  = generating_block.id
    INNER JOIN pool_update AS generating_register on generating_register.registered_tx_id = generating_tx.id
    WHERE generating_block.block_no = $1;
    `;
    const results = await this.entityManager.query(query, [height.toString()]);
    return results.length > 0;
  }

  async checkExistPoolRetireByBlockNo(height: number): Promise<boolean> {
    const query = `
    SELECT 
      generating_unregister.announced_tx_id as announced_tx_id
    FROM block AS generating_block
    INNER JOIN tx AS generating_tx on generating_tx.block_id  = generating_block.id
    INNER JOIN pool_retire AS generating_unregister on generating_unregister.announced_tx_id = generating_tx.id
    WHERE generating_block.block_no = $1;
    `;
    const results = await this.entityManager.query(query, [height.toString()]);
    return results.length > 0;
  }

  async getRedeemersByTxIdAndMintScriptOrSpendAddr(
    txId: string,
    mintScriptHash: string,
    spendAddress: string,
  ): Promise<RedeemerDto[]> {
    const query = `
    SELECT distinct rd_data.bytes as redeemer_data, rd.purpose as type, rd.script_hash as mint_script_hash, generating_tx_out.address as spend_address, rd.id as redeemer_id
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = $1 AND (rd.script_hash = $2 OR generating_tx_out.address = $3)`;
    const results = await this.entityManager.query(query, [txId, `\\x${mintScriptHash}`, spendAddress]);
    return results
      .filter((e) => toHexString(e.mint_script_hash) == mintScriptHash || e.spend_address == spendAddress)
      .map(
        (e) =>
          <RedeemerDto>{
            type: e.type,
            data: toHexString(e.redeemer_data),
          },
      );
  }

  async findTxByHash(hash: string): Promise<TxDto> {
    const query = `
    SELECT
      generating_block.block_no AS height,
      generating_tx.id as tx_id,
      generating_tx.hash AS tx_hash,
      generating_tx.fee as gas_fee,
      generating_tx."size" as tx_size
    FROM tx AS generating_tx
    INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
    WHERE generating_tx.hash = $1;`;

    const results = await this.entityManager.query(query, [`\\x${hash}`]);
    return results.length > 0
      ? {
          hash: toHexString(results[0].tx_hash),
          tx_id: results[0].tx_id,
          gas_fee: results[0].gas_fee,
          tx_size: results[0].tx_size,
          height: results[0].height,
        }
      : null;
  }

  async queryLatestBlockNo(): Promise<number> {
    const query = `
    select block_no 
    from block 
    where block_no is not null
    order by block_no desc limit 1 ;
    `;
    const results = await this.entityManager.query(query, []);
    if (results.length <= 0) {
      throw new GrpcNotFoundException(`Not found: No blocks found.`);
    }
    return results.length > 0 ? results[0].block_no : 0;
  }
}
