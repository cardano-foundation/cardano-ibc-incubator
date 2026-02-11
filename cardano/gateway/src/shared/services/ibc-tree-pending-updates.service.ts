import { Injectable } from '@nestjs/common';

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: () => void;
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
    for (const [key, update] of this.pendingByTxHash.entries()) {
      if (update.expectedNewRoot === expectedNewRoot) {
        this.pendingByTxHash.delete(key);
        return update;
      }
    }
    return undefined;
  }
}
