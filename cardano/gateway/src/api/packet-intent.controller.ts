import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { HistoricalReadOnlyGuard } from '../security/historical-read-only.guard';

class CancelIntentDto {
  @IsString()
  @IsNotEmpty()
  signer: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(0xffffffff)
  output_index?: number;
}
import { PacketLaneService } from '../tx/packet-lane.service';

@Controller('api/cardano/intents')
export class PacketIntentController {
  constructor(private readonly lanes: PacketLaneService) {}

  @Get(':channel/:hash')
  status(@Param('channel') channel: string, @Param('hash') hash: string) {
    return this.lanes.intentStatus(channel, hash);
  }

  @Post(':channel/:hash/cancel')
  @UseGuards(HistoricalReadOnlyGuard)
  @HttpCode(200)
  async cancel(@Param('channel') channel: string, @Param('hash') hash: string, @Body() dto: CancelIntentDto) {
    const response = await this.lanes.cancelIntent(channel, hash, dto.signer, dto.output_index);
    return {
      unsigned_tx: {
        type_url: response.unsigned_tx.type_url,
        value: Buffer.from(response.unsigned_tx.value).toString('base64'),
      },
    };
  }
}
