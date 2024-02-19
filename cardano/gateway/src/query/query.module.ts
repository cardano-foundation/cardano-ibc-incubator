import { Logger, Module } from '@nestjs/common';
import { QueryService } from './query.service';
import { QueryController } from './query.controller';
import { EntityManager } from 'typeorm';
import { LucidModule } from '../shared/modules/lucid/lucid.module';

@Module({
  imports: [LucidModule],
  controllers: [QueryController],
  providers: [QueryService, Logger],
})
export class QueryModule {}
