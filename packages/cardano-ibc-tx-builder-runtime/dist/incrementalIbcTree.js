"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IncrementalIbcTree = void 0;
exports.verifyIbcTreeWitness = verifyIbcTreeWitness;
const node_buffer_1 = require("node:buffer");
const node_crypto_1 = require("node:crypto");
const DEPTH = 64;
const EMPTY_HASH = "00".repeat(32);
const ROOT_PATH = "0000000000000000";
const hash = (...parts) => {
    const digest = (0, node_crypto_1.createHash)("sha256");
    for (const part of parts)
        digest.update(part);
    return digest.digest();
};
const pathHex = (index) => index.toString(16).padStart(16, "0");
function keyDigest(key) {
    // SQLite and SHA-256 must see exactly the same UTF-8 key, including when a
    // caller accidentally supplies an unpaired UTF-16 surrogate.
    if (typeof key !== "string" || node_buffer_1.Buffer.from(key, "utf8").toString("utf8") !== key) {
        throw new Error("IBC tree key must be a well-formed UTF-8 string");
    }
    return hash(node_buffer_1.Buffer.from(key, "utf8"));
}
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
    return hash(node_buffer_1.Buffer.from([1]), node_buffer_1.Buffer.from(left, "hex"), node_buffer_1.Buffer.from(right, "hex")).toString("hex");
}
function leafHash(digest, value) {
    return value === ""
        ? EMPTY_HASH
        : hash(node_buffer_1.Buffer.from([0]), digest, hash(node_buffer_1.Buffer.from(value, "hex")))
            .toString("hex");
}
/** Pure membership/exclusion check; malformed inputs throw, mismatch is false. */
function verifyIbcTreeWitness(key, valueHex, siblings, expectedRoot) {
    const digest = keyDigest(key);
    const value = normalizeValue(valueHex);
    const root = normalizeValue(expectedRoot);
    if (root.length !== 64)
        throw new Error("IBC tree root must be 32-byte hex");
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
class IncrementalIbcTree {
    db;
    leafAtPath;
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
        this.leafAtPath = db.prepare("SELECT key, value FROM ibc_tree_leaves WHERE path = ?");
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
        return this.valueAtPath(key, keyDigest(key).readBigUInt64BE());
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
        let index = keyDigest(key).readBigUInt64BE();
        // An occupied truncated path cannot prove absence for a different full key.
        this.valueAtPath(key, index);
        const siblings = [];
        for (let height = 0; height < DEPTH; height++) {
            siblings.push(this.nodeHash(height, index ^ 1n));
            index >>= 1n;
        }
        return siblings;
    }
    /** Empty hex deletes a leaf. Each mutation recomputes only its 64 ancestors. */
    set(key, valueHex) {
        const digest = keyDigest(key);
        const value = normalizeValue(valueHex);
        let index = digest.readBigUInt64BE();
        this.db.exec("SAVEPOINT ibc_tree_set");
        try {
            const previous = this.valueAtPath(key, index);
            if ((previous ?? "") !== value) {
                if (value === "")
                    this.deleteLeaf.run(node_buffer_1.Buffer.from(key, "utf8"));
                else {
                    this.upsertLeaf.run(node_buffer_1.Buffer.from(key, "utf8"), pathHex(index), value);
                }
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
        }
        catch (error) {
            this.db.exec("ROLLBACK TO ibc_tree_set; RELEASE ibc_tree_set");
            throw error;
        }
    }
    valueAtPath(key, index) {
        const row = this.leafAtPath.get(pathHex(index));
        if (row && node_buffer_1.Buffer.from(row.key).toString("utf8") !== key) {
            throw new Error("IBC tree 64-bit path collision");
        }
        return row?.value;
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
            for (const leaf of this.db.prepare("SELECT key, path, value FROM ibc_tree_leaves ORDER BY path").iterate()) {
                if (!(leaf.key instanceof Uint8Array)) {
                    throw new Error("Invalid tree leaf key encoding");
                }
                const rawKey = node_buffer_1.Buffer.from(leaf.key);
                const key = rawKey.toString("utf8");
                if (!node_buffer_1.Buffer.from(key, "utf8").equals(rawKey)) {
                    throw new Error("Invalid tree leaf UTF-8");
                }
                const digest = keyDigest(key);
                const path = pathHex(digest.readBigUInt64BE());
                if (leaf.path !== path) {
                    throw new Error("Malformed or colliding tree leaf path");
                }
                const value = normalizeValue(leaf.value);
                if (value === "" || value !== leaf.value) {
                    throw new Error("Invalid tree leaf value encoding");
                }
                expectNode(0, path, leafHash(digest, value));
            }
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
