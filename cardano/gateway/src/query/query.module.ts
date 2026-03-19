import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueryService } from './services/query.service';
import { QueryController } from './query.controller';
import { LucidModule } from '../shared/modules/lucid/lucid.module';
import { KupoModule } from '../shared/modules/kupo/kupo.module';
import { HISTORY_SERVICE } from './services/history.service';
import { ConnectionService } from './services/connection.service';
import { ChannelService } from './services/channel.service';
import { PacketService } from './services/packet.service';
import { MiniProtocalsService } from '../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilModule } from '../shared/modules/mithril/mithril.module';
import { DenomTraceService } from './services/denom-trace.service';
import { DenomTrace } from '../shared/entities/denom-trace.entity';
import { HealthModule } from '../health/health.module';
import { BridgeManifestService } from './services/bridge-manifest.service';
import { YaciHistoryService } from './services/yaci-history.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DenomTrace], 'gateway'),
    LucidModule,
    KupoModule,
    MithrilModule,
    HealthModule,
  ],
  controllers: [QueryController],
  providers: [
    QueryService,
    Logger,
    YaciHistoryService,
    {
      provide: HISTORY_SERVICE,
      useExisting: YaciHistoryService,
    },
    MiniProtocalsService,
    ConnectionService,
    ChannelService,
    PacketService,
    DenomTraceService,
    BridgeManifestService,
  ],
  exports: [QueryService, HISTORY_SERVICE, ConnectionService, ChannelService, PacketService, DenomTraceService, BridgeManifestService],
})
export class QueryModule {}
