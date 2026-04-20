import { Logger, Module } from '@nestjs/common';
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
import { HealthModule } from '../health/health.module';
import { BridgeManifestService } from './services/bridge-manifest.service';
import { BridgeHistoryService } from './services/bridge-history.service';

@Module({
  imports: [
    LucidModule,
    KupoModule,
    MithrilModule,
    HealthModule,
  ],
  controllers: [QueryController],
  providers: [
    QueryService,
    Logger,
    BridgeHistoryService,
    {
      provide: HISTORY_SERVICE,
      useExisting: BridgeHistoryService,
    },
    MiniProtocalsService,
    ConnectionService,
    ChannelService,
    PacketService,
    DenomTraceService,
    BridgeManifestService,
  ],
  exports: [
    QueryService,
    HISTORY_SERVICE,
    MiniProtocalsService,
    ConnectionService,
    ChannelService,
    PacketService,
    DenomTraceService,
    BridgeManifestService,
  ],
})
export class QueryModule {}
