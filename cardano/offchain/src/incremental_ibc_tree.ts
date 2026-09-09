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
 * The database is trusted local storage, not an authenticated input itself.
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

        let current = value === ""
          ? EMPTY_HASH
          : hash(Buffer.from([0]), digest, hash(Buffer.from(value, "hex")))
            .toString("hex");
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

  private nodeHash(height: number, index: bigint): string {
    return this.nodeAtPath.get(height, pathHex(index))?.hash as string ??
      EMPTY_HASH;
  }

  private storeNode(height: number, index: bigint, digest: string): void {
    if (digest === EMPTY_HASH) this.deleteNode.run(height, pathHex(index));
    else this.upsertNode.run(height, pathHex(index), digest);
  }
}
