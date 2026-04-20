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
      const bridgeHistory = historyConnected
        ? await this.fetchBridgeHistoryStatus()
        : {
            schemaVersion: null,
            cursor: null,
          };

      return {
        timestamp: new Date().toISOString(),
        gateway_db: {
          status: gatewayConnected ? 'healthy' : 'unhealthy',
          connection: gatewayConnected,
        },
        history_backend: {
          status: historyConnected ? 'healthy' : 'unhealthy',
          connection: historyConnected,
          bridge_history: bridgeHistory,
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

  private async fetchBridgeHistoryStatus(): Promise<{
    schemaVersion: string | null;
    cursor:
      | {
          lastBlock: number;
          lastBlockHash: string | null;
          lastSlot: number | null;
          updatedAt: string;
        }
      | null;
  }> {
    try {
      const schemaVersionRows = await this.historyDataSource.query(`
        SELECT version
        FROM bridge_schema_version
        ORDER BY applied_at DESC
        LIMIT 1
      `);
      const cursorRows = await this.historyDataSource.query(`
        SELECT last_block, last_block_hash, last_slot, updated_at
        FROM bridge_sync_cursor
        WHERE cursor_name = 'default'
        LIMIT 1
      `);

      return {
        schemaVersion: schemaVersionRows[0]?.version ?? null,
        cursor: cursorRows[0]
          ? {
              lastBlock: Number(cursorRows[0].last_block),
              lastBlockHash: cursorRows[0].last_block_hash ?? null,
              lastSlot:
                cursorRows[0].last_slot === null || cursorRows[0].last_slot === undefined
                  ? null
                  : Number(cursorRows[0].last_slot),
              updatedAt: new Date(cursorRows[0].updated_at).toISOString(),
            }
          : null,
      };
    } catch {
      return {
        schemaVersion: null,
        cursor: null,
      };
    }
  }
}
