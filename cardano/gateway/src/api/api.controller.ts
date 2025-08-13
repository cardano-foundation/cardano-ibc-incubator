import { Body, Controller, Get, HttpCode, ParseBoolPipe, ParseIntPipe, Post, Query, UseFilters } from '@nestjs/common';
import { MsgtransferDto } from './api.dto';
import { ChannelService } from '~@/query/services/channel.service';
import { QueryChannelsRequest } from '@plus/proto-types/build/ibc/core/channel/v1/query';
import { IdentifiedChannel } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { PacketService } from '~@/tx/packet.service';
import { MsgTransfer } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { GrpcExceptionFilter } from '~@/exception/exception.filter';

@Controller('api')
@UseFilters(new GrpcExceptionFilter())
export class ApiController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly packetService: PacketService,
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
  @Post('transfer')
  @HttpCode(200)
  async buildTransferMsg(@Body() msgtransferDto: MsgtransferDto) {
    const request = MsgTransfer.fromJSON(msgtransferDto);
    const response = await this.packetService.sendPacket(request);

    return {
      result: response.result,
      unsigned_tx: {
        type_url: response.unsigned_tx.type_url,
        value: Buffer.from(response.unsigned_tx.value).toString('base64'),
      },
    };
  }
}
