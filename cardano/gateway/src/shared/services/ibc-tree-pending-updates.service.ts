import { Injectable } from '@nestjs/common';

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: () => void;
  /** False for HostState transitions that verify but do not mutate the IBC tree. */
  persistTreeSnapshot?: boolean;
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
    // A root is a safe fallback identity only when it selects exactly one
    // pending transaction. Root-neutral HostState operations can legitimately
    // share a root, so never guess (or remove either record) when it is
    // ambiguous.
    const matches: Array<[string, PendingTreeUpdate]> = [];
    for (const [key, update] of this.pendingByTxHash.entries()) {
      if (update.expectedNewRoot === expectedNewRoot) {
        matches.push([key, update]);
      }
    }
    if (matches.length !== 1) return undefined;
    const [key, update] = matches[0];
    this.pendingByTxHash.delete(key);
    return update;
  }
}
