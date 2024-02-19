import { Module } from '@nestjs/common';
import { LucidService } from './lucid.service';
import { LucidClient, LucidImporter } from './lucid.provider';

@Module({
  providers: [LucidService, LucidClient, LucidImporter],
  exports: [LucidService],
})
export class LucidModule {}
