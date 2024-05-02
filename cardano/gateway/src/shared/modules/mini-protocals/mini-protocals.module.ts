import { Module, Logger } from '@nestjs/common';
import { MiniProtocalsService } from './mini-protocals.service';

@Module({
  providers: [MiniProtocalsService, Logger],
  exports: [MiniProtocalsService],
})
export class MiniProtocalsModule {}
