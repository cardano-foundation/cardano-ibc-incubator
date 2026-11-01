import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { Constr, type Data } from "@lucid-evolution/lucid";

export interface CacheLeaf {
  index: number;
  pubkey: string;
  power: bigint;
}
export interface CacheRecord {
  root: string;
  count: number;
  totalPower: bigint;
}
const hash = (hex: string) =>
  createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const MAX_POWER = 1_152_921_504_606_846_975n;

function varint(n: bigint): string {
  const bytes: number[] = [];
  do {
    const byte = Number(n & 127n);
    n >>= 7n;
    bytes.push(byte | (n ? 128 : 0));
  } while (n);
  return Buffer.from(bytes).toString("hex");
}

export function cacheLeafHash(leaf: CacheLeaf): string {
  if (
    !/^[0-9a-f]{64}$/.test(leaf.pubkey) || leaf.power <= 0n ||
    leaf.power > MAX_POWER
  ) {
    throw new Error("Invalid validator leaf");
  }
  return hash("000a220a20" + leaf.pubkey + "10" + varint(leaf.power));
}

function split(count: number): number {
  let pivot = 1;
  while (pivot * 2 < count) pivot *= 2;
  return pivot;
}

function tree(hashes: string[]): string {
  if (hashes.length === 1) return hashes[0];
  const pivot = split(hashes.length);
  return hash("01" + tree(hashes.slice(0, pivot)) + tree(hashes.slice(pivot)));
}

export function cacheRecord(leaves: CacheLeaf[]): CacheRecord {
  if (!leaves.length || leaves.length > 256) {
    throw new Error("Invalid validator count");
  }
  const keys = new Set<string>();
  leaves.forEach((leaf, index) => {
    const previous = leaves[index - 1];
    if (
      leaf.index !== index || keys.has(leaf.pubkey) ||
      (previous && !ordered(previous, leaf))
    ) {
      throw new Error("Validators must be unique and in canonical order");
    }
    keys.add(leaf.pubkey);
  });
  const totalPower = leaves.reduce((total, leaf) => total + leaf.power, 0n);
  if (totalPower > MAX_POWER) {
    throw new Error("Validator total exceeds CometBFT limit");
  }
  return {
    root: tree(leaves.map(cacheLeafHash)),
    count: leaves.length,
    totalPower,
  };
}

function ordered(left: CacheLeaf, right: CacheLeaf): boolean {
  return left.power > right.power || left.power === right.power &&
      hash(left.pubkey).slice(0, 40) < hash(right.pubkey).slice(0, 40);
}

/** DFS frontier hashes, shared across all selected leaves. */
export function validatorMultiproof(
  leaves: CacheLeaf[],
  indices: number[],
): string[] {
  cacheRecord(leaves);
  if (
    !indices.length ||
    indices.some((index, i) =>
      !Number.isInteger(index) || index < 0 || index >= leaves.length ||
      i > 0 && indices[i - 1] >= index
    )
  ) throw new Error("Multiproof positions must be sorted and unique");
  const selected = new Set(indices);
  const hashes = leaves.map(cacheLeafHash);
  const siblings: string[] = [];
  function walk(start: number, count: number) {
    if (!indices.some((index) => index >= start && index < start + count)) {
      siblings.push(tree(hashes.slice(start, start + count)));
    } else if (count > 1) {
      const pivot = split(count);
      walk(start, pivot);
      walk(start + pivot, count - pivot);
    } else if (!selected.has(start)) throw new Error("Missing proof leaf");
  }
  walk(0, leaves.length);
  return siblings;
}

/** One frontier authenticates the changed powers, their ordering neighbors and
 * every target signer against both roots. The verifier can then derive trusted
 * overlap from these authenticated old powers without another membership proof.
 * Complete transaction evaluation still determines whether this path fits. */
export function sharedPowerUpdate(
  old: CacheLeaf[],
  next: CacheLeaf[],
  signerIndices: number[],
  maxChanges = 8,
): Constr<Data> | undefined {
  if (
    !signerIndices.length ||
    signerIndices.some((index, i) =>
      !Number.isInteger(index) || index < 0 || index >= old.length ||
      i > 0 && signerIndices[i - 1] >= index
    )
  ) throw new Error("Signer positions must be sorted and unique");
  const oldRecord = cacheRecord(old);
  cacheRecord(next);
  if (
    old.length !== next.length ||
    old.some((leaf, i) => leaf.pubkey !== next[i].pubkey)
  ) return undefined;
  const changed = old.filter((leaf, i) => leaf.power !== next[i].power).map((
    leaf,
  ) => leaf.index);
  if (!changed.length || changed.length > maxChanges) return undefined;
  const covered = new Set([
    ...signerIndices,
    ...changed.flatMap((index) => [index - 1, index, index + 1]).filter((
      index,
    ) => index >= 0 && index < old.length),
  ]);
  const indices = [...covered].sort((a, b) => a - b);
  return new Constr(1, [
    oldRecord.root,
    indices.map((index) =>
      new Constr(0, [
        BigInt(index),
        old[index].pubkey,
        old[index].power,
        next[index].power,
      ])
    ),
    validatorMultiproof(old, indices),
    signerIndices.map(BigInt),
  ]);
}

/** Authenticate an arbitrary target set and its complete trusted predecessor.
 * Surviving keys refer to the target by position, even after reordering. */
export function fullSetUpdate(
  old: CacheLeaf[],
  next: CacheLeaf[],
  signerIndices: number[],
): Constr<Data> {
  const oldRecord = cacheRecord(old);
  const nextRecord = cacheRecord(next);
  if (
    !signerIndices.length ||
    signerIndices.some((index, i) =>
      !Number.isInteger(index) || index < 0 || index >= next.length ||
      i > 0 && signerIndices[i - 1] >= index
    )
  ) throw new Error("Signer positions must be sorted and unique");
  const targetByKey = new Map(next.map((leaf) => [leaf.pubkey, leaf.index]));
  const packedPower = (power: bigint) => power.toString(16).padStart(16, "0");
  const trusted = oldRecord.root === nextRecord.root ? "" : old.map((leaf) => {
    const targetIndex = targetByKey.get(leaf.pubkey);
    return (targetIndex === undefined
      ? "01" + leaf.pubkey
      : "00" + targetIndex.toString(16).padStart(2, "0")) +
      packedPower(leaf.power);
  }).join("");
  return new Constr(0, [
    next.map((leaf) => leaf.pubkey + packedPower(leaf.power)).join(""),
    trusted,
    signerIndices.map(BigInt),
    [...next].sort((left, right) =>
      left.pubkey < right.pubkey ? -1 : left.pubkey > right.pubkey ? 1 : 0
    ).map((leaf) => BigInt(leaf.index)),
  ]);
}

export const cacheLeafData = (leaf: CacheLeaf): Constr<Data> =>
  new Constr(0, [BigInt(leaf.index), leaf.pubkey, leaf.power]);
export const cacheRecordData = (record: CacheRecord): Constr<Data> =>
  new Constr(0, [record.root, BigInt(record.count), record.totalPower]);

export function rotateCache(
  records: CacheRecord[],
  record: CacheRecord,
): CacheRecord[] {
  return [record, ...records.filter((old) => old.root !== record.root)].slice(
    0,
    2,
  );
}

/** Compact an existing 64-level sparse path, preserving an optional bucket. */
export function compactStateSiblings(siblings: string[]): string[] {
  const bucket = siblings.length === 65 ? siblings.slice(0, 1) : [];
  const path = siblings.slice(bucket.length);
  if (path.length !== 64 || path.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error("Expected a 64-level state proof");
  }
  return [
    ...bucket,
    ...path.map((hash) => hash === "00".repeat(32) ? "" : hash),
  ];
}
