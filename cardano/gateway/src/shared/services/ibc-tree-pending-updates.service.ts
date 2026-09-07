import { Inject, Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../../health/metrics.service';
import { BoundedCache } from '../helpers/bounded-cache';
import { IbcTreeHostStateRef, StateRootResult } from '../helpers/ibc-state-root';

export const PENDING_TREE_UPDATE_CACHE_MAX_ENTRIES = 256;
export const PENDING_TREE_UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;

const PENDING_TREE_UPDATE_CACHE_METRIC = 'ibc_tree_pending_updates';

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: StateRootResult['commit'];
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
   * Keep the exact entry retryable until the live-chain check succeeds.
   * A stale publication still acknowledges the confirmed historical snapshot.
   */
  async commit(
    txHash: string,
    expectedUpdate: PendingTreeUpdate,
    hostState: IbcTreeHostStateRef,
  ): Promise<Awaited<ReturnType<PendingTreeUpdate['commit']>> | undefined> {
    if (!txHash) return undefined;
    const key = txHash.toLowerCase();
    const update = this.pendingByTxHash.get(key);
    if (update !== expectedUpdate) return undefined;

    const result = await update.commit(hostState);
    // Expiry or eviction while the live lookup awaited cannot undo confirmation.
    // Leave any replacement entry intact but return the successful result.
    this.pendingByTxHash.deleteIfValue(key, update);
    return result;
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
    return this.pendingByTxHash.findAndTake((update) => update.expectedNewRoot === expectedNewRoot);
  }
}
