import { Buffer } from "node:buffer";
import {
  type BucketEntry, keyHash as keyDigest, bucketHash, sortBucket, hash,
  encodeBucket, needsBucketWitness, witnessLeaf,
} from "./ibcStateCommitment.ts";
import type { DatabaseSync, StatementSync } from "node:sqlite";

const DEPTH = 64;
const EMPTY_HASH = "00".repeat(32);
const ROOT_PATH = "0000000000000000";

const pathHex = (index: bigint): string => index.toString(16).padStart(16, "0");

function normalizeValue(valueHex: string): string {
  if (
    typeof valueHex !== "string" || valueHex.length % 2 !== 0 ||
    /[^0-9a-fA-F]/.test(valueHex)
  ) {
    throw new Error("IBC tree value must be even-length byte hex");
  }
  return valueHex.toLowerCase();
}

function innerHash(left: string, right: string): string {
  if (left === EMPTY_HASH && right === EMPTY_HASH) return EMPTY_HASH;
  return hash(Buffer.concat([Buffer.from([1]), Buffer.from(left, "hex"), Buffer.from(right, "hex")])).toString("hex");
}

/** Pure membership/exclusion check; malformed inputs throw, mismatch is false. */
export function computeIbcTreeWitnessRoot(
  key: string,
  valueHex: string,
  siblings: readonly string[],
): string {
  const digest = keyDigest(key);
  const value = normalizeValue(valueHex);
  if (!Array.isArray(siblings)) throw new Error("IBC tree witness must be an array");
  const witness = siblings.map((encoded) => Buffer.from(normalizeValue(encoded), "hex"));
  const { leaf, siblings: path } = witnessLeaf(digest, Buffer.from(value, "hex"), witness);
  let index = digest.readBigUInt64BE();
  let current = leaf.toString("hex");
  for (const bytes of path) {
    const encoded = bytes.toString("hex");
    const sibling = normalizeValue(encoded);
    if (sibling.length !== 64) {
      throw new Error("IBC tree sibling must be 32-byte hex");
    }
    current = (index & 1n) === 0n
      ? innerHash(current, sibling)
      : innerHash(sibling, current);
    index >>= 1n;
  }
  return current;
}

export function verifyIbcTreeWitness(
  key: string,
  valueHex: string,
  siblings: readonly string[],
  expectedRoot: string,
): boolean {
  const root = normalizeValue(expectedRoot);
  if (root.length !== 64) throw new Error("IBC tree root must be 32-byte hex");
  return computeIbcTreeWitnessRoot(key, valueHex, siblings) === root;
}

/**
 * Persistent, incremental version of DeploymentIbcTree's SHA-256 depth-64 tree.
 * Node coordinates are fixed-width hexadecimal TEXT, avoiding SQLite's signed
 * integer limit for unsigned 64-bit paths. Keys are UTF-8 BLOBs so embedded NUL
 * characters survive SQLite bindings. Empty subtrees occupy no rows.
 *
 * The caller owns the database and its lifecycle/transactions. Construct this
 * tree before beginning a transaction whose rollback must preserve the schema.
 * set() is atomic using a nested savepoint; it never commits a caller's outer
 * transaction. Nothing is cached, so external rollback is immediately visible.
 * With concurrent database writers, the caller must wrap related root/value/
 * witness reads in one transaction to obtain a consistent SQLite snapshot.
 * assertIntegrity() checks this disposable cache's internal consistency in a
 * read-only snapshot. It does not authenticate its root against chain state;
 * callers must do that separately, and recheck after external database writes.
 */
export class IncrementalIbcTree {
  private readonly leavesAtPath: StatementSync;
  private readonly leafByKey: StatementSync;
  private readonly nodeAtPath: StatementSync;
  private readonly upsertLeaf: StatementSync;
  private readonly deleteLeaf: StatementSync;
  private readonly upsertNode: StatementSync;
  private readonly deleteNode: StatementSync;
  private readonly allLeaves: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ibc_tree_leaves (
        key BLOB PRIMARY KEY,
        path TEXT NOT NULL CHECK (
          length(path) = 16 AND path NOT GLOB '*[^0-9a-f]*'
        ),
        value TEXT NOT NULL CHECK (
          length(value) > 0 AND length(value) % 2 = 0
          AND value NOT GLOB '*[^0-9a-f]*'
        )
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ibc_tree_nodes (
        height INTEGER NOT NULL CHECK (height BETWEEN 0 AND 64),
        path TEXT NOT NULL CHECK (
          length(path) = 16 AND path NOT GLOB '*[^0-9a-f]*'
        ),
        hash TEXT NOT NULL CHECK (
          length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'
          AND hash != '${EMPTY_HASH}'
        ),
        PRIMARY KEY (height, path)
      ) STRICT;
    `);
    this.migrateLeafPaths();
    db.exec("CREATE INDEX IF NOT EXISTS ibc_tree_leaf_paths ON ibc_tree_leaves(path)");
    this.leavesAtPath = db.prepare("SELECT key, value FROM ibc_tree_leaves WHERE path = ?");
    this.leafByKey = db.prepare("SELECT value FROM ibc_tree_leaves WHERE key = ?");
    this.nodeAtPath = db.prepare(
      "SELECT hash FROM ibc_tree_nodes WHERE height = ? AND path = ?",
    );
    this.upsertLeaf = db.prepare(
      "INSERT INTO ibc_tree_leaves (key, path, value) VALUES (?, ?, ?) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    );
    this.deleteLeaf = db.prepare("DELETE FROM ibc_tree_leaves WHERE key = ?");
    this.upsertNode = db.prepare(
      "INSERT INTO ibc_tree_nodes (height, path, hash) VALUES (?, ?, ?) " +
        "ON CONFLICT (height, path) DO UPDATE SET hash = excluded.hash",
    );
    this.deleteNode = db.prepare(
      "DELETE FROM ibc_tree_nodes WHERE height = ? AND path = ?",
    );
    this.allLeaves = db.prepare(
      "SELECT key, value FROM ibc_tree_leaves ORDER BY key",
    );
  }

  getRoot(): string {
    return this.nodeAtPath.get(DEPTH, ROOT_PATH)?.hash as string ?? EMPTY_HASH;
  }

  get(key: string): string | undefined {
    this.bucketAtPath(keyDigest(key).readBigUInt64BE());
    return this.leafByKey.get(Buffer.from(key, "utf8"))?.value as string | undefined;
  }

  entries(): Array<[string, string]> {
    return this.allLeaves.all().map((row) => [
      Buffer.from(row.key as Uint8Array).toString("utf8"),
      row.value as string,
    ]);
  }

  /**
   * Verify every leaf and every stored node, including the root. Ordered SQLite
   * index scans use constant JS memory and O(stored nodes) hashing; this belongs
   * at database open/recovery, not on the warm set() path. No cache is repaired
   * from potentially corrupted leaves. The caller's transaction is preserved.
   */
  assertIntegrity(): void {
    this.db.exec("SAVEPOINT ibc_tree_integrity");
    try {
      this.checkIntegrity();
      this.db.exec("RELEASE ibc_tree_integrity");
    } catch (cause) {
      this.db.exec(
        "ROLLBACK TO ibc_tree_integrity; RELEASE ibc_tree_integrity",
      );
      throw new Error(
        "IBC tree cache integrity check failed; rebuild the disposable cache " +
          "from authenticated chain history before using it",
        { cause },
      );
    }
  }

  /** Leaf-to-root siblings, including a valid exclusion witness for absent keys. */
  getSiblings(key: string): string[] {
    const digest = keyDigest(key);
    let index = digest.readBigUInt64BE();
    const bucket = this.bucketAtPath(index);
    const siblings: string[] = needsBucketWitness(bucket, digest) ? [encodeBucket(bucket).toString("hex")] : [];
    for (let height = 0; height < DEPTH; height++) {
      siblings.push(this.nodeHash(height, index ^ 1n));
      index >>= 1n;
    }
    return siblings;
  }

  /** Empty hex deletes a leaf. Each mutation recomputes only its 64 ancestors. */
  set(key: string, valueHex: string): void {
    const digest = keyDigest(key);
    const value = normalizeValue(valueHex);
    let index = digest.readBigUInt64BE();
    this.db.exec("SAVEPOINT ibc_tree_set");
    try {
      const previous = this.get(key);
      if ((previous ?? "") !== value) {
        if (value === "") this.deleteLeaf.run(Buffer.from(key, "utf8"));
        else {this.upsertLeaf.run(
            Buffer.from(key, "utf8"),
            pathHex(index),
            value,
          );}

        let current = bucketHash(this.bucketAtPath(index)).toString("hex");
        this.storeNode(0, index, current);
        for (let height = 0; height < DEPTH; height++) {
          const sibling = this.nodeHash(height, index ^ 1n);
          current = (index & 1n) === 0n
            ? innerHash(current, sibling)
            : innerHash(sibling, current);
          index >>= 1n;
          this.storeNode(height + 1, index, current);
        }
      }
      this.db.exec("RELEASE ibc_tree_set");
    } catch (error) {
      this.db.exec("ROLLBACK TO ibc_tree_set; RELEASE ibc_tree_set");
      throw error;
    }
  }

  private bucketAtPath(index: bigint): BucketEntry[] {
    const entries = this.leavesAtPath.all(pathHex(index)).map((row) => ({
      keyHash: keyDigest(Buffer.from(row.key as Uint8Array).toString("utf8")),
      valueHash: hash(Buffer.from(row.value as string, "hex")),
    }));
    if (entries.some((entry) => entry.keyHash.readBigUInt64BE() !== index)) {
      throw new Error("IBC tree leaf path does not match its key hash");
    }
    return sortBucket(entries);
  }

  // Earlier disposable caches made the truncated path UNIQUE. Remove only that
  // constraint, preserving all leaves and nodes inside a nested transaction.
  private migrateLeafPaths(): void {
    const hasUniquePath = this.db.prepare("PRAGMA index_list(ibc_tree_leaves)").all().some((row) => {
      if (!row.unique) return false;
      const columns = this.db.prepare(`PRAGMA index_info("${String(row.name).replaceAll('"', '""')}")`).all();
      return columns.length === 1 && columns[0].name === "path";
    });
    if (!hasUniquePath) return;
    this.db.exec("SAVEPOINT ibc_tree_bucket_schema");
    try {
      this.db.exec(`
        CREATE TABLE ibc_tree_leaves_buckets (
          key BLOB PRIMARY KEY,
          path TEXT NOT NULL CHECK (length(path) = 16 AND path NOT GLOB '*[^0-9a-f]*'),
          value TEXT NOT NULL CHECK (length(value) > 0 AND length(value) % 2 = 0 AND value NOT GLOB '*[^0-9a-f]*')
        ) STRICT;
        INSERT INTO ibc_tree_leaves_buckets SELECT key, path, value FROM ibc_tree_leaves;
        DROP TABLE ibc_tree_leaves;
        ALTER TABLE ibc_tree_leaves_buckets RENAME TO ibc_tree_leaves;
      `);
      this.db.exec("RELEASE ibc_tree_bucket_schema");
    } catch (error) {
      this.db.exec("ROLLBACK TO ibc_tree_bucket_schema; RELEASE ibc_tree_bucket_schema");
      throw error;
    }
  }

  private checkIntegrity(): void {
    // Comparing the complete ordered node sequence, rather than only checking
    // each existing parent's children, also detects missing parents and orphans.
    const nodes = this.db.prepare(
      "SELECT height, path, hash FROM ibc_tree_nodes ORDER BY height, path",
    ).iterate();
    try {
      let next = nodes.next();
      const expectNode = (height: number, path: string, digest: string) => {
        if (
          next.done || next.value.height !== height ||
          next.value.path !== path || next.value.hash !== digest
        ) {
          throw new Error(
            `Inconsistent tree node at height ${height}, ${path}`,
          );
        }
        next = nodes.next();
      };

      let bucketPath: string | undefined;
      let bucket: BucketEntry[] = [];
      for (
        const leaf of this.db.prepare(
          "SELECT key, path, value FROM ibc_tree_leaves ORDER BY path",
        ).iterate()
      ) {
        if (!(leaf.key instanceof Uint8Array)) {
          throw new Error("Invalid tree leaf key encoding");
        }
        const rawKey = Buffer.from(leaf.key);
        const key = rawKey.toString("utf8");
        if (!Buffer.from(key, "utf8").equals(rawKey)) {
          throw new Error("Invalid tree leaf UTF-8");
        }
        const digest = keyDigest(key);
        const path = pathHex(digest.readBigUInt64BE());
        if (leaf.path !== path) {
          throw new Error("Malformed or colliding tree leaf path");
        }
        const value = normalizeValue(leaf.value as string);
        if (value === "" || value !== leaf.value) {
          throw new Error("Invalid tree leaf value encoding");
        }
        if (path !== bucketPath) {
          if (bucketPath !== undefined) expectNode(0, bucketPath, bucketHash(sortBucket(bucket)).toString("hex"));
          bucketPath = path;
          bucket = [];
        }
        bucket.push({ keyHash: digest, valueHash: hash(Buffer.from(value, "hex")) });
      }
      if (bucketPath !== undefined) expectNode(0, bucketPath, bucketHash(sortBucket(bucket)).toString("hex"));

      const children = this.db.prepare(
        "SELECT path, hash FROM ibc_tree_nodes WHERE height = ? ORDER BY path",
      );
      for (let height = 1; height <= DEPTH; height++) {
        let parent: bigint | undefined;
        let left = EMPTY_HASH;
        let right = EMPTY_HASH;
        for (const child of children.iterate(height - 1)) {
          // The preceding level has already matched the entire expected
          // sequence, so these child coordinates and digests are validated.
          const index = BigInt(`0x${child.path}`);
          const childParent = index >> 1n;
          if (parent !== childParent) {
            if (parent !== undefined) {
              expectNode(height, pathHex(parent), innerHash(left, right));
            }
            parent = childParent;
            left = EMPTY_HASH;
            right = EMPTY_HASH;
          }
          if ((index & 1n) === 0n) left = child.hash as string;
          else right = child.hash as string;
        }
        if (parent !== undefined) {
          expectNode(height, pathHex(parent), innerHash(left, right));
        }
      }
      if (!next.done) throw new Error("Unexpected extra tree node");
    } finally {
      nodes.return?.();
    }
  }

  private nodeHash(height: number, index: bigint): string {
    return this.nodeAtPath.get(height, pathHex(index))?.hash as string ??
      EMPTY_HASH;
  }

  private storeNode(height: number, index: bigint, digest: string): void {
    if (digest === EMPTY_HASH) this.deleteNode.run(height, pathHex(index));
    else this.upsertNode.run(height, pathHex(index), digest);
  }
}

type VersionedNode = {
  height: number;
  left: string;
  right: string;
  entries: Array<[string, string]>;
  count: number;
};

/** Immutable SQLite nodes let lane versions share unchanged subtrees. */
export class IbcTreeNodeStore {
  private readonly select: StatementSync;
  private readonly insert: StatementSync;

  constructor(readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS ibc_versioned_nodes (
      hash TEXT PRIMARY KEY, height INTEGER NOT NULL,
      left_hash TEXT NOT NULL, right_hash TEXT NOT NULL,
      entries TEXT NOT NULL, count INTEGER NOT NULL
    ) STRICT`);
    this.select = db.prepare(
      "SELECT * FROM ibc_versioned_nodes WHERE hash = ?",
    );
    this.insert = db.prepare(
      "INSERT OR IGNORE INTO ibc_versioned_nodes VALUES (?, ?, ?, ?, ?, ?)",
    );
  }

  read(digest: string, height: number): VersionedNode | undefined {
    if (digest === EMPTY_HASH) return undefined;
    const row = this.select.get(digest);
    if (!row || row.height !== height) {
      throw new Error("Missing or corrupt incremental tree node");
    }
    const entries = JSON.parse(row.entries as string) as Array<
      [string, string]
    >;
    const node = {
      height,
      left: row.left_hash as string,
      right: row.right_hash as string,
      entries,
      count: Number(row.count),
    };
    const actual = height === 0
      ? this.bucketDigest(entries)
      : innerHash(node.left, node.right);
    if (
      actual !== digest || !Number.isSafeInteger(node.count) ||
      node.count < 1 || (height === 0 && node.count !== entries.length)
    ) {
      throw new Error("Corrupt incremental tree node");
    }
    if (height > 0) {
      const count = (child: string) => {
        if (child === EMPTY_HASH) return 0;
        const row = this.select.get(child);
        if (!row || row.height !== height - 1) {
          throw new Error("Missing incremental tree child");
        }
        return Number(row.count);
      };
      if (node.count !== count(node.left) + count(node.right)) {
        throw new Error("Corrupt incremental tree counts");
      }
    }
    return node;
  }

  write(node: VersionedNode): string {
    const digest = node.height === 0
      ? this.bucketDigest(node.entries)
      : innerHash(node.left, node.right);
    if (digest !== EMPTY_HASH) {
      this.insert.run(
        digest,
        node.height,
        node.left,
        node.right,
        JSON.stringify(node.entries),
        node.count,
      );
    }
    return digest;
  }

  private bucketDigest(entries: Array<[string, string]>): string {
    return bucketHash(
      sortBucket(
        entries.map(([key, value]) => ({
          keyHash: keyDigest(key),
          valueHash: hash(Buffer.from(normalizeValue(value), "hex")),
        })),
      ),
    ).toString("hex");
  }
}

/** The same depth-64 updates as IncrementalIbcTree, with immutable roots.
 * clone() copies one root pointer. Each mutation stores at most 65 new nodes.
 * An alternate path function supports a separate numeric sequence index.
 */
export class VersionedIbcTree {
  constructor(
    readonly store: IbcTreeNodeStore,
    private root = EMPTY_HASH,
    private readonly path: (key: string) => bigint = (key) =>
      keyDigest(key).readBigUInt64BE(),
  ) {}

  clone(): VersionedIbcTree {
    return new VersionedIbcTree(this.store, this.root, this.path);
  }

  getRoot(): string {
    return this.root;
  }

  size(): number {
    return this.store.read(this.root, DEPTH)?.count ?? 0;
  }

  get(key: string): string | undefined {
    return this.position(key).entries.find(([candidate]) => candidate === key)
      ?.[1];
  }

  getSiblings(key: string): string[] {
    const { entries, siblings } = this.position(key);
    const digest = keyDigest(key);
    const bucket = sortBucket(
      entries.map(([candidate, value]) => ({
        keyHash: keyDigest(candidate),
        valueHash: hash(Buffer.from(value, "hex")),
      })),
    );
    return needsBucketWitness(bucket, digest)
      ? [encodeBucket(bucket).toString("hex"), ...siblings]
      : siblings;
  }

  set(key: string, valueHex: string): void {
    const value = normalizeValue(valueHex);
    const { entries, siblings } = this.position(key);
    const previous = entries.find(([candidate]) => candidate === key)?.[1] ??
      "";
    if (previous === value) return;
    const next = entries.filter(([candidate]) => candidate !== key);
    if (value !== "") next.push([key, value]);
    next.sort(([a], [b]) => Buffer.compare(keyDigest(a), keyDigest(b)));
    let index = this.path(key);
    let count = next.length;
    // Publishing the pointer last makes failed updates leave this version intact.
    let current = this.store.write({
      height: 0,
      left: EMPTY_HASH,
      right: EMPTY_HASH,
      entries: next,
      count,
    });
    for (let height = 0; height < DEPTH; height++) {
      const sibling = siblings[height];
      count += this.store.read(sibling, height)?.count ?? 0;
      const left = (index & 1n) === 0n ? current : sibling;
      const right = (index & 1n) === 0n ? sibling : current;
      current = this.store.write({
        height: height + 1,
        left,
        right,
        entries: [],
        count,
      });
      index >>= 1n;
    }
    this.root = current;
  }

  /** Ordered subtree counts skip offsets without enumerating preceding keys. */
  page(
    offset: number,
    limit: number,
    reverse = false,
  ): Array<[string, string]> {
    if (
      !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limit) || limit < 0
    ) throw new Error("Invalid tree page");
    const result: Array<[string, string]> = [];
    const walk = (digest: string, height: number) => {
      if (result.length >= limit) return;
      const node = this.store.read(digest, height);
      if (!node) return;
      if (offset >= node.count) {
        offset -= node.count;
        return;
      }
      if (height === 0) {
        const entries = reverse ? [...node.entries].reverse() : node.entries;
        for (const entry of entries) {
          if (offset) offset--;
          else if (result.length < limit) result.push(entry);
        }
      } else {
        walk(reverse ? node.right : node.left, height - 1);
        walk(reverse ? node.left : node.right, height - 1);
      }
    };
    walk(this.root, DEPTH);
    return result;
  }

  countBefore(index: bigint): number {
    if (index <= 0n) return 0;
    if (index > 0xffffffffffffffffn) return this.size();
    let digest = this.root;
    let count = 0;
    for (let height = DEPTH; height > 0; height--) {
      const node = this.store.read(digest, height);
      if (!node) return count;
      if ((index >> BigInt(height - 1)) & 1n) {
        count += this.store.read(node.left, height - 1)?.count ?? 0;
        digest = node.right;
      } else digest = node.left;
    }
    return count;
  }

  /** Select a rank across independent numeric indices in O(lanes * depth). */
  static selectAcross(
    trees: readonly VersionedIbcTree[],
    offset: number,
    reverse = false,
  ): bigint | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Invalid tree rank");
    }
    if (offset >= trees.reduce((count, tree) => count + tree.size(), 0)) {
      return undefined;
    }
    let roots = trees.map((tree) => tree.root);
    let index = 0n;
    for (let height = DEPTH; height > 0; height--) {
      const nodes = trees.map((tree, i) => tree.store.read(roots[i], height));
      const firstCount = trees.reduce(
        (count, tree, i) =>
          count +
          (tree.store.read(
            (reverse ? nodes[i]?.right : nodes[i]?.left) ?? EMPTY_HASH,
            height - 1,
          )?.count ?? 0),
        0,
      );
      const first = offset < firstCount;
      if (!first) offset -= firstCount;
      const right = reverse ? first : !first;
      index = (index << 1n) | (right ? 1n : 0n);
      roots = nodes.map((node) =>
        (right ? node?.right : node?.left) ?? EMPTY_HASH
      );
    }
    if (
      offset >= trees.reduce((count, tree, i) =>
        count + (tree.store.read(roots[i], 0)?.count ?? 0), 0)
    ) throw new Error("Corrupt tree rank counts");
    return index;
  }

  private position(
    key: string,
  ): { entries: Array<[string, string]>; siblings: string[] } {
    const index = this.path(key);
    if (index < 0n || index > 0xffffffffffffffffn) {
      throw new Error("Invalid tree path");
    }
    let digest = this.root;
    const siblings: string[] = [];
    for (let height = DEPTH; height > 0; height--) {
      const node = this.store.read(digest, height);
      const right = ((index >> BigInt(height - 1)) & 1n) !== 0n;
      siblings.push(node ? (right ? node.left : node.right) : EMPTY_HASH);
      digest = node ? (right ? node.right : node.left) : EMPTY_HASH;
    }
    const entries = this.store.read(digest, 0)?.entries ?? [];
    if (entries.some(([candidate]) => this.path(candidate) !== index)) {
      throw new Error("Incremental tree bucket belongs to another path");
    }
    return { entries, siblings: siblings.reverse() };
  }
}
