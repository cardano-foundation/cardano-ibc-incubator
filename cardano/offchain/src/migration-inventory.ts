import type { UTxO } from "@lucid-evolution/lucid";
import { DeploymentIbcTree } from "./deployment.ts";
import { computeIbcTreeWitnessRoot } from "./incremental_ibc_tree.ts";
import { escrowDatum } from "./shutdown.ts";
import { escrowShardName } from "./migration-transactions.ts";

/** Disposable acceleration only. Every witness is bound to a freshly read
 * registry root; a predicted transaction is never treated as confirmed. */
export class MigrationInventory {
  private tree = new DeploymentIbcTree();
  private names: string[] = [];
  private cursor = 0;
  private identity = "";
  private pending?: { name: string; root: string };
  readonly metrics = {
    scans: 0,
    entries: 0,
    trees: 0,
    proofs: 0,
    incrementalDeletes: 0,
  };

  async witness(
    identity: string,
    policy: string,
    expected: string,
    load: () => Promise<UTxO[]>,
  ) {
    if (this.identity === identity && this.pending?.root === expected) {
      await this.tree.remove(`escrowShards/${this.pending.name}`);
      this.cursor++;
      this.pending = undefined;
      this.metrics.incrementalDeletes++;
    }
    if (this.identity !== identity || await this.tree.getRoot() !== expected) {
      // Restart, competing executor, rollback or an unknown transition: discard
      // local progress and reconstruct exactly the authenticated remaining set.
      const tree = new DeploymentIbcTree();
      const names = new Set<string>();
      const candidates = await load();
      this.metrics.scans++;
      this.metrics.entries += candidates.length;
      this.metrics.trees++;
      for (const candidate of candidates) {
        const units = Object.keys(candidate.assets).filter((unit) =>
          unit.startsWith(policy)
        );
        if (!units.length) continue;
        const datum = escrowDatum(candidate);
        const name = escrowShardName(datum.channelId, datum.denom);
        if (
          units.length !== 1 || units[0] !== policy + name ||
          candidate.assets[units[0]] !== 1n || names.has(name)
        ) {
          throw new Error("Malformed or duplicated escrow inventory");
        }
        names.add(name);
        tree.set(`escrowShards/${name}`, "01");
      }
      if (await tree.getRoot() !== expected || !names.size) {
        throw new Error(
          "Indexer inventory does not match authenticated remaining escrow root; refresh canonical state",
        );
      }
      this.tree = tree;
      this.names = [...names].sort();
      this.cursor = 0;
      this.identity = identity;
      this.pending = undefined;
    }
    const name = this.names[this.cursor];
    if (!name) throw new Error("Authenticated inventory unexpectedly empty");
    const key = `escrowShards/${name}`;
    const siblings = await this.tree.getSiblings(key);
    this.metrics.proofs++;
    if (computeIbcTreeWitnessRoot(key, "01", siblings) !== expected) {
      throw new Error(
        "Cached inventory witness does not match canonical commitment",
      );
    }
    this.pending = { name, root: computeIbcTreeWitnessRoot(key, "", siblings) };
    return { name, siblings };
  }
}
