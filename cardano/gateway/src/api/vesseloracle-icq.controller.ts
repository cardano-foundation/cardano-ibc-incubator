import { BadRequestException, Body, Controller, HttpCode, Post, UseFilters } from '@nestjs/common';
import { GrpcExceptionFilter } from '~@/exception/exception.filter';
import { AsyncIcqAcknowledgementDto, AsyncIcqResultRequestDto } from './async-icq.dto';
import {
  VesseloracleConsolidatedDataReportIcqRequestDto,
  VesseloracleLatestConsolidatedDataReportIcqRequestDto,
} from './vesseloracle-icq.dto';
import { VesseloracleIcqService } from './vesseloracle-icq.service';

/**
 * Preserved VesselOracle routes. This controller is intentionally absent from
 * ApiModule while no target chain hosts the VesselOracle query service.
 */
@Controller('api/icq/vesseloracle')
@UseFilters(new GrpcExceptionFilter())
export class VesseloracleIcqController {
  constructor(private readonly vesseloracleIcqService: VesseloracleIcqService) {}

  @Post('consolidated-data-report')
  @HttpCode(200)
  async buildConsolidatedDataReport(@Body() dto: VesseloracleConsolidatedDataReportIcqRequestDto) {
    const response = await this.vesseloracleIcqService.buildConsolidatedDataReportQuery(dto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_sequence: response.packet_sequence,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('consolidated-data-report/decode')
  @HttpCode(200)
  decodeConsolidatedDataReport(@Body() dto: AsyncIcqAcknowledgementDto) {
    return this.vesseloracleIcqService.decodeConsolidatedDataReportAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('latest-consolidated-data-report')
  @HttpCode(200)
  async buildLatestConsolidatedDataReport(@Body() dto: VesseloracleLatestConsolidatedDataReportIcqRequestDto) {
    const response = await this.vesseloracleIcqService.buildLatestConsolidatedDataReportQuery(dto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_sequence: response.packet_sequence,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('latest-consolidated-data-report/decode')
  @HttpCode(200)
  decodeLatestConsolidatedDataReport(@Body() dto: AsyncIcqAcknowledgementDto) {
    return this.vesseloracleIcqService.decodeLatestConsolidatedDataReportAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('result')
  @HttpCode(200)
  findResult(@Body() dto: AsyncIcqResultRequestDto) {
    return this.vesseloracleIcqService.findResult(dto);
  }

  private serializeUnsignedTxResponse(response: {
    result?: unknown;
    unsigned_tx?: { type_url?: string; value?: Uint8Array | string };
  }) {
    if (!response.unsigned_tx?.value) {
      throw new BadRequestException('Gateway response did not include an unsigned transaction');
    }

    return {
      result: response.result,
      unsigned_tx: {
        type_url: response.unsigned_tx.type_url || '',
        value: Buffer.from(response.unsigned_tx.value).toString('base64'),
      },
    };
  }
}
