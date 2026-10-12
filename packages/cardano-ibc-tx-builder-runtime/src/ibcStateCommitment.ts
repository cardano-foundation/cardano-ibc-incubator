import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const MERKLE_DEPTH_BITS = 64;
export const EMPTY_HASH = Buffer.alloc(32);
export const EMPTY_VALUE_HASH = hash(Buffer.alloc(0));

export interface BucketEntry {
  keyHash: Buffer;
  valueHash: Buffer;
}

export function hash(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

export function keyHash(key: string): Buffer {
  const bytes = Buffer.from(key, 'utf8');
  if (bytes.toString('utf8') !== key) throw new Error('IBC tree key must be a well-formed UTF-8 string');
  return hash(bytes);
}

export function leafHash(keyDigest: Buffer, valueDigest: Buffer): Buffer {
  if (valueDigest.equals(EMPTY_VALUE_HASH)) return EMPTY_HASH;
  return hash(Buffer.concat([Buffer.from([0]), keyDigest, valueDigest]));
}

export function innerHash(left: Buffer, right: Buffer): Buffer {
  if (left.equals(EMPTY_HASH) && right.equals(EMPTY_HASH)) return EMPTY_HASH;
  return hash(Buffer.concat([Buffer.from([1]), left, right]));
}

// Empty and singleton positions retain their existing commitments. A collision
// commits to every full key/value digest in strictly increasing key-hash order.
export function bucketHash(entries: readonly BucketEntry[]): Buffer {
  if (entries.length === 0) return EMPTY_HASH;
  if (entries.length === 1) return leafHash(entries[0].keyHash, entries[0].valueHash);
  return hash(encodeBucket(entries));
}

export function encodeBucket(entries: readonly BucketEntry[]): Buffer {
  return Buffer.concat([Buffer.from([2]), ...entries.flatMap((entry) => [entry.keyHash, entry.valueHash])]);
}

export function sortBucket(entries: BucketEntry[]): BucketEntry[] {
  entries.sort((a, b) => Buffer.compare(a.keyHash, b.keyHash));
  // Reuse the wire checks so rebuilding cannot silently discard a full-hash
  // collision or produce a commitment that the validators cannot interpret.
  if (entries.length) decodeBucket(encodeBucket(entries), entries[0].keyHash);
  return entries;
}

export function decodeBucket(encoded: Buffer, requestedKeyHash: Buffer): BucketEntry[] {
  if (encoded[0] !== 2 || encoded.length < 65 || (encoded.length - 1) % 64 !== 0) {
    throw new Error('Invalid collision bucket encoding');
  }
  const entries: BucketEntry[] = [];
  for (let offset = 1; offset < encoded.length; offset += 64) {
    const entry = { keyHash: encoded.subarray(offset, offset + 32), valueHash: encoded.subarray(offset + 32, offset + 64) };
    if (!entry.keyHash.subarray(0, 8).equals(requestedKeyHash.subarray(0, 8))) {
      throw new Error('Collision bucket entry belongs to a different path');
    }
    if (entry.valueHash.equals(EMPTY_VALUE_HASH)) throw new Error('Collision bucket contains an empty value');
    if (entries.length && Buffer.compare(entries[entries.length - 1].keyHash, entry.keyHash) >= 0) {
      throw new Error('Collision bucket keys must be strictly ordered');
    }
    entries.push(entry);
  }
  return entries;
}

export function requireBucketValue(entries: readonly BucketEntry[], requestedKeyHash: Buffer, value: Buffer): void {
  const entry = entries.find((candidate) => candidate.keyHash.equals(requestedKeyHash));
  if (value.length === 0 ? entry !== undefined : !entry?.valueHash.equals(hash(value))) {
    throw new Error('Collision bucket does not contain the claimed key and value');
  }
}

export function needsBucketWitness(entries: readonly BucketEntry[], requestedKeyHash: Buffer): boolean {
  return entries.length > 1 || (entries.length === 1 && !entries[0].keyHash.equals(requestedKeyHash));
}

// A bucket descriptor precedes the usual 64 siblings only when the position
// contains another key. The existing redeemer list and protobuf path can carry
// it without adding a new datum or proof type.
export function witnessLeaf(digest: Buffer, value: Buffer, witness: readonly Buffer[]): { leaf: Buffer; siblings: readonly Buffer[] } {
  if (witness.length === MERKLE_DEPTH_BITS + 1) {
    const entries = decodeBucket(witness[0], digest);
    requireBucketValue(entries, digest, value);
    return { leaf: bucketHash(entries), siblings: witness.slice(1) };
  }
  if (witness.length !== MERKLE_DEPTH_BITS) throw new Error('IBC tree witness must have 64 siblings and at most one bucket descriptor');
  return { leaf: leafHash(digest, hash(value)), siblings: witness };
}
