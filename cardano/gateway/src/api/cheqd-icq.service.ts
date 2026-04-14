import { Injectable } from '@nestjs/common';
import { ResponseDeliverTx } from '@plus/proto-types/build/ibc/core/types/v1/block';
import { QueryService } from '~@/query/services/query.service';
import { MsgTransferResponse } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { ATTRIBUTE_KEY_PACKET, EVENT_TYPE_PACKET } from '~@/constant/packet';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { PacketService } from '~@/tx/packet.service';
import { Height } from '~@/shared/types/height';
import { ASYNC_ICQ_HOST_PORT } from '@shared/types/apps/async-icq/async-icq';
import {
  buildCheqdAllDidDocVersionsMetadataPacketData,
  buildCheqdDidDocPacketData,
  buildCheqdDidDocVersionPacketData,
  buildCheqdLatestResourceVersionMetadataPacketData,
  buildCheqdLatestResourceVersionPacketData,
  buildCheqdResourceMetadataPacketData,
  buildCheqdResourcePacketData,
  decodeCheqdAcknowledgementByQueryPath,
  decodeCheqdAllDidDocVersionsMetadataAcknowledgement,
  decodeCheqdDidDocAcknowledgement,
  decodeCheqdDidDocVersionAcknowledgement,
  decodeCheqdLatestResourceVersionAcknowledgement,
  decodeCheqdLatestResourceVersionMetadataAcknowledgement,
  decodeCheqdResourceAcknowledgement,
  decodeCheqdResourceMetadataAcknowledgement,
  DecodedCheqdIcqAcknowledgement,
  isSupportedCheqdQueryPath,
} from '@shared/types/apps/async-icq/cheqd-icq';
import {
  CheqdDidDocIcqRequestDto,
  CheqdDidDocVersionIcqRequestDto,
  CheqdIcqBaseRequestDto,
  CheqdIcqResultRequestDto,
  CheqdLatestResourceVersionIcqRequestDto,
  CheqdResourceIcqRequestDto,
} from './cheqd-icq.dto';

type BuiltCheqdIcqTransaction = {
  source_port: typeof ASYNC_ICQ_HOST_PORT;
  source_channel: string;
  query_path: string;
  packet_data_hex: string;
  tx: MsgTransferResponse;
};

type CheqdIcqLookupResult =
  | {
      status: 'pending';
      reason: 'source_tx_not_indexed' | 'pending_acknowledgement';
      tx_hash?: string;
      query_path: string;
      packet_data_hex: string;
      current_height: string;
      next_search_from_height: string;
    }
  | {
      status: 'completed';
      tx_hash?: string;
      query_path: string;
      packet_data_hex: string;
      current_height: string;
      next_search_from_height: string;
      completed_height: string;
      packet_sequence: string | null;
      acknowledgement_hex: string;
      acknowledgement: DecodedCheqdIcqAcknowledgement;
    };

type PacketAcknowledgementMatch = {
  height: bigint;
  packetSequence: string | null;
  acknowledgementHex: string;
};

type SearchStartResult =
  | {
      kind: 'height';
      height: bigint;
    }
  | {
      kind: 'pending';
      response: Extract<CheqdIcqLookupResult, { status: 'pending' }>;
    };

@Injectable()
export class CheqdIcqService {
  constructor(
    private readonly packetService: PacketService,
    private readonly queryService: QueryService,
  ) {}

  async buildDidDocQuery(dto: CheqdDidDocIcqRequestDto): Promise<BuiltCheqdIcqTransaction> {
    const { packetData, queryPath } = buildCheqdDidDocPacketData({ id: dto.id });
    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  async buildDidDocVersionQuery(dto: CheqdDidDocVersionIcqRequestDto): Promise<BuiltCheqdIcqTransaction> {
    const { packetData, queryPath } = buildCheqdDidDocVersionPacketData({
      id: dto.id,
      version: dto.version,
    });
    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  async buildAllDidDocVersionsMetadataQuery(dto: CheqdDidDocIcqRequestDto): Promise<BuiltCheqdIcqTransaction> {
    const { packetData, queryPath } = buildCheqdAllDidDocVersionsMetadataPacketData({ id: dto.id });
    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  async buildResourceQuery(dto: CheqdResourceIcqRequestDto): Promise<BuiltCheqdIcqTransaction> {
    const { packetData, queryPath } = buildCheqdResourcePacketData({
      collection_id: dto.collection_id,
      id: dto.id,
    });
    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  async buildResourceMetadataQuery(dto: CheqdResourceIcqRequestDto): Promise<BuiltCheqdIcqTransaction> {
    const { packetData, queryPath } = buildCheqdResourceMetadataPacketData({
      collection_id: dto.collection_id,
      id: dto.id,
    });
    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  async buildLatestResourceVersionQuery(
    dto: CheqdLatestResourceVersionIcqRequestDto,
  ): Promise<BuiltCheqdIcqTransaction> {
    const { packetData, queryPath } = buildCheqdLatestResourceVersionPacketData({
      collection_id: dto.collection_id,
      name: dto.name,
      resource_type: dto.resource_type,
    });
    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  async buildLatestResourceVersionMetadataQuery(
    dto: CheqdLatestResourceVersionIcqRequestDto,
  ): Promise<BuiltCheqdIcqTransaction> {
    const { packetData, queryPath } = buildCheqdLatestResourceVersionMetadataPacketData({
      collection_id: dto.collection_id,
      name: dto.name,
      resource_type: dto.resource_type,
    });
    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  decodeDidDocAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
    return decodeCheqdDidDocAcknowledgement(ackHex);
  }

  decodeDidDocVersionAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
    return decodeCheqdDidDocVersionAcknowledgement(ackHex);
  }

  decodeAllDidDocVersionsMetadataAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
    return decodeCheqdAllDidDocVersionsMetadataAcknowledgement(ackHex);
  }

  decodeResourceAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
    return decodeCheqdResourceAcknowledgement(ackHex);
  }

  decodeResourceMetadataAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
    return decodeCheqdResourceMetadataAcknowledgement(ackHex);
  }

  decodeLatestResourceVersionAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
    return decodeCheqdLatestResourceVersionAcknowledgement(ackHex);
  }

  decodeLatestResourceVersionMetadataAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
    return decodeCheqdLatestResourceVersionMetadataAcknowledgement(ackHex);
  }

  async findResult(dto: CheqdIcqResultRequestDto): Promise<CheqdIcqLookupResult> {
    if (!dto.tx_hash && !dto.since_height) {
      throw new GrpcInvalidArgumentException('Either "tx_hash" or "since_height" must be provided');
    }

    if (!isSupportedCheqdQueryPath(dto.query_path)) {
      throw new GrpcInvalidArgumentException(`Unsupported cheqd query_path: ${dto.query_path}`);
    }

    const searchStart = await this.resolveSearchStartHeight(dto);
    if (searchStart.kind === 'pending') {
      return searchStart.response;
    }

    const searchFromHeight = searchStart.height;
    const eventsResult = await this.queryService.queryEvents({ since_height: searchFromHeight });
    const currentHeight = eventsResult.current_height.toString();
    const scannedToHeight = eventsResult.scanned_to_height.toString();
    const eventMatch = this.findAcknowledgementEvent(eventsResult.events, dto);

    if (!eventMatch) {
      return {
        status: 'pending',
        reason: 'pending_acknowledgement',
        tx_hash: dto.tx_hash,
        query_path: dto.query_path,
        packet_data_hex: dto.packet_data_hex.toLowerCase(),
        current_height: currentHeight,
        next_search_from_height: scannedToHeight,
      };
    }

    return {
      status: 'completed',
      tx_hash: dto.tx_hash,
      query_path: dto.query_path,
      packet_data_hex: dto.packet_data_hex.toLowerCase(),
      current_height: currentHeight,
      next_search_from_height: eventMatch.height.toString(),
      completed_height: eventMatch.height.toString(),
      packet_sequence: eventMatch.packetSequence,
      acknowledgement_hex: eventMatch.acknowledgementHex,
      acknowledgement: decodeCheqdAcknowledgementByQueryPath(dto.query_path, eventMatch.acknowledgementHex),
    };
  }

  private async buildQueryTransaction(
    dto: CheqdIcqBaseRequestDto,
    queryPath: string,
    packetData: Uint8Array,
  ): Promise<BuiltCheqdIcqTransaction> {
    const tx = await this.packetService.sendAsyncIcqPacket({
      sourcePort: ASYNC_ICQ_HOST_PORT,
      sourceChannel: dto.source_channel,
      signer: dto.signer,
      packetData: Buffer.from(packetData).toString('hex'),
      timeoutHeight: this.toHeight(dto.timeout_height),
      timeoutTimestamp: this.toBigInt(dto.timeout_timestamp),
    });

    return {
      source_port: ASYNC_ICQ_HOST_PORT,
      source_channel: dto.source_channel,
      query_path: queryPath,
      packet_data_hex: Buffer.from(packetData).toString('hex'),
      tx,
    };
  }

  private toHeight(height?: { revision_number?: string | number; revision_height?: string | number }): Height {
    return {
      revisionNumber: this.toBigInt(height?.revision_number),
      revisionHeight: this.toBigInt(height?.revision_height),
    };
  }

  private toBigInt(value?: string | number | bigint): bigint {
    if (value === undefined || value === null || value === '') {
      return 0n;
    }

    return BigInt(value);
  }

  private async resolveSearchStartHeight(dto: CheqdIcqResultRequestDto): Promise<SearchStartResult> {
    if (dto.since_height) {
      return {
        kind: 'height',
        height: BigInt(dto.since_height),
      };
    }

    try {
      const tx = await this.queryService.queryTransactionByHash({ hash: dto.tx_hash! });
      return {
        kind: 'height',
        height: tx.height,
      };
    } catch (error) {
      if (!(error instanceof GrpcNotFoundException)) {
        throw error;
      }

      const latestHeight = await this.queryService.latestHeight({});
      return {
        kind: 'pending',
        response: {
          status: 'pending',
          reason: 'source_tx_not_indexed',
          tx_hash: dto.tx_hash,
          query_path: dto.query_path,
          packet_data_hex: dto.packet_data_hex.toLowerCase(),
          current_height: latestHeight.height.toString(),
          next_search_from_height: latestHeight.height.toString(),
        },
      };
    }
  }

  private findAcknowledgementEvent(
    blocks: Array<{ height: bigint; events: ResponseDeliverTx[] }>,
    dto: Pick<CheqdIcqResultRequestDto, 'packet_data_hex' | 'source_channel'>,
  ): PacketAcknowledgementMatch | null {
    const expectedPacketDataHex = dto.packet_data_hex.toLowerCase();
    const expectedSourceChannel = dto.source_channel?.toLowerCase();

    for (const block of blocks) {
      for (const txResult of block.events) {
        for (const event of txResult.events || []) {
          if (event.type !== EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET) {
            continue;
          }

          const attributes = Object.fromEntries(
            (event.event_attribute || []).map((attribute) => [attribute.key, attribute.value]),
          );

          const packetDataHex = attributes[ATTRIBUTE_KEY_PACKET.PACKET_DATA_HEX]?.toLowerCase();
          if (packetDataHex !== expectedPacketDataHex) {
            continue;
          }

          const sourceChannel = attributes[ATTRIBUTE_KEY_PACKET.PACKET_SRC_CHANNEL]?.toLowerCase();
          if (expectedSourceChannel && sourceChannel !== expectedSourceChannel) {
            continue;
          }

          const acknowledgementHex = attributes[ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX];
          if (!acknowledgementHex) {
            continue;
          }

          return {
            height: block.height,
            packetSequence: attributes[ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE] || null,
            acknowledgementHex,
          };
        }
      }
    }

    return null;
  }
}
