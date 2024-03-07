import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import {
  QueryPacketAcknowledgementRequest,
  QueryPacketAcknowledgementResponse,
  QueryPacketAcknowledgementsRequest,
  QueryPacketAcknowledgementsResponse,
  QueryPacketCommitmentRequest,
  QueryPacketCommitmentResponse,
  QueryPacketCommitmentsRequest,
  QueryPacketCommitmentsResponse,
} from '@cosmjs-types/src/ibc/core/channel/v1/query';
import { decodePaginationKey, generatePaginationKey, getPaginationParams } from '../../shared/helpers/pagination';
import { AuthToken } from '../../shared/types/auth-token';
import { CHANNEL_TOKEN_PREFIX } from '../../constant';
import { DbSyncService } from './db-sync.service';
import { ChannelDatum, decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { PaginationKeyDto } from '../dtos/pagination.dto';
import { bytesFromBase64 } from '@cosmjs-types/src/helpers';
import {
  validQueryPacketAcknowledgementParam,
  validQueryPacketAcknowledgementsParam,
  validQueryPacketCommitmentParam,
  validQueryPacketCommitmentsParam,
} from '../helpers/channel.validate';
import { validPagination } from '../helpers/helper';
import { convertHex2String, toHex } from '../../shared/helpers/hex';
import { Acknowledgement } from '../../../cosmjs-types/src/ibc/core/channel/v1/channel';

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(DbSyncService) private dbService: DbSyncService,
  ) {}

  async queryPacketAcknowledgement(
    request: QueryPacketAcknowledgementRequest,
  ): Promise<QueryPacketAcknowledgementResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketAcknowledgementParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`, 'QueryPacketAcknowledgement');

    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
    const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;

    const channelTokenName = this.lucidService.generateTokenName(
      handlerAuthToken,
      CHANNEL_TOKEN_PREFIX,
      BigInt(channelId),
    );

    const channelTokenUnit = minChannelScriptHash + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetAcknowledgement =
      channelDatumDecoded.state.packet_acknowledgement.get(sequence) || JSON.stringify({ result: '01' });
    const ackData = {
      result: Buffer.from('01').toString('base64'),
    } as unknown as Acknowledgement;

    // if (!packetAcknowledgement) throw new GrpcNotFoundException("Not found: 'Packet Acknowledgement' not found");

    const proof = await this.dbService.findUtxoByPolicyAndTokenNameAndState(
      minChannelScriptHash,
      channelTokenName,
      channelDatumDecoded.state.channel.state,
    );

    const response: QueryPacketAcknowledgementResponse = {
      acknowledgement: toHex(Acknowledgement.encode(ackData).finish()),
      proof: bytesFromBase64(btoa(`0-${proof.blockNo}/acks/${proof.txHash}/${proof.index}`)),
      proof_height: {
        revision_number: 0,
        revision_height: proof.blockNo, // TODO
      },
    } as unknown as QueryPacketAcknowledgementResponse;
    return response;
  }

  async queryPacketAcknowledgements(
    request: QueryPacketAcknowledgementsRequest,
  ): Promise<QueryPacketAcknowledgementsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      pagination: paginationReq,
    } = validQueryPacketAcknowledgementsParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryPacketAcknowledgements');
    const pagination = getPaginationParams(validPagination(paginationReq));
    const {
      'pagination.key': key,
      'pagination.limit': limit,
      'pagination.count_total': count_total,
      'pagination.reverse': reverse,
    } = pagination;
    let { 'pagination.offset': offset } = pagination;
    if (key) offset = decodePaginationKey(key);

    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
    const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;

    const channelTokenName = this.lucidService.generateTokenName(
      handlerAuthToken,
      CHANNEL_TOKEN_PREFIX,
      BigInt(channelId),
    );

    const channelTokenUnit = minChannelScriptHash + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetAcknowledgementSeqs = [...channelDatumDecoded.state.packet_acknowledgement.keys()];

    let nextKey = null;
    let packetAckSeqs = reverse ? packetAcknowledgementSeqs.reverse() : packetAcknowledgementSeqs;
    if (packetAckSeqs.length > +limit) {
      const from = parseInt(offset);
      const to = parseInt(offset) + parseInt(limit);
      packetAckSeqs = packetAckSeqs.slice(from, to);

      const pageKeyDto: PaginationKeyDto = {
        offset: to,
      };
      nextKey = to < packetAcknowledgementSeqs.length ? generatePaginationKey(pageKeyDto) : '';
    }

    const response: QueryPacketAcknowledgementsResponse = {
      acknowledgements: packetAckSeqs.map((seq) => ({
        /** channel port identifier. */
        port_id: convertHex2String(channelDatumDecoded.port),
        /** channel unique identifier. */
        channel_id: request.channel_id,
        /** packet sequence. */
        sequence: seq,
        /** embedded data that represents packet state. */
        data: bytesFromBase64(channelDatumDecoded.state.packet_acknowledgement.get(seq)),
      })),
      /** pagination response */
      pagination: {
        next_key: nextKey,
        total: count_total ? packetAckSeqs.length : 0,
      },
      /** query block height */
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: BigInt(0), // TODO
      },
    } as unknown as QueryPacketAcknowledgementsResponse;
    return response;
  }

  async queryPacketCommitment(request: QueryPacketCommitmentRequest): Promise<QueryPacketCommitmentResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketCommitmentParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`,
      'QueryPacketCommitmentRequest',
    );

    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
    const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;

    const channelTokenName = this.lucidService.generateTokenName(
      handlerAuthToken,
      CHANNEL_TOKEN_PREFIX,
      BigInt(channelId),
    );

    const channelTokenUnit = minChannelScriptHash + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetCommitment = channelDatumDecoded.state.packet_commitment.get(sequence) || '';
    // if (!packetCommitment) throw new GrpcNotFoundException("Not found: 'Packet Commitment' not found");

    const proof = await this.dbService.findUtxoByPolicyAndTokenNameAndState(
      minChannelScriptHash,
      channelTokenName,
      channelDatumDecoded.state.channel.state,
    );

    const response: QueryPacketCommitmentResponse = {
      commitment: bytesFromBase64(packetCommitment),
      proof: bytesFromBase64(btoa(`0-${proof.blockNo}/commitments/${proof.txHash}/${proof.index}`)),
      proof_height: {
        revision_number: 0,
        revision_height: proof.blockNo, // TODO
      },
    } as unknown as QueryPacketCommitmentResponse;
    return response;
  }

  async queryPacketCommitments(request: QueryPacketCommitmentsRequest): Promise<QueryPacketCommitmentsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      pagination: paginationReq,
    } = validQueryPacketCommitmentsParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryPacketCommitments');
    const pagination = getPaginationParams(validPagination(paginationReq));
    const {
      'pagination.key': key,
      'pagination.limit': limit,
      'pagination.count_total': count_total,
      'pagination.reverse': reverse,
    } = pagination;
    let { 'pagination.offset': offset } = pagination;
    if (key) offset = decodePaginationKey(key);

    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
    const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;

    const channelTokenName = this.lucidService.generateTokenName(
      handlerAuthToken,
      CHANNEL_TOKEN_PREFIX,
      BigInt(channelId),
    );

    const channelTokenUnit = minChannelScriptHash + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetCommitmentSeqs = [...channelDatumDecoded.state.packet_commitment.keys()];

    let nextKey = null;
    let packetCmmSeqs = reverse ? packetCommitmentSeqs.reverse() : packetCommitmentSeqs;
    if (packetCmmSeqs.length > +limit) {
      const from = parseInt(offset);
      const to = parseInt(offset) + parseInt(limit);
      packetCmmSeqs = packetCmmSeqs.slice(from, to);

      const pageKeyDto: PaginationKeyDto = {
        offset: to,
      };
      nextKey = to < packetCommitmentSeqs.length ? generatePaginationKey(pageKeyDto) : '';
    }

    const response: QueryPacketCommitmentsResponse = {
      commitments: packetCmmSeqs.map((seq) => ({
        /** channel port identifier. */
        port_id: convertHex2String(channelDatumDecoded.port),
        /** channel unique identifier. */
        channel_id: request.channel_id,
        /** packet sequence. */
        sequence: seq,
        /** embedded data that represents packet state. */
        data: bytesFromBase64(channelDatumDecoded.state.packet_acknowledgement.get(seq)),
      })),
      /** pagination response */
      pagination: {
        next_key: nextKey,
        total: count_total ? packetCmmSeqs.length : 0,
      },
      /** query block height */
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: BigInt(0), // TODO
      },
    } as unknown as QueryPacketCommitmentsResponse;
    return response;
  }
}
