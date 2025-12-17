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
    @InjectDataSource('dbsync')
    private dbsyncDataSource: DataSource,
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
      () => this.db.pingCheck('dbsync', { connection: this.dbsyncDataSource }),
    ]);

    // Update Prometheus metrics based on health check results
    const gatewayHealthy = result.status === 'ok' && result.details?.gateway_db?.status === 'up';
    const dbsyncHealthy = result.status === 'ok' && result.details?.dbsync?.status === 'up';

    this.metricsService.gatewayDbConnectionStatus.set(gatewayHealthy ? 1 : 0);
    this.metricsService.dbSyncConnectionStatus.set(dbsyncHealthy ? 1 : 0);

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
      const dbsyncConnected = this.dbsyncDataSource.isInitialized;

      // Get denom trace count
      let denomTraceCount = 0;
      try {
        const result = await this.gatewayDataSource.query(
          'SELECT COUNT(*) as count FROM denom_traces',
        );
        denomTraceCount = parseInt(result[0]?.count || '0', 10);
        
        // Update Prometheus gauge
        this.metricsService.denomTraceCount.set(denomTraceCount);
      } catch (error) {
        this.logger.error(`Failed to get denom trace count: ${error.message}`);
      }

      return {
        timestamp: new Date().toISOString(),
        gateway_db: {
          status: gatewayConnected ? 'healthy' : 'unhealthy',
          connection: gatewayConnected,
          denom_traces_count: denomTraceCount,
        },
        dbsync: {
          status: dbsyncConnected ? 'healthy' : 'unhealthy',
          connection: dbsyncConnected,
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
        dbsync: {
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
