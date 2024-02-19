import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IBCEventWatcherService } from './ibc-event-watcher.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsensusStateEvent } from './ibc-events';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([ConsensusStateEvent]),
  ],
  providers: [IBCEventWatcherService],
})
export class IBCEventWatcherModule {}
