import { Injectable } from '@nestjs/common';

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: () => void;
};

@Injectable()
export class IbcTreePendingUpdatesService {
  private readonly pendingByTxHash = new Map<string, PendingTreeUpdate>();

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
   * the commit callback throws, while the identity check prevents a stale
   * observer from consuming a newer registration for the same transaction.
   */
  commit(txHash: string, expectedUpdate: PendingTreeUpdate): boolean {
    if (!txHash) return false;
    const key = txHash.toLowerCase();
    const update = this.pendingByTxHash.get(key);
    if (update !== expectedUpdate) return false;

    update.commit();
    this.pendingByTxHash.delete(key);
    return true;
  }

  take(txHash: string): PendingTreeUpdate | undefined {
    if (!txHash) return undefined;
    const key = txHash.toLowerCase();
    const update = this.pendingByTxHash.get(key);
    if (update) {
      this.pendingByTxHash.delete(key);
    }
    return update;
  }

  takeByExpectedRoot(expectedNewRoot: string): PendingTreeUpdate | undefined {
    if (!expectedNewRoot) return undefined;
    // Hash-based lookup can miss when external signers alter final body shape.
    // Root matching remains strict because expectedNewRoot is derived from the
    // exact in-memory tree mutation we prepared before signing.
    for (const [key, update] of this.pendingByTxHash.entries()) {
      if (update.expectedNewRoot === expectedNewRoot) {
        this.pendingByTxHash.delete(key);
        return update;
      }
    }
    return undefined;
  }
}
