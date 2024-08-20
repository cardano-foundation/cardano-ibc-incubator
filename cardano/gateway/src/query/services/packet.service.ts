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
  QueryPacketReceiptRequest,
  QueryPacketReceiptResponse,
  QueryUnreceivedPacketsRequest,
  QueryUnreceivedPacketsResponse,
  QueryUnreceivedAcksRequest,
  QueryUnreceivedAcksResponse,
  QueryProofUnreceivedPacketsRequest,
  QueryProofUnreceivedPacketsResponse,
  QueryNextSequenceReceiveRequest,
  QueryNextSequenceReceiveResponse,
} from '@plus/proto-types/build/ibc/core/channel/v1/query';
import { decodePaginationKey, generatePaginationKey, getPaginationParams } from '../../shared/helpers/pagination';
import { AuthToken } from '../../shared/types/auth-token';
import { CHANNEL_ID_PREFIX, CHANNEL_TOKEN_PREFIX } from '../../constant';
import { DbSyncService } from './db-sync.service';
import { ChannelDatum, decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { PaginationKeyDto } from '../dtos/pagination.dto';
import { bytesFromBase64 } from '@plus/proto-types/build/helpers';
import {
  validQueryPacketAcknowledgementParam,
  validQueryPacketAcknowledgementsParam,
  validQueryPacketCommitmentParam,
  validQueryPacketCommitmentsParam,
  validQueryPacketReceiptParam,
  validQueryUnreceivedPacketsParam,
  validQueryUnreceivedAcksParam,
  validQueryProofUnreceivedPacketsParam,
  validQueryNextSequenceReceiveParam,
} from '../helpers/channel.validate';
import { validPagination } from '../helpers/helper';
import { convertHex2String, fromHex, toHex } from '../../shared/helpers/hex';
import { Acknowledgement } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(DbSyncService) private dbService: DbSyncService,
    @Inject(MithrilService) private mithrilService: MithrilService,
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
      channelDatumDecoded.state.packet_acknowledgement.get(BigInt(sequence)) || JSON.stringify({ result: '01' });
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
        channel_id: `${CHANNEL_ID_PREFIX}-${request.channel_id}`,
        /** packet sequence. */
        sequence: seq.toString(),
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
    const packetCommitment = channelDatumDecoded.state.packet_commitment.get(BigInt(sequence));
    // if (!packetCommitment) throw new GrpcNotFoundException("Not found: 'Packet Commitment' not found");

    const proof = await this.dbService.findUtxoByPolicyAndTokenNameAndState(
      minChannelScriptHash,
      channelTokenName,
      channelDatumDecoded.state.channel.state,
    );

    const response: QueryPacketCommitmentResponse = {
      commitment: packetCommitment,
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
        channel_id: `${CHANNEL_ID_PREFIX}-${request.channel_id}`,
        /** packet sequence. */
        sequence: seq.toString(),
        /** embedded data that represents packet state. */
        data: bytesFromBase64(channelDatumDecoded.state.packet_commitment.get(seq)),
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

  // write api service logic api grpc PacketReceiptb with request params QueryPacketReceiptRequest and return Promise QueryPacketReceiptResponse
  async queryPacketReceipt(request: QueryPacketReceiptRequest): Promise<QueryPacketReceiptResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketReceiptParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`, 'QueryPacketReceiptRequest');

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
    const packetReceipt = channelDatumDecoded.state.packet_receipt.has(BigInt(sequence));

    // if (!packetReceipt) throw new GrpcNotFoundException("Not found: 'Packet Receipt' not found");

    const proof = await this.dbService.findUtxoByPolicyAndTokenNameAndState(
      minChannelScriptHash,
      channelTokenName,
      channelDatumDecoded.state.channel.state,
    );

    const response: QueryPacketReceiptResponse = {
      received: !!packetReceipt,
      proof: bytesFromBase64(btoa(`0-${proof.blockNo}/receipts/${proof.txHash}/${proof.index}`)),
      proof_height: {
        revision_number: 0,
        revision_height: proof.blockNo, // TODO
      },
    } as unknown as QueryPacketReceiptResponse;
    return response;
  }

  // write logic service function queryUnreceivedPackets
  async queryUnreceivedPackets(request: QueryUnreceivedPacketsRequest): Promise<QueryUnreceivedPacketsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      packet_commitment_sequences: packetCommitmentSequences,
    } = validQueryUnreceivedPacketsParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, packetCommitmentSequences=${packetCommitmentSequences}`,
      'QueryUnreceivedPacketsRequest',
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
    const packetReceiptSeqs = channelDatumDecoded.state.packet_receipt;
    const sequences = request.packet_commitment_sequences.filter((seq) => !packetReceiptSeqs.has(BigInt(seq)));

    const response: QueryUnreceivedPacketsResponse = {
      /** list of unreceived packet sequences */
      sequences: sequences,
      /** query block height */
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: BigInt(0), // TODO
      },
    } as unknown as QueryUnreceivedPacketsResponse;
    return response;
  }

  async queryUnreceivedAcks(request: QueryUnreceivedAcksRequest): Promise<QueryUnreceivedAcksResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      packet_ack_sequences: packetAcksSequences,
    } = validQueryUnreceivedAcksParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, packetAcksSequences=${packetAcksSequences}`,
      'QueryUnreceivedAcksRequest',
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
    const packetCommitsSeqs = channelDatumDecoded.state.packet_commitment;
    const sequences = packetAcksSequences.filter((seq) => packetCommitsSeqs.has(BigInt(seq)));

    const response: QueryUnreceivedAcksResponse = {
      /** list of unreceived packet sequences */
      sequences: sequences,
      /** query block height */
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: BigInt(0), // TODO
      },
    } as unknown as QueryUnreceivedAcksResponse;
    return response;
  }
  async queryProofUnreceivedPackets(
    request: QueryProofUnreceivedPacketsRequest,
  ): Promise<QueryProofUnreceivedPacketsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      sequence,
      revision_height: revisionHeight,
    } = validQueryProofUnreceivedPacketsParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, sequence=${sequence}, revisionHeight=${revisionHeight}`,
      'QueryProofUnreceivedPacketsRequest',
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
    if (convertHex2String(channelDatumDecoded.port) !== portId) {
      throw new GrpcInvalidArgumentException(
        `Invalid port, found port ${channelDatumDecoded.port} instead of ${portId} in datum`,
      );
    }
    if (channelDatumDecoded.state.packet_receipt.has(sequence)) {
      throw new GrpcInvalidArgumentException(
        `Invalid sequence, sequence ${sequence} already exists in packet_receipt map`,
      );
    }

    const proof = await this.dbService.findUtxoByPolicyAndTokenNameAndState(
      minChannelScriptHash,
      channelTokenName,
      channelDatumDecoded.state.channel.state,
    );
    // if (BigInt(proof.blockNo) > revisionHeight) {
    //   throw new GrpcInvalidArgumentException(
    //     `Invalid proof height, revision height ${revisionHeight} not match with proof height ${proof.blockNo}`,
    //   );
    // }
    const cardanoTxProof = await this.mithrilService.getProofsCardanoTransactionList([proof.txHash]);
    const connectionProof = cardanoTxProof?.certified_transactions[0]?.proof;
    const immutableFiles = await this.dbService.queryListImmutableFileNoByBlockNos([Number(proof.blockNo)]);

    const response: QueryPacketAcknowledgementResponse = {
      proof: fromHex(connectionProof),
      proof_height: {
        revision_number: 0,
        revision_height: Number(immutableFiles[0]),
      },
    } as unknown as QueryPacketAcknowledgementResponse;
    return response;
  }
  async queryNextSequenceReceive(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse> {
    const { channel_id: channelId, port_id: portId } = validQueryNextSequenceReceiveParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryNextSequenceReceiveRequest');

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelUtxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');

    console.dir({ channelDatum }, { depth: 10 });

    const nextSequenceRecv = channelDatum.state.next_sequence_recv;

    const response: QueryNextSequenceReceiveResponse = {
      next_sequence_receive: nextSequenceRecv.toString(),
      proof: bytesFromBase64(btoa(`0-0/nextsequencerecv//0`)),
      proof_height: {
        revision_number: 0,
        revision_height: 0,
      },
    } as unknown as QueryNextSequenceReceiveResponse;
    return response;
  }
  async QueryNextSequenceAck(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse> {
    const { channel_id: channelId, port_id: portId } = validQueryNextSequenceReceiveParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryNextSequenceAckRequest');

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelUtxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    const nextSequenceAck = channelDatum.state.next_sequence_ack;

    const response: QueryNextSequenceReceiveResponse = {
      next_sequence_receive: nextSequenceAck.toString(),
      proof: bytesFromBase64(btoa(`0-0/nextsequenceack//0`)),
      proof_height: {
        revision_number: 0,
        revision_height: 0,
      },
    } as unknown as QueryNextSequenceReceiveResponse;
    return response;
  }
}
