import type { DatabaseSync } from "node:sqlite";
/** Pure membership/exclusion check; malformed inputs throw, mismatch is false. */
export declare function verifyIbcTreeWitness(key: string, valueHex: string, siblings: readonly string[], expectedRoot: string): boolean;
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
export declare class IncrementalIbcTree {
    private readonly db;
    private readonly leafAtPath;
    private readonly nodeAtPath;
    private readonly upsertLeaf;
    private readonly deleteLeaf;
    private readonly upsertNode;
    private readonly deleteNode;
    private readonly allLeaves;
    constructor(db: DatabaseSync);
    getRoot(): string;
    get(key: string): string | undefined;
    entries(): Array<[string, string]>;
    /**
     * Verify every leaf and every stored node, including the root. Ordered SQLite
     * index scans use constant JS memory and O(stored nodes) hashing; this belongs
     * at database open/recovery, not on the warm set() path. No cache is repaired
     * from potentially corrupted leaves. The caller's transaction is preserved.
     */
    assertIntegrity(): void;
    /** Leaf-to-root siblings, including a valid exclusion witness for absent keys. */
    getSiblings(key: string): string[];
    /** Empty hex deletes a leaf. Each mutation recomputes only its 64 ancestors. */
    set(key: string, valueHex: string): void;
    private valueAtPath;
    private checkIntegrity;
    private nodeHash;
    private storeNode;
}
