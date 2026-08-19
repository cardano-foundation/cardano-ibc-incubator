/**
 * Immutable-path sparse Merkle tree used by the standalone transaction runtime.
 * Clones share all unchanged nodes, and each update copies only one 64-node path.
 */
export declare class ICS23MerkleTree {
    private rootNode;
    private leafCount;
    clone(): ICS23MerkleTree;
    set(key: string, value: Buffer | string): void;
    get(key: string): Buffer | undefined;
    delete(key: string): void;
    size(): number;
    getKeys(): string[];
    getRoot(): string;
    getSiblings(key: string): Buffer[];
    toJSON(): {
        leaves: Record<string, string>;
        root: string;
    };
    static fromJSON(data: {
        leaves: Record<string, string>;
        root?: string;
    }): ICS23MerkleTree;
}
