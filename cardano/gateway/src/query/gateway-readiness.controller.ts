import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { GatewayReadinessService } from './services/gateway-readiness.service';

@Controller('health')
export class GatewayReadinessController {
  constructor(private readonly gatewayReadinessService: GatewayReadinessService) {}

  @Get('ready')
  async ready() {
    const status = await this.gatewayReadinessService.getReadinessStatus();
    if (status.status !== 'ready') {
      throw new ServiceUnavailableException(status);
    }
    return status;
  }
}
