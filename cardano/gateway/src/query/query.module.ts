import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { QueryService } from './services/query.service';
import { QueryController } from './query.controller';
import { LucidModule } from '../shared/modules/lucid/lucid.module';
import { KupoModule } from '../shared/modules/kupo/kupo.module';
import { DbSyncService } from './services/db-sync.service';
import { HISTORY_SERVICE } from './services/history.service';
import { ConnectionService } from './services/connection.service';
import { ChannelService } from './services/channel.service';
import { HttpModule } from '@nestjs/axios';
import { PacketService } from './services/packet.service';
import { MiniProtocalsModule } from '../shared/modules/mini-protocals/mini-protocals.module';
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
    HttpModule,
    MiniProtocalsModule,
    MithrilModule,
    HealthModule,
  ],
  controllers: [QueryController],
  providers: [
    QueryService,
    Logger,
    DbSyncService,
    YaciHistoryService,
    {
      provide: HISTORY_SERVICE,
      inject: [ConfigService, DbSyncService, YaciHistoryService],
      useFactory: (configService: ConfigService, dbSyncService: DbSyncService, yaciHistoryService: YaciHistoryService) => {
        const backend = String(configService.get('historyBackend') || 'dbsync').toLowerCase();
        if (backend === 'dbsync') return dbSyncService;
        if (backend === 'yaci') return yaciHistoryService;
        throw new Error(`Unsupported HISTORY_BACKEND: ${backend}`);
      },
    },
    ConnectionService,
    ChannelService,
    PacketService,
    DenomTraceService,
    BridgeManifestService,
  ],
  exports: [QueryService, HISTORY_SERVICE, ConnectionService, ChannelService, PacketService, DenomTraceService, BridgeManifestService],
})
export class QueryModule {}
