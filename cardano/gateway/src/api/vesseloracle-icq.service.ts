import { Injectable } from '@nestjs/common';
import { MsgTransferResponse } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { PacketService } from '~@/tx/packet.service';
import { Height } from '~@/shared/types/height';
import { ASYNC_ICQ_HOST_PORT } from '@shared/types/apps/async-icq/async-icq';
import {
  buildVesseloracleConsolidatedDataReportPacketData,
  decodeVesseloracleConsolidatedDataReportAcknowledgement,
  DecodedVesseloracleIcqAcknowledgement,
} from '@shared/types/apps/async-icq/vesseloracle-icq';
import { AsyncIcqBaseRequestDto } from './async-icq.dto';
import { VesseloracleConsolidatedDataReportIcqRequestDto } from './vesseloracle-icq.dto';

type BuiltVesseloracleIcqTransaction = {
  source_port: typeof ASYNC_ICQ_HOST_PORT;
  source_channel: string;
  query_path: string;
  packet_data_hex: string;
  tx: MsgTransferResponse;
};

@Injectable()
export class VesseloracleIcqService {
  constructor(private readonly packetService: PacketService) {}

  async buildConsolidatedDataReportQuery(
    dto: VesseloracleConsolidatedDataReportIcqRequestDto,
  ): Promise<BuiltVesseloracleIcqTransaction> {
    const { packetData, queryPath } = buildVesseloracleConsolidatedDataReportPacketData({
      imo: dto.imo,
      ts: dto.ts,
    });

    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  decodeConsolidatedDataReportAcknowledgement(ackHex: string): DecodedVesseloracleIcqAcknowledgement {
    return decodeVesseloracleConsolidatedDataReportAcknowledgement(ackHex);
  }

  private async buildQueryTransaction(
    dto: AsyncIcqBaseRequestDto,
    queryPath: string,
    packetData: Uint8Array,
  ): Promise<BuiltVesseloracleIcqTransaction> {
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
