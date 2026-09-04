import { Inject, Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../health/metrics.service';
import { BoundedCache } from '../shared/helpers/bounded-cache';

export const TX_EVENTS_CACHE_MAX_ENTRIES = 1024;
export const TX_EVENTS_CACHE_TTL_MS = 60 * 60 * 1000;

const TX_EVENTS_BY_HASH_CACHE_METRIC = 'tx_events_by_hash';
const TX_EVENTS_BY_ROOT_CACHE_METRIC = 'tx_events_by_expected_root';

export type GatewayEventAttribute = {
  key: string;
  value: string;
};

export type GatewayEvent = {
  type: string;
  attributes: GatewayEventAttribute[];
};

type CachedGatewayEvents = {
  txHash: string;
  expectedRoot?: string;
  events: GatewayEvent[];
};

@Injectable()
export class TxEventsService {
  private readonly eventsByTxHash: BoundedCache<string, CachedGatewayEvents>;
  private readonly eventsByExpectedRoot = new Map<string, CachedGatewayEvents>();

  constructor(@Optional() @Inject(MetricsService) private readonly metricsService?: MetricsService) {
    this.eventsByTxHash = new BoundedCache({
      maxEntries: TX_EVENTS_CACHE_MAX_ENTRIES,
      ttlMs: TX_EVENTS_CACHE_TTL_MS,
      onEvict: (_txHash, cached) => this.removeExpectedRootAlias(cached),
      onSizeChange: (size) => this.metricsService?.setCacheEntries(TX_EVENTS_BY_HASH_CACHE_METRIC, size),
    });
    this.updateExpectedRootMetric();
  }

  register(txHash: string, events: GatewayEvent[], expectedRoot?: string): void {
    if (!txHash) return;
    // Hermes signs the unsigned CBOR, so the final tx hash changes.
    // We key by lowercased hash to maximize lookup success, but a synthetic
    // fallback is still used in SubmissionService if this cache misses.
    const key = txHash.toLowerCase();
    const rootKey = expectedRoot?.toLowerCase() || undefined;
    const cached = { txHash: key, expectedRoot: rootKey, events };
    this.eventsByTxHash.set(key, cached);
    if (rootKey) {
      this.eventsByExpectedRoot.set(rootKey, cached);
      this.updateExpectedRootMetric();
    }
  }

  take(txHash: string): GatewayEvent[] | undefined {
    const key = txHash.toLowerCase();
    return this.eventsByTxHash.take(key)?.events;
  }

  takeByExpectedRoot(expectedRoot: string): GatewayEvent[] | undefined {
    const key = expectedRoot.toLowerCase();
    const cached = this.eventsByExpectedRoot.get(key);
    if (!cached) return undefined;

    if (this.eventsByTxHash.get(cached.txHash) !== cached) {
      this.removeExpectedRootAlias(cached);
      return undefined;
    }
    return this.eventsByTxHash.take(cached.txHash)?.events;
  }

  private removeExpectedRootAlias(cached: CachedGatewayEvents): void {
    if (!cached.expectedRoot || this.eventsByExpectedRoot.get(cached.expectedRoot) !== cached) return;
    this.eventsByExpectedRoot.delete(cached.expectedRoot);
    this.updateExpectedRootMetric();
  }

  private updateExpectedRootMetric(): void {
    this.metricsService?.setCacheEntries(TX_EVENTS_BY_ROOT_CACHE_METRIC, this.eventsByExpectedRoot.size);
  }
}
