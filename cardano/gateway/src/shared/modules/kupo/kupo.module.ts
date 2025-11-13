import { Module } from '@nestjs/common';
import { KupoService } from './kupo.service';
import { LucidModule } from '../lucid/lucid.module';

@Module({
  imports: [LucidModule],
  providers: [KupoService],
  exports: [KupoService],
})
export class KupoModule {}

