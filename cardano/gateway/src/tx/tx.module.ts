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

@Module({
  imports: [LucidModule, QueryModule, KupoModule],
  controllers: [TxController],
  providers: [ClientService, ConnectionService, ChannelService, PacketService, SubmissionService, TxEventsService, Logger],
})
export class TxModule {}
