import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";

const DEPTH = 64;
const EMPTY_HASH = "00".repeat(32);
const ROOT_PATH = "0000000000000000";

const hash = (...parts: Uint8Array[]): Buffer => {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest();
};

const pathHex = (index: bigint): string => index.toString(16).padStart(16, "0");

function keyDigest(key: string): Buffer {
  // SQLite and SHA-256 must see exactly the same UTF-8 key, including when a
  // caller accidentally supplies an unpaired UTF-16 surrogate.
  if (
    typeof key !== "string" || Buffer.from(key, "utf8").toString("utf8") !== key
  ) {
    throw new Error("IBC tree key must be a well-formed UTF-8 string");
  }
  return hash(Buffer.from(key, "utf8"));
}

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
  return hash(
    Buffer.from([1]),
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  ).toString("hex");
}

function leafHash(digest: Buffer, value: string): string {
  return value === ""
    ? EMPTY_HASH
    : hash(Buffer.from([0]), digest, hash(Buffer.from(value, "hex")))
      .toString("hex");
}

/** Pure membership/exclusion check; malformed inputs throw, mismatch is false. */
export function verifyIbcTreeWitness(
  key: string,
  valueHex: string,
  siblings: readonly string[],
  expectedRoot: string,
): boolean {
  const digest = keyDigest(key);
  const value = normalizeValue(valueHex);
  const root = normalizeValue(expectedRoot);
  if (root.length !== 64) throw new Error("IBC tree root must be 32-byte hex");
  if (!Array.isArray(siblings) || siblings.length !== DEPTH) {
    throw new Error("IBC tree witness must have exactly 64 siblings");
  }
  let index = digest.readBigUInt64BE();
  let current = leafHash(digest, value);
  for (const encoded of siblings) {
    const sibling = normalizeValue(encoded);
    if (sibling.length !== 64) {
      throw new Error("IBC tree sibling must be 32-byte hex");
    }
    current = (index & 1n) === 0n
      ? innerHash(current, sibling)
      : innerHash(sibling, current);
    index >>= 1n;
  }
  return current === root;
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
  private readonly leafAtPath: StatementSync;
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
        path TEXT NOT NULL UNIQUE CHECK (
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
    this.leafAtPath = db.prepare(
      "SELECT key, value FROM ibc_tree_leaves WHERE path = ?",
    );
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
    return this.valueAtPath(key, keyDigest(key).readBigUInt64BE());
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
    let index = keyDigest(key).readBigUInt64BE();
    // An occupied truncated path cannot prove absence for a different full key.
    this.valueAtPath(key, index);
    const siblings: string[] = [];
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
      const previous = this.valueAtPath(key, index);
      if ((previous ?? "") !== value) {
        if (value === "") this.deleteLeaf.run(Buffer.from(key, "utf8"));
        else {this.upsertLeaf.run(
            Buffer.from(key, "utf8"),
            pathHex(index),
            value,
          );}

        let current = leafHash(digest, value);
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

  private valueAtPath(key: string, index: bigint): string | undefined {
    const row = this.leafAtPath.get(pathHex(index));
    if (row && Buffer.from(row.key as Uint8Array).toString("utf8") !== key) {
      throw new Error("IBC tree 64-bit path collision");
    }
    return row?.value as string | undefined;
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
        expectNode(0, path, leafHash(digest, value));
      }

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
