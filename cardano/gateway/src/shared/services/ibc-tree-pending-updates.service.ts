import { Injectable } from '@nestjs/common';
import { MAX_RETAINED_PREPARED_TRANSITIONS } from './ibc-tree-cache.service';

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: () => void;
};

type PendingTreeUpdateEntry = {
  update: PendingTreeUpdate;
  expiresAt: number;
};

// The process-local closure cache is disposable because every state-changing
// delta is already durable before registration. Its TTL does not delete the
// authoritative journal row.
export const PENDING_TREE_UPDATE_RETENTION_MS = 10 * 60 * 1000;
export const MAX_PENDING_TREE_UPDATES = MAX_RETAINED_PREPARED_TRANSITIONS;

@Injectable()
export class IbcTreePendingUpdatesService {
  // This map is only a process-local fast path. The durable journal is the
  // authoritative restart/submission fallback, so refusing a new cache entry
  // at the bound does not make the corresponding transaction unrecoverable.
  private readonly pendingByTxHash = new Map<string, PendingTreeUpdateEntry>();

  private pruneExpired(now = Date.now()): void {
    for (const [txHash, entry] of this.pendingByTxHash.entries()) {
      if (entry.expiresAt <= now) this.pendingByTxHash.delete(txHash);
    }
  }

  register(txHash: string, update: PendingTreeUpdate): void {
    if (!txHash) return;
    const key = txHash.toLowerCase();
    const now = Date.now();
    this.pruneExpired(now);
    if (!this.pendingByTxHash.has(key) && this.pendingByTxHash.size >= MAX_PENDING_TREE_UPDATES) {
      return;
    }
    this.pendingByTxHash.set(key, { update, expiresAt: now + PENDING_TREE_UPDATE_RETENTION_MS });
  }

  take(txHash: string): PendingTreeUpdate | undefined {
    if (!txHash) return undefined;
    this.pruneExpired();
    const key = txHash.toLowerCase();
    const entry = this.pendingByTxHash.get(key);
    if (entry) {
      this.pendingByTxHash.delete(key);
    }
    return entry?.update;
  }

  takeByExpectedRoot(expectedNewRoot: string): PendingTreeUpdate | undefined {
    if (!expectedNewRoot) return undefined;
    this.pruneExpired();
    // Hash-based lookup can miss when external signers alter final body shape.
    // Root matching remains strict because expectedNewRoot is derived from the
    // exact in-memory tree mutation we prepared before signing.
    for (const [key, entry] of this.pendingByTxHash.entries()) {
      if (entry.update.expectedNewRoot === expectedNewRoot) {
        this.pendingByTxHash.delete(key);
        return entry.update;
      }
    }
    return undefined;
  }
}
