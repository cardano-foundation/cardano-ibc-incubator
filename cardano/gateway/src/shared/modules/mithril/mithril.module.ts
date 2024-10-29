import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MithrilService } from './mithril.service';

@Module({
  imports: [HttpModule],
  providers: [MithrilService],
  exports: [MithrilService],
})
export class MithrilModule {}
