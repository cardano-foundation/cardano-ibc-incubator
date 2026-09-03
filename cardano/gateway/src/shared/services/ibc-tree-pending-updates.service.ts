import { Injectable } from '@nestjs/common';
import type { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';

export type PendingTreeUpdate = {
  expectedNewRoot: string;
  commit: () => void;
  treeSnapshot?: ICS23MerkleTree;
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
    const matches = [...this.pendingByTxHash.entries()].filter(
      ([, update]) => update.expectedNewRoot === expectedNewRoot,
    );
    if (matches.length !== 1) {
      return undefined;
    }
    const [key, update] = matches[0];
    this.pendingByTxHash.delete(key);
    return update;
  }
}
