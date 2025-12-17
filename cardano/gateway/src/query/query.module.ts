import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueryService } from './services/query.service';
import { QueryController } from './query.controller';
import { LucidModule } from '../shared/modules/lucid/lucid.module';
import { KupoModule } from '../shared/modules/kupo/kupo.module';
import { DbSyncService } from './services/db-sync.service';
import { ConnectionService } from './services/connection.service';
import { ChannelService } from './services/channel.service';
import { HttpModule, HttpService } from '@nestjs/axios';
import { PacketService } from './services/packet.service';
import { MiniProtocalsModule } from '../shared/modules/mini-protocals/mini-protocals.module';
import { MithrilModule } from '../shared/modules/mithril/mithril.module';
import { DenomTraceService } from './services/denom-trace.service';
import { DenomTrace } from '../shared/entities/denom-trace.entity';
import { HealthModule } from '../health/health.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DenomTrace], 'gateway'),
    LucidModule,
    KupoModule,
    HttpModule,
    MiniProtocalsModule,
    MithrilModule,
    HealthModule,
  ],
  controllers: [QueryController],
  providers: [QueryService, Logger, DbSyncService, ConnectionService, ChannelService, PacketService, DenomTraceService],
  exports: [QueryService, DbSyncService, ConnectionService, ChannelService, PacketService, DenomTraceService],
})
export class QueryModule {}
