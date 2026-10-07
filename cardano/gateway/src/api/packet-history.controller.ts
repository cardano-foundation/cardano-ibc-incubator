import { BadRequestException, Controller, Get, Header, Param } from '@nestjs/common';
import { PacketStateService } from '../query/services/packet-state.service';

@Controller('api/packet-history')
export class PacketHistoryController {
  constructor(private readonly state: PacketStateService) {}

  @Get(':channel/occupancy')
  @Header('Cache-Control', 'no-store')
  occupancy(@Param('channel') channel: string) {
    if (!/^channel-(0|[1-9][0-9]*)$/.test(channel)) throw new BadRequestException('Invalid channel identifier');
    return this.state.occupancy('transfer', channel);
  }
}
