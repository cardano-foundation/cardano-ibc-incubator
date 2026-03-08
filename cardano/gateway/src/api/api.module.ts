import { Logger, Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ChannelService } from '~@/query/services/channel.service';
import { QueryModule } from '~@/query/query.module';
import { LucidModule } from '@shared/modules/lucid/lucid.module';
import { HttpModule } from '@nestjs/axios';
import { MiniProtocalsModule } from '@shared/modules/mini-protocals/mini-protocals.module';
import { MithrilModule } from '../shared/modules/mithril/mithril.module';
import { TxModule } from '~@/tx/tx.module';
import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { TransferPlannerService } from './transfer-planner.service';

@Module({
  imports: [QueryModule, TxModule, LucidModule, HttpModule, MiniProtocalsModule, MithrilModule],
  controllers: [ApiController],
  providers: [ChannelService, Logger, LocalOsmosisSwapPlannerService, TransferPlannerService],
})
export class ApiModule {}
