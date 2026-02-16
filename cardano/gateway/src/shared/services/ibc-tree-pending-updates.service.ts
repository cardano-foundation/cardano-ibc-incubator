import { Injectable } from '@nestjs/common';

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: () => void;
  // Optional list of trace hashes created while building this tx.
  // Submission uses it to set tx_hash on those trace rows after submit.
  denomTraceHashes?: string[];
};

@Injectable()
export class IbcTreePendingUpdatesService {
  private readonly pendingByTxHash = new Map<string, PendingTreeUpdate>();

  register(txHash: string, update: PendingTreeUpdate): void {
    if (!txHash) return;
    this.pendingByTxHash.set(txHash.toLowerCase(), update);
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
