import { Inject, Injectable } from '@nestjs/common';
import { ResponseDeliverTx } from '@plus/proto-types/build/ibc/core/types/v1/block';
import { MsgTransferResponse } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { QueryService } from '~@/query/services/query.service';
import { ATTRIBUTE_KEY_PACKET, EVENT_TYPE_PACKET } from '~@/constant/packet';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { PacketService } from '~@/tx/packet.service';
import { Height } from '~@/shared/types/height';
import { ASYNC_ICQ_HOST_PORT } from '@shared/types/apps/async-icq/async-icq';
import {
  buildVesseloracleConsolidatedDataReportPacketData,
  decodeVesseloracleConsolidatedDataReportAcknowledgement,
  buildVesseloracleLatestConsolidatedDataReportPacketData,
  decodeVesseloracleLatestConsolidatedDataReportAcknowledgement,
  DecodedVesseloracleIcqAcknowledgement,
  isSupportedVesseloracleQueryPath,
  VESSELORACLE_LATEST_QUERY_PATH,
} from '@shared/types/apps/async-icq/vesseloracle-icq';
import { REDEEMER_EMPTY_DATA, REDEEMER_TYPE } from '~@/constant';
import { HISTORY_SERVICE, HistoryService, HistoryTxEvidence } from '~@/query/services/history.service';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import { decodeSpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import { convertHex2String } from '@shared/helpers/hex';
import { Packet } from '@shared/types/channel/packet';
import { AsyncIcqBaseRequestDto, AsyncIcqResultRequestDto } from './async-icq.dto';
import {
  VesseloracleConsolidatedDataReportIcqRequestDto,
  VesseloracleLatestConsolidatedDataReportIcqRequestDto,
} from './vesseloracle-icq.dto';

type BuiltVesseloracleIcqTransaction = {
  source_port: typeof ASYNC_ICQ_HOST_PORT;
  source_channel: string;
  query_path: string;
  packet_data_hex: string;
  tx: MsgTransferResponse;
};

type VesseloracleIcqLookupResult =
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
      acknowledgement: DecodedVesseloracleIcqAcknowledgement;
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
      response: Extract<VesseloracleIcqLookupResult, { status: 'pending' }>;
    };

type ExpectedPacketMatch = {
  packetSequence: string;
  sourceChannel: string;
};

@Injectable()
export class VesseloracleIcqService {
  constructor(
    private readonly packetService: PacketService,
    private readonly queryService: QueryService,
    @Inject(HISTORY_SERVICE) private readonly historyService: HistoryService,
    private readonly lucidService: LucidService,
  ) {}

  async buildConsolidatedDataReportQuery(
    dto: VesseloracleConsolidatedDataReportIcqRequestDto,
  ): Promise<BuiltVesseloracleIcqTransaction> {
    const { packetData, queryPath } = buildVesseloracleConsolidatedDataReportPacketData({
      imo: dto.imo,
      ts: dto.ts,
    });

    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  async buildLatestConsolidatedDataReportQuery(
    dto: VesseloracleLatestConsolidatedDataReportIcqRequestDto,
  ): Promise<BuiltVesseloracleIcqTransaction> {
    const { packetData, queryPath } = buildVesseloracleLatestConsolidatedDataReportPacketData({
      imo: dto.imo,
    });

    return this.buildQueryTransaction(dto, queryPath, packetData);
  }

  decodeConsolidatedDataReportAcknowledgement(ackHex: string): DecodedVesseloracleIcqAcknowledgement {
    return decodeVesseloracleConsolidatedDataReportAcknowledgement(ackHex);
  }

  decodeLatestConsolidatedDataReportAcknowledgement(ackHex: string): DecodedVesseloracleIcqAcknowledgement {
    return decodeVesseloracleLatestConsolidatedDataReportAcknowledgement(ackHex);
  }

  async findResult(dto: AsyncIcqResultRequestDto): Promise<VesseloracleIcqLookupResult> {
    if (!dto.tx_hash && !dto.since_height) {
      throw new GrpcInvalidArgumentException('Either "tx_hash" or "since_height" must be provided');
    }
    if (!dto.tx_hash && !dto.packet_sequence) {
      throw new GrpcInvalidArgumentException('Either "tx_hash" or "packet_sequence" must be provided');
    }
    if (dto.packet_sequence && !dto.source_channel && !dto.tx_hash) {
      throw new GrpcInvalidArgumentException('"source_channel" must be provided when "packet_sequence" is provided');
    }

    if (!isSupportedVesseloracleQueryPath(dto.query_path)) {
      throw new GrpcInvalidArgumentException(`Unsupported vesseloracle query_path: ${dto.query_path}`);
    }

    const searchStart = await this.resolveSearchStartHeight(dto);
    if (searchStart.kind === 'pending') {
      return searchStart.response;
    }

    const expectedPacketMatch = await this.resolveExpectedPacketMatch(dto);
    if (!expectedPacketMatch) {
      const latestHeight = await this.queryService.latestHeight({});
      return {
        status: 'pending',
        reason: 'source_tx_not_indexed',
        tx_hash: dto.tx_hash,
        query_path: dto.query_path,
        packet_data_hex: dto.packet_data_hex.toLowerCase(),
        current_height: latestHeight.height.toString(),
        next_search_from_height: latestHeight.height.toString(),
      };
    }

    const eventsResult = await this.queryService.queryEvents({ since_height: searchStart.height });
    const eventMatch = this.findAcknowledgementEvent(eventsResult.events, dto, expectedPacketMatch);

    if (!eventMatch) {
      return {
        status: 'pending',
        reason: 'pending_acknowledgement',
        tx_hash: dto.tx_hash,
        query_path: dto.query_path,
        packet_data_hex: dto.packet_data_hex.toLowerCase(),
        current_height: eventsResult.current_height.toString(),
        next_search_from_height: eventsResult.scanned_to_height.toString(),
      };
    }

    return {
      status: 'completed',
      tx_hash: dto.tx_hash,
      query_path: dto.query_path,
      packet_data_hex: dto.packet_data_hex.toLowerCase(),
      current_height: eventsResult.current_height.toString(),
      next_search_from_height: eventMatch.height.toString(),
      completed_height: eventMatch.height.toString(),
      packet_sequence: eventMatch.packetSequence,
      acknowledgement_hex: eventMatch.acknowledgementHex,
      acknowledgement: this.decodeAcknowledgement(dto.query_path, eventMatch.acknowledgementHex),
    };
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

  private decodeAcknowledgement(queryPath: string, ackHex: string): DecodedVesseloracleIcqAcknowledgement {
    if (!isSupportedVesseloracleQueryPath(queryPath)) {
      throw new GrpcInvalidArgumentException(`Unsupported vesseloracle query_path: ${queryPath}`);
    }

    if (queryPath === VESSELORACLE_LATEST_QUERY_PATH) {
      return decodeVesseloracleLatestConsolidatedDataReportAcknowledgement(ackHex);
    }

    return decodeVesseloracleConsolidatedDataReportAcknowledgement(ackHex);
  }

  private async resolveSearchStartHeight(dto: AsyncIcqResultRequestDto): Promise<SearchStartResult> {
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

  private async resolveExpectedPacketMatch(dto: AsyncIcqResultRequestDto): Promise<ExpectedPacketMatch | null> {
    if (dto.packet_sequence && dto.source_channel) {
      return {
        packetSequence: dto.packet_sequence,
        sourceChannel: dto.source_channel.toLowerCase(),
      };
    }

    const tx = await this.queryService.queryTransactionByHash({ hash: dto.tx_hash! });
    const txEvidence = await this.historyService.findTransactionEvidenceByHash(dto.tx_hash!);
    const matchingPackets = txEvidence ? this.findMatchingSendPacketsInTxEvidence(txEvidence, dto) : [];
    if (matchingPackets.length === 1) {
      return matchingPackets[0];
    }
    if (matchingPackets.length > 1) {
      throw new GrpcInvalidArgumentException(
        `Ambiguous source tx ${dto.tx_hash}: multiple matching send_packet entries found; provide packet_sequence explicitly`,
      );
    }

    const fallbackMatches = await this.findMatchingSendPacketsInSourceBlock(tx.height, dto);
    if (fallbackMatches.length === 1) {
      return fallbackMatches[0];
    }
    if (fallbackMatches.length > 1) {
      throw new GrpcInvalidArgumentException(
        `Ambiguous source tx ${dto.tx_hash}: multiple matching send_packet entries found; provide packet_sequence explicitly`,
      );
    }

    return null;
  }

  private async findMatchingSendPacketsInSourceBlock(
    txHeight: bigint,
    dto: Pick<AsyncIcqResultRequestDto, 'packet_data_hex' | 'source_channel' | 'packet_sequence'>,
  ): Promise<Array<{ packetSequence: string; sourceChannel: string }>> {
    const blockResult = await this.queryService.queryBlockResults({ height: txHeight });
    return this.findMatchingSendPacketEvents(blockResult.block_results.txs_results ?? [], dto);
  }

  private findAcknowledgementEvent(
    blocks: Array<{ height: bigint; events: ResponseDeliverTx[] }>,
    dto: Pick<AsyncIcqResultRequestDto, 'packet_data_hex'>,
    expectedPacketMatch: ExpectedPacketMatch,
  ): PacketAcknowledgementMatch | null {
    const expectedPacketDataHex = dto.packet_data_hex.toLowerCase();
    const expectedSourceChannel = expectedPacketMatch.sourceChannel.toLowerCase();
    const expectedPacketSequence = expectedPacketMatch.packetSequence;

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
          if (sourceChannel !== expectedSourceChannel) {
            continue;
          }

          const packetSequence = attributes[ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE] || null;
          if (packetSequence !== expectedPacketSequence) {
            continue;
          }

          const acknowledgementHex = attributes[ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX];
          if (!acknowledgementHex) {
            continue;
          }

          return {
            height: block.height,
            packetSequence,
            acknowledgementHex,
          };
        }
      }
    }

    return null;
  }

  private findMatchingSendPacketsInTxEvidence(
    txEvidence: HistoryTxEvidence,
    dto: Pick<AsyncIcqResultRequestDto, 'packet_data_hex' | 'source_channel' | 'packet_sequence'>,
  ): Array<{ packetSequence: string; sourceChannel: string }> {
    const expectedPacketDataHex = dto.packet_data_hex.toLowerCase();
    const expectedSourceChannel = dto.source_channel?.toLowerCase();
    const expectedPacketSequence = dto.packet_sequence ?? null;
    const matches: Array<{ packetSequence: string; sourceChannel: string }> = [];

    for (const redeemer of txEvidence.redeemers) {
      if (redeemer.type !== REDEEMER_TYPE.SPEND) {
        continue;
      }
      if (redeemer.data === REDEEMER_EMPTY_DATA || redeemer.data.length <= 10) {
        continue;
      }

      let spendRedeemer: { SendPacket?: { packet: Packet } };
      try {
        spendRedeemer = decodeSpendChannelRedeemer(redeemer.data, this.lucidService.LucidImporter) as {
          SendPacket?: { packet: Packet };
        };
      } catch {
        continue;
      }

      const packet = spendRedeemer.SendPacket?.packet;
      if (!packet) {
        continue;
      }

      const sourceChannel = convertHex2String(packet.source_channel).toLowerCase();
      const packetSequence = packet.sequence.toString();
      if (packet.data.toLowerCase() !== expectedPacketDataHex) {
        continue;
      }
      if (expectedSourceChannel && sourceChannel !== expectedSourceChannel) {
        continue;
      }
      if (expectedPacketSequence && packetSequence !== expectedPacketSequence) {
        continue;
      }

      matches.push({
        packetSequence,
        sourceChannel,
      });
    }

    return matches;
  }

  private findMatchingSendPacketEvents(
    txResults: ResponseDeliverTx[],
    dto: Pick<AsyncIcqResultRequestDto, 'packet_data_hex' | 'source_channel' | 'packet_sequence'>,
  ): Array<{ packetSequence: string; sourceChannel: string }> {
    const expectedPacketDataHex = dto.packet_data_hex.toLowerCase();
    const expectedSourceChannel = dto.source_channel?.toLowerCase();
    const expectedPacketSequence = dto.packet_sequence ?? null;
    const matches: Array<{ packetSequence: string; sourceChannel: string }> = [];

    for (const txResult of txResults) {
      for (const event of txResult.events || []) {
        if (event.type !== EVENT_TYPE_PACKET.SEND_PACKET) {
          continue;
        }

        const attributes = Object.fromEntries(
          (event.event_attribute || []).map((attribute) => [attribute.key, attribute.value]),
        );

        const packetDataHex = attributes[ATTRIBUTE_KEY_PACKET.PACKET_DATA_HEX]?.toLowerCase();
        if (packetDataHex !== expectedPacketDataHex) {
          continue;
        }

        const sourcePort = attributes[ATTRIBUTE_KEY_PACKET.PACKET_SRC_PORT]?.toLowerCase();
        if (sourcePort !== ASYNC_ICQ_HOST_PORT) {
          continue;
        }

        const sourceChannel = attributes[ATTRIBUTE_KEY_PACKET.PACKET_SRC_CHANNEL]?.toLowerCase();
        if (!sourceChannel) {
          continue;
        }
        if (expectedSourceChannel && sourceChannel !== expectedSourceChannel) {
          continue;
        }

        const packetSequence = attributes[ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE] || null;
        if (!packetSequence) {
          continue;
        }
        if (expectedPacketSequence && packetSequence !== expectedPacketSequence) {
          continue;
        }

        matches.push({
          packetSequence,
          sourceChannel,
        });
      }
    }

    return matches;
  }
}
