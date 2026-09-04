import { Inject, Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../../health/metrics.service';
import { BoundedCache } from '../helpers/bounded-cache';

export const PENDING_TREE_UPDATE_CACHE_MAX_ENTRIES = 256;
export const PENDING_TREE_UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;

const PENDING_TREE_UPDATE_CACHE_METRIC = 'ibc_tree_pending_updates';

export type PendingTreeUpdate = {
  /** `tree_neutral` is used by staged verification transactions. */
  kind?: 'tree_update' | 'tree_neutral';
  expectedNewRoot: string;
  commit: () => void;
};

@Injectable()
export class IbcTreePendingUpdatesService {
  private readonly pendingByTxHash: BoundedCache<string, PendingTreeUpdate>;

  constructor(@Optional() @Inject(MetricsService) metricsService?: MetricsService) {
    this.pendingByTxHash = new BoundedCache({
      maxEntries: PENDING_TREE_UPDATE_CACHE_MAX_ENTRIES,
      ttlMs: PENDING_TREE_UPDATE_CACHE_TTL_MS,
      onSizeChange: (size) => metricsService?.setCacheEntries(PENDING_TREE_UPDATE_CACHE_METRIC, size),
    });
  }

  register(txHash: string, update: PendingTreeUpdate): void {
    if (!txHash) return;
    this.pendingByTxHash.set(txHash.toLowerCase(), update);
  }

  peek(txHash: string): PendingTreeUpdate | undefined {
    if (!txHash) return undefined;
    return this.pendingByTxHash.get(txHash.toLowerCase());
  }

  /**
   * Commits and removes an exact pending entry as one synchronous operation.
   * Keeping the entry until commit succeeds makes observation retries safe if
   * the callback throws, while the identity check prevents a stale observer
   * from consuming a newer registration for the same transaction hash.
   */
  commit(txHash: string, expectedUpdate: PendingTreeUpdate): boolean {
    if (!txHash) return false;
    const key = txHash.toLowerCase();
    const update = this.pendingByTxHash.get(key);
    if (update !== expectedUpdate) return false;

    update.commit();
    return this.pendingByTxHash.deleteIfValue(key, update);
  }

  take(txHash: string): PendingTreeUpdate | undefined {
    if (!txHash) return undefined;
    return this.pendingByTxHash.take(txHash.toLowerCase());
  }

  takeByExpectedRoot(expectedNewRoot: string): PendingTreeUpdate | undefined {
    if (!expectedNewRoot) return undefined;
    // Hash-based lookup can miss when external signers alter final body shape.
    // Root matching remains strict because expectedNewRoot is derived from the
    // exact in-memory tree mutation we prepared before signing.
    return this.pendingByTxHash.findAndTake(
      (update) => update.kind !== 'tree_neutral' && update.expectedNewRoot === expectedNewRoot,
    );
  }
}
