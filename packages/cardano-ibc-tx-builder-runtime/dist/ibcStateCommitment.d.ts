import { Buffer } from 'node:buffer';
export declare const MERKLE_DEPTH_BITS = 64;
export declare const EMPTY_HASH: Buffer<ArrayBuffer>;
export interface BucketEntry {
    keyHash: Buffer;
    valueHash: Buffer;
}
export declare function hash(bytes: Uint8Array): Buffer;
export declare function keyHash(key: string): Buffer;
export declare function innerHash(left: Buffer, right: Buffer): Buffer;
export declare function bucketHash(entries: readonly BucketEntry[]): Buffer;
export declare function encodeBucket(entries: readonly BucketEntry[]): Buffer;
export declare function sortBucket(entries: BucketEntry[]): BucketEntry[];
export declare function needsBucketWitness(entries: readonly BucketEntry[], requestedKeyHash: Buffer): boolean;
export declare function witnessLeaf(digest: Buffer, value: Buffer, witness: readonly Buffer[]): {
    leaf: Buffer;
    siblings: readonly Buffer[];
};
