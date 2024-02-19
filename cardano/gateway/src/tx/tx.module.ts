import { Module } from '@nestjs/common';
import { TxController } from './tx.controller';
import { TxService } from './tx.service';
import { LucidModule } from 'src/shared/modules/lucid/lucid.module';

@Module({
  imports: [LucidModule],
  controllers: [TxController],
  providers: [TxService],
})
export class TxModule {}
