/**
 * Represents an inner step of a proof.
 *
 * This intentionally mirrors the existing "ICS23InnerOp" shape used in the
 * Gateway codebase and can be serialized into standard protobuf `MerkleProof`
 * bytes for Hermes/Cosmos verification.
 *
 * Convention:
 * - If `suffix` is non-empty, the current node is the LEFT child and `suffix` is the sibling hash.
 * - If `suffix` is empty, the current node is the RIGHT child and `prefix` contains `0x01 || leftSiblingHash`.
 */
export interface ICS23InnerOp {
    hash: number;
    prefix: Buffer;
    suffix: Buffer;
}
export interface ICS23LeafOp {
    hash: number;
    prehash_key: number;
    prehash_value: number;
    length: number;
    prefix: Buffer;
}
export interface ICS23ExistenceProof {
    key: Buffer;
    value: Buffer;
    leaf: ICS23LeafOp;
    path: ICS23InnerOp[];
}
export interface ICS23NonExistenceProof {
    key: Buffer;
    left: ICS23ExistenceProof | null;
    right: ICS23ExistenceProof | null;
}
/**
 * Fixed-depth Merkle tree keyed by `sha256(key)`.
 */
export declare class ICS23MerkleTree {
    private leaves;
    private root;
    private dirty;
    private nodesByHeight;
    clone(): ICS23MerkleTree;
    set(key: string, value: Buffer | string): void;
    get(key: string): Buffer | undefined;
    delete(key: string): void;
    size(): number;
    getKeys(): string[];
    getRoot(): string;
    /**
     * Return the per-level sibling hashes for this key, even if the key is not present.
     *
     * This is the exact structure we use as an on-chain update witness.
     */
    getSiblings(key: string): Buffer[];
    /**
     * Generate a membership proof for an existing key.
     */
    generateProof(key: string): ICS23ExistenceProof;
    /**
     * Generate a non-membership proof for a missing key.
     *
     * For this fixed-depth tree, we model "missing" as "present with an empty value".
     * The leaf hash for an empty value is the all-zero hash.
     */
    generateNonExistenceProof(key: string): ICS23NonExistenceProof;
    /**
     * Verify a proof against the current tree root.
     *
     * This is primarily used by unit tests to sanity-check the proof generator.
     */
    verifyProof(proof: ICS23ExistenceProof): boolean;
    toJSON(): {
        leaves: Record<string, string>;
        root: string;
    };
    static fromJSON(data: {
        leaves: Record<string, string>;
        root?: string;
    }): ICS23MerkleTree;
    private ensureRebuilt;
}
