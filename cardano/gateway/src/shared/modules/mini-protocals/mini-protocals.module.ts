import { HttpModule } from '@nestjs/axios';
import { Module, Logger } from '@nestjs/common';
import { MiniProtocalsService } from './mini-protocals.service';

@Module({
  imports: [HttpModule],
  providers: [MiniProtocalsService, Logger],
  exports: [MiniProtocalsService],
})
export class MiniProtocalsModule {}
