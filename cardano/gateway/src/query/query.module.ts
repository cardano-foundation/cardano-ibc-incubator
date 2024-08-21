import { Logger, Module } from '@nestjs/common';
import { QueryService } from './services/query.service';
import { QueryController } from './query.controller';
import { LucidModule } from '../shared/modules/lucid/lucid.module';
import { DbSyncService } from './services/db-sync.service';
import { ConnectionService } from './services/connection.service';
import { ChannelService } from './services/channel.service';
import { HttpModule, HttpService } from '@nestjs/axios';
import { PacketService } from './services/packet.service';
import { MiniProtocalsModule } from '../shared/modules/mini-protocals/mini-protocals.module';
import { MithrilModule } from '../shared/modules/mithril/mithril.module';

@Module({
  imports: [LucidModule, HttpModule, MiniProtocalsModule, MithrilModule],
  controllers: [QueryController],
  providers: [QueryService, Logger, DbSyncService, ConnectionService, ChannelService, PacketService],
  exports: [QueryService, DbSyncService, ConnectionService, ChannelService, PacketService],
})
export class QueryModule {}
