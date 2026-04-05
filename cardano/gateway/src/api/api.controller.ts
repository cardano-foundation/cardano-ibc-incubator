import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseIntPipe, Post, Query, UseFilters } from '@nestjs/common';
import { EstimateLocalOsmosisSwapDto, MsgtransferDto, PlanTransferRouteDto } from './api.dto';
import {
  CheqdDidDocIcqRequestDto,
  CheqdDidDocVersionIcqRequestDto,
  CheqdIcqAcknowledgementDto,
  CheqdIcqResultRequestDto,
  CheqdLatestResourceVersionIcqRequestDto,
  CheqdResourceIcqRequestDto,
} from './cheqd-icq.dto';
import { ChannelService } from '~@/query/services/channel.service';
import { QueryChannelsRequest } from '@plus/proto-types/build/ibc/core/channel/v1/query';
import { IdentifiedChannel } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { PacketService } from '~@/tx/packet.service';
import { MsgTransfer } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { GrpcExceptionFilter } from '~@/exception/exception.filter';
import { DenomTraceService, ResolvedDenomTrace } from '~@/query/services/denom-trace.service';
import { LOVELACE } from '../constant';
import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { TransferPlannerService } from './transfer-planner.service';
import { BridgeManifestService } from '~@/query/services/bridge-manifest.service';
import { CheqdIcqService } from './cheqd-icq.service';
import { deriveVoucherPresentation } from '../shared/helpers/voucher-presentation';

type ApiCardanoAssetDenomTrace = {
  asset_id: string;
  kind: 'native' | 'ibc_voucher';
  path: string;
  base_denom: string;
  full_denom: string;
  voucher_token_name: string | null;
  voucher_policy_id: string | null;
  ibc_denom_hash: string | null;
  display_name: string;
  display_symbol: string;
  display_description: string;
};

type ParsedCardanoAssetId = {
  assetId: string;
  policyId: string;
  assetNameHex: string;
};

const CARDANO_POLICY_ID_HEX_LENGTH = 56;
const LOVELACE_PACKET_DENOM_HEX = Buffer.from(LOVELACE, 'utf8').toString('hex');

@Controller('api')
@UseFilters(new GrpcExceptionFilter())
export class ApiController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly packetService: PacketService,
    private readonly denomTraceService: DenomTraceService,
    private readonly localOsmosisSwapPlannerService: LocalOsmosisSwapPlannerService,
    private readonly transferPlannerService: TransferPlannerService,
    private readonly bridgeManifestService: BridgeManifestService,
    private readonly cheqdIcqService: CheqdIcqService,
  ) {}

  @Get('channels')
  async getChannels(
    @Query('key') key: string,
    @Query('offset', ParseIntPipe) offset: number,
    @Query('limit', ParseIntPipe) limit: number,
    @Query('countTotal', ParseBoolPipe) countTotal: boolean,
    @Query('reverse', ParseBoolPipe) reverse: boolean,
  ) {
    const pageRequestDto = {
      pagination: {
        key: key,
        offset: offset,
        limit: limit,
        count_total: countTotal,
        reverse: reverse,
      },
    };
    const request = QueryChannelsRequest.fromJSON(pageRequestDto);
    const response = await this.channelService.queryChannels(request);
    const next_key = Buffer.from(response.pagination.next_key || '').toString('base64');
    return {
      channels: response.channels.map((chann) => IdentifiedChannel.toJSON(chann)),
      pagination: {
        next_key: next_key,
        total: response.pagination.total.toString(),
      },
      height: {
        revision_height: response.height.revision_height.toString(),
        revision_number: response.height.revision_number.toString(),
      },
    };
  }

  @Get('bridge-manifest')
  async getBridgeManifest() {
    // Exposes the public bootstrap document for operators that want to point a
    // separate Gateway/relayer stack at this already-deployed Cardano bridge.
    return this.bridgeManifestService.getBridgeManifest();
  }

  @Post('transfer')
  @HttpCode(200)
  async buildTransferMsg(@Body() msgtransferDto: MsgtransferDto) {
    const request = MsgTransfer.fromJSON(msgtransferDto);
    const response = await this.packetService.sendPacket(request);

    return this.serializeUnsignedTxResponse(response);
  }

  @Post('icq/cheqd/did-doc')
  @HttpCode(200)
  async buildCheqdDidDocIcq(@Body() requestDto: CheqdDidDocIcqRequestDto) {
    const response = await this.cheqdIcqService.buildDidDocQuery(requestDto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('icq/cheqd/did-doc/decode')
  @HttpCode(200)
  async decodeCheqdDidDocIcq(@Body() dto: CheqdIcqAcknowledgementDto) {
    return this.cheqdIcqService.decodeDidDocAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('icq/cheqd/did-doc-version')
  @HttpCode(200)
  async buildCheqdDidDocVersionIcq(@Body() requestDto: CheqdDidDocVersionIcqRequestDto) {
    const response = await this.cheqdIcqService.buildDidDocVersionQuery(requestDto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('icq/cheqd/did-doc-version/decode')
  @HttpCode(200)
  async decodeCheqdDidDocVersionIcq(@Body() dto: CheqdIcqAcknowledgementDto) {
    return this.cheqdIcqService.decodeDidDocVersionAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('icq/cheqd/did-doc-versions-metadata')
  @HttpCode(200)
  async buildCheqdDidDocVersionsMetadataIcq(@Body() requestDto: CheqdDidDocIcqRequestDto) {
    const response = await this.cheqdIcqService.buildAllDidDocVersionsMetadataQuery(requestDto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('icq/cheqd/did-doc-versions-metadata/decode')
  @HttpCode(200)
  async decodeCheqdDidDocVersionsMetadataIcq(@Body() dto: CheqdIcqAcknowledgementDto) {
    return this.cheqdIcqService.decodeAllDidDocVersionsMetadataAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('icq/cheqd/resource')
  @HttpCode(200)
  async buildCheqdResourceIcq(@Body() requestDto: CheqdResourceIcqRequestDto) {
    const response = await this.cheqdIcqService.buildResourceQuery(requestDto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('icq/cheqd/resource/decode')
  @HttpCode(200)
  async decodeCheqdResourceIcq(@Body() dto: CheqdIcqAcknowledgementDto) {
    return this.cheqdIcqService.decodeResourceAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('icq/cheqd/resource-metadata')
  @HttpCode(200)
  async buildCheqdResourceMetadataIcq(@Body() requestDto: CheqdResourceIcqRequestDto) {
    const response = await this.cheqdIcqService.buildResourceMetadataQuery(requestDto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('icq/cheqd/resource-metadata/decode')
  @HttpCode(200)
  async decodeCheqdResourceMetadataIcq(@Body() dto: CheqdIcqAcknowledgementDto) {
    return this.cheqdIcqService.decodeResourceMetadataAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('icq/cheqd/latest-resource-version')
  @HttpCode(200)
  async buildCheqdLatestResourceVersionIcq(@Body() requestDto: CheqdLatestResourceVersionIcqRequestDto) {
    const response = await this.cheqdIcqService.buildLatestResourceVersionQuery(requestDto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('icq/cheqd/latest-resource-version/decode')
  @HttpCode(200)
  async decodeCheqdLatestResourceVersionIcq(@Body() dto: CheqdIcqAcknowledgementDto) {
    return this.cheqdIcqService.decodeLatestResourceVersionAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('icq/cheqd/latest-resource-version-metadata')
  @HttpCode(200)
  async buildCheqdLatestResourceVersionMetadataIcq(@Body() requestDto: CheqdLatestResourceVersionIcqRequestDto) {
    const response = await this.cheqdIcqService.buildLatestResourceVersionMetadataQuery(requestDto);
    return {
      query_path: response.query_path,
      source_port: response.source_port,
      source_channel: response.source_channel,
      packet_data_hex: response.packet_data_hex,
      ...this.serializeUnsignedTxResponse(response.tx),
    };
  }

  @Post('icq/cheqd/latest-resource-version-metadata/decode')
  @HttpCode(200)
  async decodeCheqdLatestResourceVersionMetadataIcq(@Body() dto: CheqdIcqAcknowledgementDto) {
    return this.cheqdIcqService.decodeLatestResourceVersionMetadataAcknowledgement(dto.acknowledgement_hex);
  }

  @Post('icq/cheqd/result')
  @HttpCode(200)
  async getCheqdIcqResult(@Body() dto: CheqdIcqResultRequestDto) {
    return this.cheqdIcqService.findResult(dto);
  }

  private serializeUnsignedTxResponse(response: { result?: unknown; unsigned_tx?: { type_url?: string; value?: Uint8Array | string } }) {
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

  @Post('transfer/plan')
  @HttpCode(200)
  async planTransferRoute(@Body() planTransferRouteDto: PlanTransferRouteDto) {
    return this.transferPlannerService.planTransferRoute({
      fromChainId: planTransferRouteDto.from_chain_id,
      toChainId: planTransferRouteDto.to_chain_id,
      tokenDenom: planTransferRouteDto.token_denom,
    });
  }

  @Get('cardano/assets/:assetId/denom-trace')
  async getCardanoAssetDenomTrace(@Param('assetId') assetId: string): Promise<ApiCardanoAssetDenomTrace> {
    if (assetId.trim().toLowerCase() === LOVELACE) {
      return this.buildNativeAssetTrace(LOVELACE, LOVELACE_PACKET_DENOM_HEX, LOVELACE);
    }

    const parsed = this.parseCardanoAssetId(assetId);
    const trace = await this.denomTraceService.findByHash(parsed.assetNameHex);
    if (trace && trace.voucher_policy_id?.toLowerCase() === parsed.policyId) {
      return this.mapVoucherTrace(parsed.assetId, trace);
    }

    return this.buildNativeAssetTrace(parsed.assetId, parsed.assetId, parsed.assetId);
  }

  @Get('cardano/ibc-assets')
  async listCardanoIbcAssets(): Promise<ApiCardanoAssetDenomTrace[]> {
    const traces = await this.denomTraceService.findAll();
    return traces.map((trace) =>
      this.mapVoucherTrace(`${trace.voucher_policy_id}${trace.hash}`.toLowerCase(), trace),
    );
  }

  @Get('local-osmosis/swap/options')
  async getLocalOsmosisSwapOptions() {
    return this.localOsmosisSwapPlannerService.getSwapOptions();
  }

  @Post('local-osmosis/swap/estimate')
  @HttpCode(200)
  async estimateLocalOsmosisSwap(
    @Body() estimateSwapDto: EstimateLocalOsmosisSwapDto,
  ) {
    return this.localOsmosisSwapPlannerService.estimateSwap({
      fromChainId: estimateSwapDto.from_chain_id,
      tokenInDenom: estimateSwapDto.token_in_denom,
      tokenInAmount: estimateSwapDto.token_in_amount,
      toChainId: estimateSwapDto.to_chain_id,
      tokenOutDenom: estimateSwapDto.token_out_denom,
    });
  }

  private parseCardanoAssetId(assetId: string): ParsedCardanoAssetId {
    const normalized = assetId.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('"assetId" is required');
    }

    if (!/^[0-9a-f]+$/i.test(normalized)) {
      throw new BadRequestException('"assetId" must be a hex-encoded Cardano asset unit or "lovelace"');
    }

    if (normalized.length < CARDANO_POLICY_ID_HEX_LENGTH) {
      throw new BadRequestException('"assetId" must include a 56-character policy id');
    }

    const assetNameHex = normalized.slice(CARDANO_POLICY_ID_HEX_LENGTH);
    if (assetNameHex.length % 2 !== 0) {
      throw new BadRequestException('"assetId" token name bytes must be hex encoded');
    }

    return {
      assetId: normalized,
      policyId: normalized.slice(0, CARDANO_POLICY_ID_HEX_LENGTH),
      assetNameHex,
    };
  }

  private buildNativeAssetTrace(
    assetId: string,
    baseDenom: string,
    fullDenom: string,
  ): ApiCardanoAssetDenomTrace {
    const displayName = fullDenom === LOVELACE ? 'ADA' : baseDenom;
    return {
      asset_id: assetId,
      kind: 'native',
      path: '',
      base_denom: baseDenom,
      full_denom: fullDenom,
      voucher_token_name: null,
      voucher_policy_id: null,
      ibc_denom_hash: null,
      display_name: displayName,
      display_symbol: displayName,
      display_description: `Cardano native asset ${fullDenom}`,
    };
  }

  private mapVoucherTrace(assetId: string, trace: ResolvedDenomTrace): ApiCardanoAssetDenomTrace {
    const fullDenom = trace.path ? `${trace.path}/${trace.base_denom}` : trace.base_denom;
    const presentation = deriveVoucherPresentation(fullDenom, trace.base_denom);
    return {
      asset_id: assetId,
      kind: 'ibc_voucher',
      path: trace.path,
      base_denom: trace.base_denom,
      full_denom: fullDenom,
      voucher_token_name: trace.hash,
      voucher_policy_id: trace.voucher_policy_id,
      ibc_denom_hash: trace.ibc_denom_hash ?? null,
      display_name: presentation.displayName,
      display_symbol: presentation.displaySymbol,
      display_description: presentation.displayDescription,
    };
  }
}
