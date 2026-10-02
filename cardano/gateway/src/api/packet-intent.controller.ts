import { Controller, Get, Param } from '@nestjs/common';
import { PacketLaneService } from '../tx/packet-lane.service';

@Controller('api/cardano/intents')
export class PacketIntentController {
  constructor(private readonly lanes: PacketLaneService) {}

  @Get(':channel/:hash')
  status(@Param('channel') channel: string, @Param('hash') hash: string) {
    return this.lanes.intentStatus(channel, hash);
  }
}
