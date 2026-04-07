export declare class ICS23MerkleTree {
    private leaves;
    private root;
    private dirty;
    private nodesByHeight;
    clone(): ICS23MerkleTree;
    set(key: string, value: Buffer | string): void;
    getRoot(): string;
    getSiblings(key: string): Buffer[];
    private ensureRebuilt;
}
