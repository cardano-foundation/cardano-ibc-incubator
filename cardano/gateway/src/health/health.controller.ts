import { Controller, Get, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { MetricsService } from './metrics.service';
import { YaciRestClient } from '../shared/helpers/yaci-rest';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private metricsService: MetricsService,
    @InjectDataSource('gateway')
    private gatewayDataSource: DataSource,
    private config: ConfigService,
    private indicators: HealthIndicatorService,
  ) {}

  /**
   * Health check endpoint for the application database and Yaci REST
   * GET /health
   */
  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([
      () => this.db.pingCheck('gateway_db', { connection: this.gatewayDataSource }),
      async () => {
        const indicator = this.indicators.check('history_backend');
        return (await this.historyConnected()) ? indicator.up() : indicator.down();
      },
    ]);

    // Update Prometheus metrics based on health check results
    const gatewayHealthy = result.status === 'ok' && result.details?.gateway_db?.status === 'up';
    const historyHealthy = result.status === 'ok' && result.details?.history_backend?.status === 'up';

    this.metricsService.gatewayDbConnectionStatus.set(gatewayHealthy ? 1 : 0);
    this.metricsService.historyBackendConnectionStatus.set(historyHealthy ? 1 : 0);

    return result;
  }

  /**
   * Detailed database and history backend status endpoint
   * GET /health/db
   */
  @Get('db')
  async databaseHealth() {
    try {
      const gatewayConnected = this.gatewayDataSource.isInitialized;
      const historyConnected = await this.historyConnected();

      return {
        timestamp: new Date().toISOString(),
        gateway_db: {
          status: gatewayConnected ? 'healthy' : 'unhealthy',
          connection: gatewayConnected,
        },
        history_backend: {
          status: historyConnected ? 'healthy' : 'unhealthy',
          connection: historyConnected,
        },
      };
    } catch (error) {
      this.logger.error(`Database health check failed: ${error.message}`);
      return {
        timestamp: new Date().toISOString(),
        error: error.message,
        gateway_db: {
          status: 'error',
          connection: false,
        },
        history_backend: {
          status: 'error',
          connection: false,
        },
      };
    }
  }

  private async historyConnected(): Promise<boolean> {
    let connected = false;
    try {
      const client = new YaciRestClient(this.config.get<string>('yaciStoreEndpoint'), AbortSignal.timeout(5_000));
      connected = (await client.block('latest')) !== null;
    } catch {
      // Health responses must not expose provider URLs or credentials.
    }
    this.metricsService.historyBackendConnectionStatus.set(connected ? 1 : 0);
    return connected;
  }

  /**
   * Prometheus metrics endpoint
   * GET /health/metrics
   */
  @Get('metrics')
  async metrics() {
    const metrics = await this.metricsService.getMetrics();
    return metrics;
  }
}
