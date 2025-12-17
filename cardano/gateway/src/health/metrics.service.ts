import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram, Gauge, register, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // Denom Trace Metrics
  public readonly denomTraceSavesTotal: Counter;
  public readonly denomTraceSaveErrorsTotal: Counter;
  public readonly denomTraceQueryDuration: Histogram;
  public readonly denomTraceCount: Gauge;

  // Database Connection Metrics
  public readonly gatewayDbConnectionStatus: Gauge;
  public readonly dbSyncConnectionStatus: Gauge;

  constructor() {
    // Enable default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ prefix: 'gateway_' });

    // Denom Trace Metrics
    this.denomTraceSavesTotal = new Counter({
      name: 'gateway_denom_trace_saves_total',
      help: 'Total number of denom trace saves attempted',
      labelNames: ['status'], // success, error, duplicate
    });

    this.denomTraceSaveErrorsTotal = new Counter({
      name: 'gateway_denom_trace_save_errors_total',
      help: 'Total number of denom trace save errors',
      labelNames: ['error_type'],
    });

    this.denomTraceQueryDuration = new Histogram({
      name: 'gateway_denom_trace_query_duration_seconds',
      help: 'Duration of denom trace queries in seconds',
      labelNames: ['operation'], // findByHash, findAll, findByBaseDenom
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    });

    this.denomTraceCount = new Gauge({
      name: 'gateway_denom_trace_count',
      help: 'Current number of denom traces in database',
    });

    // Database Connection Metrics
    this.gatewayDbConnectionStatus = new Gauge({
      name: 'gateway_db_connection_status',
      help: 'Gateway database connection status (1 = connected, 0 = disconnected)',
    });

    this.dbSyncConnectionStatus = new Gauge({
      name: 'gateway_dbsync_connection_status',
      help: 'DB-Sync database connection status (1 = connected, 0 = disconnected)',
    });

    this.logger.log('Metrics service initialized');
  }

  /**
   * Get all metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Get content type for Prometheus scraping
   */
  getContentType(): string {
    return register.contentType;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetMetrics(): void {
    register.clear();
    this.logger.warn('All metrics have been reset');
  }
}
