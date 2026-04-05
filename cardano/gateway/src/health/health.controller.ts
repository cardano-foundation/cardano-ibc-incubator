import { Controller, Get, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { MetricsService } from './metrics.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private metricsService: MetricsService,
    @InjectDataSource('gateway')
    private gatewayDataSource: DataSource,
    @InjectDataSource('history')
    private historyDataSource: DataSource,
  ) {}

  /**
   * Health check endpoint for all databases
   * GET /health
   */
  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([
      () => this.db.pingCheck('gateway_db', { connection: this.gatewayDataSource }),
      () => this.db.pingCheck('history_backend', { connection: this.historyDataSource }),
    ]);

    // Update Prometheus metrics based on health check results
    const gatewayHealthy = result.status === 'ok' && result.details?.gateway_db?.status === 'up';
    const historyHealthy = result.status === 'ok' && result.details?.history_backend?.status === 'up';

    this.metricsService.gatewayDbConnectionStatus.set(gatewayHealthy ? 1 : 0);
    this.metricsService.historyBackendConnectionStatus.set(historyHealthy ? 1 : 0);

    return result;
  }

  /**
   * Detailed database status endpoint
   * GET /health/db
   */
  @Get('db')
  async databaseHealth() {
    try {
      const gatewayConnected = this.gatewayDataSource.isInitialized;
      const historyConnected = this.historyDataSource.isInitialized;

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
