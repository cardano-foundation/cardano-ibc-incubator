import { Logger, Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { QueryModule } from '~@/query/query.module';
import { LucidModule } from '@shared/modules/lucid/lucid.module';
import { HttpModule } from '@nestjs/axios';
import { MithrilModule } from '../shared/modules/mithril/mithril.module';
import { TxModule } from '~@/tx/tx.module';
import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { CheqdIcqService } from './cheqd-icq.service';
import { TransferPlannerService } from './transfer-planner.service';
import { PlannerClientService } from './planner-client.service';

@Module({
  imports: [QueryModule, TxModule, LucidModule, HttpModule, MithrilModule],
  controllers: [ApiController],
  providers: [
    Logger,
    CheqdIcqService,
    PlannerClientService,
    LocalOsmosisSwapPlannerService,
    TransferPlannerService,
  ],
})
export class ApiModule {}
