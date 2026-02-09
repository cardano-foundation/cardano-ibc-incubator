import { Logger, Module } from '@nestjs/common';
import { TxController } from './tx.controller';
import { LucidModule } from 'src/shared/modules/lucid/lucid.module';
import { ClientService } from './client.service';
import { ChannelService } from './channel.service';
import { ConnectionService } from './connection.service';
import { PacketService } from './packet.service';
import { SubmissionService } from './submission.service';
import { QueryModule } from '../query/query.module';
import { TxEventsService } from './tx-events.service';
import { KupoModule } from 'src/shared/modules/kupo/kupo.module';
import { IbcTreeCacheService } from '../shared/services/ibc-tree-cache.service';
import { IbcTreePendingUpdatesService } from '../shared/services/ibc-tree-pending-updates.service';

@Module({
  imports: [LucidModule, QueryModule, KupoModule],
  controllers: [TxController],
  providers: [
    ClientService,
    ConnectionService,
    ChannelService,
    PacketService,
    SubmissionService,
    TxEventsService,
    IbcTreeCacheService,
    IbcTreePendingUpdatesService,
    Logger,
  ],
  exports: [IbcTreeCacheService, IbcTreePendingUpdatesService, PacketService],
})
export class TxModule {}
