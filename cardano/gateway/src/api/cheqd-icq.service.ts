import { Injectable } from '@nestjs/common';
import { MsgTransferResponse } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
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
  decodeCheqdAllDidDocVersionsMetadataAcknowledgement,
  decodeCheqdDidDocAcknowledgement,
  decodeCheqdDidDocVersionAcknowledgement,
  decodeCheqdLatestResourceVersionAcknowledgement,
  decodeCheqdLatestResourceVersionMetadataAcknowledgement,
  decodeCheqdResourceAcknowledgement,
  decodeCheqdResourceMetadataAcknowledgement,
  DecodedCheqdIcqAcknowledgement,
} from '@shared/types/apps/async-icq/cheqd-icq';
import {
  CheqdDidDocIcqRequestDto,
  CheqdDidDocVersionIcqRequestDto,
  CheqdIcqBaseRequestDto,
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

@Injectable()
export class CheqdIcqService {
  constructor(private readonly packetService: PacketService) {}

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
}
