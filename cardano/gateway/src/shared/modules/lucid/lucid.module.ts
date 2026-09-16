import { Module } from '@nestjs/common';
import { LucidService } from './lucid.service';
import { LucidClient, LucidImporter } from './lucid.provider';
import { ConsensusHistoryService } from './consensus-history.service';

@Module({
  providers: [LucidService, LucidClient, LucidImporter, ConsensusHistoryService],
  exports: [LucidService],
})
export class LucidModule {}
