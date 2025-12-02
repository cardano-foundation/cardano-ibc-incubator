import { Logger, Module } from '@nestjs/common';
import { TxController } from './tx.controller';
import { LucidModule } from 'src/shared/modules/lucid/lucid.module';
import { ClientService } from './client.service';
import { ChannelService } from './channel.service';
import { ConnectionService } from './connection.service';
import { PacketService } from './packet.service';
import { SubmissionService } from './submission.service';

@Module({
  imports: [LucidModule],
  controllers: [TxController],
  providers: [ClientService, ConnectionService, ChannelService, PacketService, SubmissionService, Logger],
})
export class TxModule {}
