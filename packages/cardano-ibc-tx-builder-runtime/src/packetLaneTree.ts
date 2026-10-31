import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import {
  IbcTreeNodeStore,
  verifyIbcTreeWitness,
  VersionedIbcTree,
} from "./incrementalIbcTree.ts";
import { keyHash } from "./ibcStateCommitment.ts";
import type {
  ICS23ExistenceProof,
  ICS23InnerOp,
  ICS23NonExistenceProof,
} from "./ics23MerkleTree.ts";

type Kind = "commitments" | "receipts" | "acks";
export type PacketTreeState = {
  root: string;
  indices: Record<Kind, string>;
  scope?: string;
};

function packetKey(
  key: string,
): { kind: Kind; scope: string; sequence: bigint } {
  const match =
    /^(commitments|receipts|acks)\/ports\/([^/]+)\/channels\/([^/]+)\/sequences\/([1-9][0-9]*)$/
      .exec(key);
  if (!match) throw new Error("Invalid packet tree key");
  const sequence = BigInt(match[4]);
  if (sequence > 0xffffffffffffffffn) {
    throw new Error("Invalid packet sequence");
  }
  return { kind: match[1] as Kind, scope: `${match[2]}/${match[3]}`, sequence };
}

/** Packet roots use the existing hashed paths. Separate persistent numeric
 * indices support sequence pages and counts without walking retained history.
 */
export class PacketMerkleTree {
  private primary: VersionedIbcTree;
  private indices: Record<Kind, VersionedIbcTree>;
  private scope?: string;

  constructor(
    readonly store = new IbcTreeNodeStore(new DatabaseSync(":memory:")),
    state?: PacketTreeState,
  ) {
    this.primary = new VersionedIbcTree(store, state?.root);
    this.scope = state?.scope;
    const index = (kind: Kind) =>
      new VersionedIbcTree(
        store,
        state?.indices[kind],
        (key) => packetKey(key).sequence,
      );
    this.indices = {
      commitments: index("commitments"),
      receipts: index("receipts"),
      acks: index("acks"),
    };
  }

  state(): PacketTreeState {
    return {
      root: this.getRoot(),
      scope: this.scope,
      indices: {
        commitments: this.indices.commitments.getRoot(),
        receipts: this.indices.receipts.getRoot(),
        acks: this.indices.acks.getRoot(),
      },
    };
  }

  clone(): PacketMerkleTree {
    return new PacketMerkleTree(this.store, this.state());
  }

  getRoot(): string {
    return this.primary.getRoot();
  }
  size(): number {
    return this.primary.size();
  }
  count(kind: Kind): number {
    return this.indices[kind].size();
  }
  countBefore(kind: Kind, sequence: bigint): number {
    return this.indices[kind].countBefore(sequence);
  }

  static sequenceAt(
    trees: readonly PacketMerkleTree[],
    kind: Kind,
    offset: number,
    reverse = false,
  ): bigint | undefined {
    return VersionedIbcTree.selectAcross(
      trees.map((tree) => tree.indices[kind]),
      offset,
      reverse,
    );
  }

  get(key: string): Buffer | undefined {
    const value = this.primary.get(key);
    return value === undefined ? undefined : Buffer.from(value, "hex");
  }

  set(key: string, value: string | Buffer): void {
    const parsed = packetKey(key);
    if (this.scope && this.scope !== parsed.scope) {
      throw new Error("Packet tree cannot mix channels");
    }
    const hex = typeof value === "string" ? value : value.toString("hex");
    const primary = this.primary.clone();
    const index = this.indices[parsed.kind].clone();
    this.store.db.exec("SAVEPOINT packet_tree_set");
    try {
      primary.set(key, hex);
      index.set(key, hex);
      this.store.db.exec("RELEASE packet_tree_set");
    } catch (error) {
      this.store.db.exec(
        "ROLLBACK TO packet_tree_set; RELEASE packet_tree_set",
      );
      throw error;
    }
    this.primary = primary;
    this.indices = { ...this.indices, [parsed.kind]: index };
    this.scope = parsed.scope;
  }

  getSiblings(key: string): Buffer[] {
    return this.primary.getSiblings(key).map((value) =>
      Buffer.from(value, "hex")
    );
  }

  entriesPage(
    kind: Kind,
    offset: number,
    limit: number,
    reverse = false,
  ): Array<[bigint, string]> {
    return this.indices[kind].page(offset, limit, reverse).map(
      ([key, value]) => {
        const parsed = packetKey(key);
        if (parsed.kind !== kind || parsed.scope !== this.scope) {
          throw new Error("Packet sequence index belongs to another domain");
        }
        if (this.primary.get(key) !== value) {
          throw new Error("Packet sequence index disagrees with its root");
        }
        return [parsed.sequence, value];
      },
    );
  }

  /** Explicit full enumeration for diagnostics/tests. Query paths use pages. */
  getKeys(): string[] {
    return this.primary.page(0, this.size()).map(([key]) => key);
  }

  generateProof(key: string): ICS23ExistenceProof {
    const value = this.get(key);
    if (!value) throw new Error("Packet key is absent");
    return this.proof(key, value);
  }

  generateNonExistenceProof(key: string): ICS23NonExistenceProof {
    if (this.get(key)) throw new Error("Packet key already exists");
    return {
      key: Buffer.from(key),
      left: this.proof(key, Buffer.alloc(0)),
      right: null,
    };
  }

  verifyProof(proof: ICS23ExistenceProof): boolean {
    try {
      if (!Buffer.from(proof.key.toString("utf8")).equals(proof.key)) {
        return false;
      }
      const witness: string[] = [];
      const path = [...proof.path];
      if (path.length === 65) {
        const bucket = path.shift()!;
        if (bucket.hash !== 1 || bucket.suffix.length !== 0) return false;
        witness.push(bucket.prefix.toString("hex"));
      }
      let index = keyHash(proof.key.toString("utf8")).readBigUInt64BE();
      if (path.length !== 64) return false;
      for (const operation of path) {
        if (operation.hash !== 1) return false;
        if ((index & 1n) === 0n) {
          if (
            !operation.prefix.equals(Buffer.from([1])) ||
            operation.suffix.length !== 32
          ) return false;
          witness.push(operation.suffix.toString("hex"));
        } else {
          if (
            operation.suffix.length || operation.prefix.length !== 33 ||
            operation.prefix[0] !== 1
          ) return false;
          witness.push(operation.prefix.subarray(1).toString("hex"));
        }
        index >>= 1n;
      }
      return verifyIbcTreeWitness(
        proof.key.toString("utf8"),
        proof.value.toString("hex"),
        witness,
        this.getRoot(),
      );
    } catch {
      return false;
    }
  }

  private proof(key: string, value: Buffer): ICS23ExistenceProof {
    const witness = this.getSiblings(key);
    const bucket = witness.length === 65 ? witness.shift() : undefined;
    const path: ICS23InnerOp[] = bucket
      ? [{ hash: 1, prefix: bucket, suffix: Buffer.alloc(0) }]
      : [];
    let index = keyHash(key).readBigUInt64BE();
    for (const sibling of witness) {
      path.push(
        (index & 1n) === 0n
          ? { hash: 1, prefix: Buffer.from([1]), suffix: sibling }
          : {
            hash: 1,
            prefix: Buffer.concat([Buffer.from([1]), sibling]),
            suffix: Buffer.alloc(0),
          },
      );
      index >>= 1n;
    }
    return {
      key: Buffer.from(key),
      value,
      leaf: {
        hash: 1,
        prehash_key: 0,
        prehash_value: 0,
        length: 0,
        prefix: Buffer.alloc(0),
      },
      path,
    };
  }
}

export class PacketLaneTree {
  constructor(readonly tree = new PacketMerkleTree()) {}
  set(key: string, value: string) {
    this.tree.set(key, value);
  }
  get(key: string) {
    return this.tree.get(key)?.toString("hex");
  }
  getRoot() {
    return this.tree.getRoot();
  }
  getSiblings(key: string) {
    return this.tree.getSiblings(key).map((value) => value.toString("hex"));
  }
  clone() {
    return new PacketLaneTree(this.tree.clone());
  }
}
