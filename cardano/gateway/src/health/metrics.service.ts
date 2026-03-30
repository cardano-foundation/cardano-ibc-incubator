import { Injectable, Logger } from '@nestjs/common';
import { Histogram, Gauge, register, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // Trace registry query metrics
  public readonly denomTraceQueryDuration: Histogram;

  // Database Connection Metrics
  public readonly gatewayDbConnectionStatus: Gauge;
  public readonly historyBackendConnectionStatus: Gauge;

  constructor() {
    // Enable default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ prefix: 'gateway_' });

    this.denomTraceQueryDuration = new Histogram({
      name: 'gateway_denom_trace_query_duration_seconds',
      help: 'Duration of on-chain voucher trace queries in seconds',
      labelNames: ['operation'], // findByHash, findAll, findByBaseDenom
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    });

    // Database Connection Metrics
    this.gatewayDbConnectionStatus = new Gauge({
      name: 'gateway_db_connection_status',
      help: 'Gateway database connection status (1 = connected, 0 = disconnected)',
    });

    this.historyBackendConnectionStatus = new Gauge({
      name: 'gateway_history_backend_connection_status',
      help: 'Historical backend database connection status (1 = connected, 0 = disconnected)',
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
