"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IncrementalIbcTree = void 0;
exports.computeIbcTreeWitnessRoot = computeIbcTreeWitnessRoot;
exports.verifyIbcTreeWitness = verifyIbcTreeWitness;
const node_buffer_1 = require("node:buffer");
const ibcStateCommitment_ts_1 = require("./ibcStateCommitment.js");
const DEPTH = 64;
const EMPTY_HASH = "00".repeat(32);
const ROOT_PATH = "0000000000000000";
const pathHex = (index) => index.toString(16).padStart(16, "0");
function normalizeValue(valueHex) {
    if (typeof valueHex !== "string" || valueHex.length % 2 !== 0 ||
        /[^0-9a-fA-F]/.test(valueHex)) {
        throw new Error("IBC tree value must be even-length byte hex");
    }
    return valueHex.toLowerCase();
}
function innerHash(left, right) {
    if (left === EMPTY_HASH && right === EMPTY_HASH)
        return EMPTY_HASH;
    return (0, ibcStateCommitment_ts_1.hash)(node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([1]), node_buffer_1.Buffer.from(left, "hex"), node_buffer_1.Buffer.from(right, "hex")])).toString("hex");
}
/** Pure membership/exclusion check; malformed inputs throw, mismatch is false. */
function computeIbcTreeWitnessRoot(key, valueHex, siblings) {
    const digest = (0, ibcStateCommitment_ts_1.keyHash)(key);
    const value = normalizeValue(valueHex);
    if (!Array.isArray(siblings))
        throw new Error("IBC tree witness must be an array");
    const witness = siblings.map((encoded) => node_buffer_1.Buffer.from(normalizeValue(encoded), "hex"));
    const { leaf, siblings: path } = (0, ibcStateCommitment_ts_1.witnessLeaf)(digest, node_buffer_1.Buffer.from(value, "hex"), witness);
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
function verifyIbcTreeWitness(key, valueHex, siblings, expectedRoot) {
    const root = normalizeValue(expectedRoot);
    if (root.length !== 64)
        throw new Error("IBC tree root must be 32-byte hex");
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
class IncrementalIbcTree {
    db;
    leavesAtPath;
    leafByKey;
    nodeAtPath;
    upsertLeaf;
    deleteLeaf;
    upsertNode;
    deleteNode;
    allLeaves;
    constructor(db) {
        this.db = db;
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
        this.nodeAtPath = db.prepare("SELECT hash FROM ibc_tree_nodes WHERE height = ? AND path = ?");
        this.upsertLeaf = db.prepare("INSERT INTO ibc_tree_leaves (key, path, value) VALUES (?, ?, ?) " +
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value");
        this.deleteLeaf = db.prepare("DELETE FROM ibc_tree_leaves WHERE key = ?");
        this.upsertNode = db.prepare("INSERT INTO ibc_tree_nodes (height, path, hash) VALUES (?, ?, ?) " +
            "ON CONFLICT (height, path) DO UPDATE SET hash = excluded.hash");
        this.deleteNode = db.prepare("DELETE FROM ibc_tree_nodes WHERE height = ? AND path = ?");
        this.allLeaves = db.prepare("SELECT key, value FROM ibc_tree_leaves ORDER BY key");
    }
    getRoot() {
        return this.nodeAtPath.get(DEPTH, ROOT_PATH)?.hash ?? EMPTY_HASH;
    }
    get(key) {
        this.bucketAtPath((0, ibcStateCommitment_ts_1.keyHash)(key).readBigUInt64BE());
        return this.leafByKey.get(node_buffer_1.Buffer.from(key, "utf8"))?.value;
    }
    entries() {
        return this.allLeaves.all().map((row) => [
            node_buffer_1.Buffer.from(row.key).toString("utf8"),
            row.value,
        ]);
    }
    /**
     * Verify every leaf and every stored node, including the root. Ordered SQLite
     * index scans use constant JS memory and O(stored nodes) hashing; this belongs
     * at database open/recovery, not on the warm set() path. No cache is repaired
     * from potentially corrupted leaves. The caller's transaction is preserved.
     */
    assertIntegrity() {
        this.db.exec("SAVEPOINT ibc_tree_integrity");
        try {
            this.checkIntegrity();
            this.db.exec("RELEASE ibc_tree_integrity");
        }
        catch (cause) {
            this.db.exec("ROLLBACK TO ibc_tree_integrity; RELEASE ibc_tree_integrity");
            throw new Error("IBC tree cache integrity check failed; rebuild the disposable cache " +
                "from authenticated chain history before using it", { cause });
        }
    }
    /** Leaf-to-root siblings, including a valid exclusion witness for absent keys. */
    getSiblings(key) {
        const digest = (0, ibcStateCommitment_ts_1.keyHash)(key);
        let index = digest.readBigUInt64BE();
        const bucket = this.bucketAtPath(index);
        const siblings = (0, ibcStateCommitment_ts_1.needsBucketWitness)(bucket, digest) ? [(0, ibcStateCommitment_ts_1.encodeBucket)(bucket).toString("hex")] : [];
        for (let height = 0; height < DEPTH; height++) {
            siblings.push(this.nodeHash(height, index ^ 1n));
            index >>= 1n;
        }
        return siblings;
    }
    /** Empty hex deletes a leaf. Each mutation recomputes only its 64 ancestors. */
    set(key, valueHex) {
        const digest = (0, ibcStateCommitment_ts_1.keyHash)(key);
        const value = normalizeValue(valueHex);
        let index = digest.readBigUInt64BE();
        this.db.exec("SAVEPOINT ibc_tree_set");
        try {
            const previous = this.get(key);
            if ((previous ?? "") !== value) {
                if (value === "")
                    this.deleteLeaf.run(node_buffer_1.Buffer.from(key, "utf8"));
                else {
                    this.upsertLeaf.run(node_buffer_1.Buffer.from(key, "utf8"), pathHex(index), value);
                }
                let current = (0, ibcStateCommitment_ts_1.bucketHash)(this.bucketAtPath(index)).toString("hex");
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
        }
        catch (error) {
            this.db.exec("ROLLBACK TO ibc_tree_set; RELEASE ibc_tree_set");
            throw error;
        }
    }
    bucketAtPath(index) {
        const entries = this.leavesAtPath.all(pathHex(index)).map((row) => ({
            keyHash: (0, ibcStateCommitment_ts_1.keyHash)(node_buffer_1.Buffer.from(row.key).toString("utf8")),
            valueHash: (0, ibcStateCommitment_ts_1.hash)(node_buffer_1.Buffer.from(row.value, "hex")),
        }));
        if (entries.some((entry) => entry.keyHash.readBigUInt64BE() !== index)) {
            throw new Error("IBC tree leaf path does not match its key hash");
        }
        return (0, ibcStateCommitment_ts_1.sortBucket)(entries);
    }
    // Earlier disposable caches made the truncated path UNIQUE. Remove only that
    // constraint, preserving all leaves and nodes inside a nested transaction.
    migrateLeafPaths() {
        const hasUniquePath = this.db.prepare("PRAGMA index_list(ibc_tree_leaves)").all().some((row) => {
            if (!row.unique)
                return false;
            const columns = this.db.prepare(`PRAGMA index_info("${String(row.name).replaceAll('"', '""')}")`).all();
            return columns.length === 1 && columns[0].name === "path";
        });
        if (!hasUniquePath)
            return;
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
        }
        catch (error) {
            this.db.exec("ROLLBACK TO ibc_tree_bucket_schema; RELEASE ibc_tree_bucket_schema");
            throw error;
        }
    }
    checkIntegrity() {
        // Comparing the complete ordered node sequence, rather than only checking
        // each existing parent's children, also detects missing parents and orphans.
        const nodes = this.db.prepare("SELECT height, path, hash FROM ibc_tree_nodes ORDER BY height, path").iterate();
        try {
            let next = nodes.next();
            const expectNode = (height, path, digest) => {
                if (next.done || next.value.height !== height ||
                    next.value.path !== path || next.value.hash !== digest) {
                    throw new Error(`Inconsistent tree node at height ${height}, ${path}`);
                }
                next = nodes.next();
            };
            let bucketPath;
            let bucket = [];
            for (const leaf of this.db.prepare("SELECT key, path, value FROM ibc_tree_leaves ORDER BY path").iterate()) {
                if (!(leaf.key instanceof Uint8Array)) {
                    throw new Error("Invalid tree leaf key encoding");
                }
                const rawKey = node_buffer_1.Buffer.from(leaf.key);
                const key = rawKey.toString("utf8");
                if (!node_buffer_1.Buffer.from(key, "utf8").equals(rawKey)) {
                    throw new Error("Invalid tree leaf UTF-8");
                }
                const digest = (0, ibcStateCommitment_ts_1.keyHash)(key);
                const path = pathHex(digest.readBigUInt64BE());
                if (leaf.path !== path) {
                    throw new Error("Malformed or colliding tree leaf path");
                }
                const value = normalizeValue(leaf.value);
                if (value === "" || value !== leaf.value) {
                    throw new Error("Invalid tree leaf value encoding");
                }
                if (path !== bucketPath) {
                    if (bucketPath !== undefined)
                        expectNode(0, bucketPath, (0, ibcStateCommitment_ts_1.bucketHash)((0, ibcStateCommitment_ts_1.sortBucket)(bucket)).toString("hex"));
                    bucketPath = path;
                    bucket = [];
                }
                bucket.push({ keyHash: digest, valueHash: (0, ibcStateCommitment_ts_1.hash)(node_buffer_1.Buffer.from(value, "hex")) });
            }
            if (bucketPath !== undefined)
                expectNode(0, bucketPath, (0, ibcStateCommitment_ts_1.bucketHash)((0, ibcStateCommitment_ts_1.sortBucket)(bucket)).toString("hex"));
            const children = this.db.prepare("SELECT path, hash FROM ibc_tree_nodes WHERE height = ? ORDER BY path");
            for (let height = 1; height <= DEPTH; height++) {
                let parent;
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
                    if ((index & 1n) === 0n)
                        left = child.hash;
                    else
                        right = child.hash;
                }
                if (parent !== undefined) {
                    expectNode(height, pathHex(parent), innerHash(left, right));
                }
            }
            if (!next.done)
                throw new Error("Unexpected extra tree node");
        }
        finally {
            nodes.return?.();
        }
    }
    nodeHash(height, index) {
        return this.nodeAtPath.get(height, pathHex(index))?.hash ??
            EMPTY_HASH;
    }
    storeNode(height, index, digest) {
        if (digest === EMPTY_HASH)
            this.deleteNode.run(height, pathHex(index));
        else
            this.upsertNode.run(height, pathHex(index), digest);
    }
}
exports.IncrementalIbcTree = IncrementalIbcTree;
