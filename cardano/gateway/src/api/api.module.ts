import { Logger, Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ChannelService } from '~@/query/services/channel.service';
import { QueryModule } from '~@/query/query.module';
import { LucidModule } from '@shared/modules/lucid/lucid.module';
import { HttpModule } from '@nestjs/axios';
import { MiniProtocalsModule } from '@shared/modules/mini-protocals/mini-protocals.module';
import { PacketService } from '~@/tx/packet.service';
import { MithrilModule } from '../shared/modules/mithril/mithril.module';

@Module({
  imports: [QueryModule, LucidModule, HttpModule, MiniProtocalsModule, MithrilModule],
  controllers: [ApiController],
  providers: [ChannelService, PacketService, Logger],
})
export class ApiModule {}
