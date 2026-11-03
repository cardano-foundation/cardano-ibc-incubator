import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  Constr,
  Data,
  getAddressDetails,
  type UTxO,
} from "@lucid-evolution/lucid";
import { serialisePlutusData } from "./plutusSerialise.ts";

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

export interface CacheToken {
  policyId: string;
  name: string;
}
export interface ValidatorCache {
  token: CacheToken;
  clientToken: CacheToken;
  clientAddress: string;
  records: CacheRecord[];
}
export class DirectUpdateUnsupported extends Error {}

const record = (...fields: Data[]) => new Constr(0, fields);
const cacheTokenData = (token: CacheToken) =>
  record(token.policyId, token.name);
export function validatorCacheToken(
  client: CacheToken,
  policyId: string,
): CacheToken {
  const subject = serialisePlutusData(Data.to<Data>(cacheTokenData(client)));
  return {
    policyId,
    name: createHash("sha3-256").update(Buffer.from(subject, "hex")).digest(
      "hex",
    ),
  };
}

function addressData(address: string) {
  const details = getAddressDetails(address);
  if (
    !details.paymentCredential || !["Base", "Enterprise"].includes(details.type)
  ) throw new Error("Unsupported cached client address");
  const credential = (c: { type: string; hash: string }) =>
    new Constr(c.type === "Script" ? 1 : 0, [c.hash]);
  return record(
    credential(details.paymentCredential),
    details.stakeCredential
      ? new Constr(0, [record(credential(details.stakeCredential))])
      : new Constr(1, []),
  );
}

export function encodeValidatorCache(cache: ValidatorCache): string {
  return Data.to<Data>(
    record(
      cacheTokenData(cache.token),
      cacheTokenData(cache.clientToken),
      addressData(cache.clientAddress),
      cache.records.map(cacheRecordData),
    ),
    undefined,
    { canonical: true },
  );
}

/** Authenticate the identity and address as well as the canonical cache NFT. */
export function readValidatorCache(
  utxo: UTxO,
  client: CacheToken,
  policy: string,
  clientAddress: string,
): ValidatorCache {
  const token = validatorCacheToken(client, policy);
  if (utxo.assets[policy + token.name] !== 1n || !utxo.datum) {
    throw new Error("Missing canonical validator cache");
  }
  const raw = Data.from(utxo.datum);
  if (
    !(raw instanceof Constr) || raw.index !== 0 || raw.fields.length !== 4 ||
    !Array.isArray(raw.fields[3])
  ) throw new Error("Invalid validator cache datum");
  const records = raw.fields[3].map((value) => {
    if (
      !(value instanceof Constr) || value.index !== 0 ||
      value.fields.length !== 3
    ) throw new Error("Invalid authenticated validator record");
    const [root, count, totalPower] = value.fields;
    if (
      typeof root !== "string" || !/^[0-9a-f]{64}$/.test(root) ||
      typeof count !== "bigint" || count < 1n || count > 256n ||
      typeof totalPower !== "bigint" || totalPower < 1n ||
      totalPower > MAX_POWER
    ) throw new Error("Invalid authenticated validator record");
    return { root, count: Number(count), totalPower };
  });
  if (
    records.length > 2 ||
    new Set(records.map((r) => r.root)).size !== records.length
  ) throw new Error("Invalid rotating validator cache");
  const cache = { token, clientToken: client, clientAddress, records };
  if (
    Data.to<Data>(raw, undefined, { canonical: true }) !==
      encodeValidatorCache(cache)
  ) {
    throw new Error(
      "Validator cache identity does not match the subject client",
    );
  }
  return cache;
}

export function initializeValidatorCache(
  client: CacheToken,
  policy: string,
  clientAddress: string,
) {
  const token = validatorCacheToken(client, policy);
  return {
    tokenUnit: token.policyId + token.name,
    datum: encodeValidatorCache({
      token,
      clientToken: client,
      clientAddress,
      records: [],
    }),
    mintRedeemer: Data.to<Data>(
      record(cacheTokenData(client), [], []),
      undefined,
      { canonical: true },
    ),
  };
}

type Height = { revisionNumber: bigint; revisionHeight: bigint };
type BlockId = { hash: string; partSetHeader: { total: bigint; hash: string } };
type CommitSignature = {
  block_id_flag: bigint;
  validator_address: string;
  timestamp: bigint;
  signature: string;
};
export type CachedHeader = {
  signedHeader: {
    header: {
      version: { block: bigint; app: bigint };
      chainId: string;
      height: bigint;
      time: bigint;
      lastBlockId: BlockId;
      lastCommitHash: string;
      dataHash: string;
      validatorsHash: string;
      nextValidatorsHash: string;
      consensusHash: string;
      appHash: string;
      lastResultsHash: string;
      evidenceHash: string;
      proposerAddress: string;
    };
    commit: {
      height: bigint;
      round: bigint;
      blockId: BlockId;
      signatures: CommitSignature[];
    };
  };
  trustedHeight: Height;
  validatorSet: {
    validators: { pubkey: string; votingPower: bigint; address: string }[];
  };
  trustedValidators: {
    validators: { pubkey: string; votingPower: bigint; address: string }[];
  };
};

function leavesFrom(
  validators: CachedHeader["validatorSet"]["validators"],
): CacheLeaf[] {
  return validators.map((validator, index) => {
    if (hash(validator.pubkey).slice(0, 40) !== validator.address) {
      throw new Error("Validator address does not match its public key");
    }
    return { index, pubkey: validator.pubkey, power: validator.votingPower };
  });
}

// This is a bounded search, not a proof that a smaller quorum is impossible.
// Keep the target prefix and try trusted power and several balanced priorities.
function signerCandidates(
  available: CacheLeaf[],
  trustedPower: Map<string, CacheLeaf>,
  targetRequired: bigint,
  trustedRequired: bigint,
  prefix: number[],
): number[][] {
  const candidates = new Map<string, number[]>();
  const oldPower = (leaf: CacheLeaf) =>
    trustedPower.get(leaf.pubkey)?.power ?? 0n;
  const retain = (selected: CacheLeaf[]) => {
    let target = selected.reduce((total, leaf) => total + leaf.power, 0n);
    let trusted = selected.reduce((total, leaf) => total + oldPower(leaf), 0n);
    // Remove redundant choices while retaining canonical prefixes on ties.
    for (const leaf of [...selected].sort((a, b) => b.index - a.index)) {
      if (
        target - leaf.power >= targetRequired &&
        trusted - oldPower(leaf) >= trustedRequired
      ) {
        selected = selected.filter((entry) => entry.index !== leaf.index);
        target -= leaf.power;
        trusted -= oldPower(leaf);
      }
    }
    if (
      target < targetRequired || trusted < trustedRequired ||
      selected.length > 45
    ) return;
    const indices = selected.map((leaf) => leaf.index).sort((a, b) => a - b);
    candidates.set(indices.join(","), indices);
  };
  const prefixSet = new Set(prefix);
  retain(available.filter((leaf) => prefixSet.has(leaf.index)));
  const min = (a: bigint, b: bigint) => a < b ? a : b;
  for (
    const [targetWeight, trustedWeight, reverse] of [
      [1n, 0n, false],
      [0n, 1n, false],
      [1n, 1n, false],
      [2n, 1n, false],
      [1n, 2n, false],
      [1n, 1n, true],
    ] as const
  ) {
    let remaining = [...available];
    const selected: CacheLeaf[] = [];
    let target = 0n;
    let trusted = 0n;
    while (target < targetRequired || trusted < trustedRequired) {
      const needTarget = targetRequired > target ? targetRequired - target : 0n;
      const needTrusted = trustedRequired > trusted
        ? trustedRequired - trusted
        : 0n;
      const score = (leaf: CacheLeaf) => {
        if (needTarget === 0n) return min(oldPower(leaf), needTrusted);
        if (needTrusted === 0n) return min(leaf.power, needTarget);
        return min(leaf.power, needTarget) * needTrusted * targetWeight +
          min(oldPower(leaf), needTrusted) * needTarget * trustedWeight;
      };
      remaining.sort((a, b) => {
        const difference = score(b) - score(a);
        return difference > 0n
          ? 1
          : difference < 0n
          ? -1
          : reverse
          ? b.index - a.index
          : a.index - b.index;
      });
      const leaf = remaining.shift();
      if (!leaf) break;
      selected.push(leaf);
      target += leaf.power;
      trusted += oldPower(leaf);
    }
    retain(selected);
  }
  return [...candidates.values()];
}

/** Build the same compact witness used by the retained native benchmarks.
 * A miss authenticates both complete sets directly. It does not select staging.
 */
export function prepareCachedHeader(args: {
  header: CachedHeader;
  cache: ValidatorCache;
  trustedRoot: string;
  latestHeight: Height;
  trustLevel: { numerator: bigint; denominator: bigint };
  historySiblings: string[];
  signerCandidate?: number;
}) {
  const { header, cache, trustedRoot, trustLevel } = args;
  if (
    header.trustedHeight.revisionNumber !== args.latestHeight.revisionNumber ||
    header.trustedHeight.revisionHeight !== args.latestHeight.revisionHeight
  ) {
    throw new DirectUpdateUnsupported(
      "Direct verification requires the current client checkpoint",
    );
  }
  if (
    header.validatorSet.validators.length > 256 ||
    header.trustedValidators.validators.length > 256
  ) {
    throw new DirectUpdateUnsupported(
      "Validator count exceeds the packed verifier's capacity",
    );
  }
  const target = leavesFrom(header.validatorSet.validators);
  const targetRecord = cacheRecord(target);
  if (targetRecord.root !== header.signedHeader.header.validatorsHash) {
    throw new Error("Target validator root does not match the signed header");
  }
  const sameRoot = targetRecord.root === trustedRoot;
  const adjacent = header.signedHeader.header.height ===
    header.trustedHeight.revisionHeight + 1n;
  if (adjacent && !sameRoot) {
    throw new Error(
      "Adjacent target does not match the authenticated next validator root",
    );
  }
  const old = sameRoot
    ? target
    : leavesFrom(header.trustedValidators.validators);
  const oldRecord = cacheRecord(old);
  if (oldRecord.root !== trustedRoot) {
    throw new Error(
      "Trusted validator root does not match the authenticated checkpoint",
    );
  }
  const oldByKey = new Map(old.map((leaf) => [leaf.pubkey, leaf]));
  const signatures = header.signedHeader.commit.signatures;
  if (signatures.length !== target.length) {
    throw new Error("Commit and validator counts differ");
  }
  const indices: number[] = [];
  let power = 0n;
  let overlap = 0n;
  for (const leaf of target) {
    const signature = signatures[leaf.index];
    if (signature.block_id_flag !== 2n) continue;
    if (
      signature.validator_address !== hash(leaf.pubkey).slice(0, 40) ||
      !/^[0-9a-f]{128}$/.test(signature.signature)
    ) throw new Error("Invalid committing signature identity");
    indices.push(leaf.index);
    power += leaf.power;
    overlap += oldByKey.get(leaf.pubkey)?.power ?? 0n;
    if (
      power * 3n > targetRecord.totalPower * 2n &&
      (adjacent ||
        overlap * trustLevel.denominator >
          oldRecord.totalPower * trustLevel.numerator)
    ) break;
  }
  if (
    power * 3n <= targetRecord.totalPower * 2n ||
    !adjacent &&
      overlap * trustLevel.denominator <=
        oldRecord.totalPower * trustLevel.numerator
  ) throw new Error("Available signatures do not satisfy both quorum rules");
  const validIdentity = (leaf: CacheLeaf) => {
    const signature = signatures[leaf.index];
    return signature.block_id_flag === 2n &&
      signature.validator_address === hash(leaf.pubkey).slice(0, 40) &&
      /^[0-9a-f]{128}$/.test(signature.signature);
  };
  const candidates = adjacent || sameRoot
    ? indices.length <= 45 ? [indices] : []
    : signerCandidates(
      target.filter(validIdentity),
      oldByKey,
      targetRecord.totalPower * 2n / 3n + 1n,
      oldRecord.totalPower * trustLevel.numerator / trustLevel.denominator + 1n,
      indices,
    );
  if (!candidates.length) {
    throw new DirectUpdateUnsupported(
      "No selected quorum fits the direct verifier's signature capacity",
    );
  }
  const targetCached = cache.records.some((r) => r.root === targetRecord.root);
  const oldCached = cache.records.some((r) => r.root === trustedRoot);
  const build = (indices: number[]) => {
    let sets: Constr<Data>[] = [];
    let targetLeaves: Constr<Data>[] = [];
    let trustedLeaves: Constr<Data>[] = [];
    let targetSiblings: string[] = [];
    let trustedSiblings: string[] = [];
    let full = false;
    if (targetCached && oldCached) {
      targetLeaves = indices.map((i) => cacheLeafData(target[i]));
      targetSiblings = validatorMultiproof(target, indices);
      if (!sameRoot) {
        const signedKeys = new Set(indices.map((i) => target[i].pubkey));
        const trustedIndices = old.filter((leaf) => signedKeys.has(leaf.pubkey))
          .map((leaf) => leaf.index);
        trustedLeaves = trustedIndices.map((i) => cacheLeafData(old[i]));
        trustedSiblings = validatorMultiproof(old, trustedIndices);
      }
    } else {
      const powers = oldCached
        ? sharedPowerUpdate(old, target, indices)
        : undefined;
      full = powers === undefined;
      sets = [powers ?? fullSetUpdate(old, target, indices)];
    }
    const block = (id: BlockId) =>
      record(id.hash, record(id.partSetHeader.total, id.partSetHeader.hash));
    const h = header.signedHeader.header;
    const commit = header.signedHeader.commit;
    const signedHeader = record(
      record(
        record(h.version.block, h.version.app),
        h.chainId,
        h.height,
        h.time,
        block(h.lastBlockId),
        h.lastCommitHash,
        h.dataHash,
        h.validatorsHash,
        h.nextValidatorsHash,
        h.consensusHash,
        h.appHash,
        h.lastResultsHash,
        h.evidenceHash,
        h.proposerAddress,
      ),
      record(
        commit.height,
        commit.round,
        block(commit.blockId),
        indices.map((i) => {
          const s = signatures[i];
          return record(
            s.block_id_flag,
            s.validator_address,
            s.timestamp,
            s.signature,
          );
        }),
      ),
    );
    const update = record(
      cacheTokenData(cache.token),
      signedHeader,
      record(
        header.trustedHeight.revisionNumber,
        header.trustedHeight.revisionHeight,
      ),
      targetLeaves,
      targetSiblings,
      trustedLeaves,
      trustedSiblings,
      sets,
      compactStateSiblings(args.historySiblings),
    );
    const previous = full && !sameRoot
      ? rotateCache(cache.records, oldRecord)
      : cache.records;
    return {
      signatureCount: indices.length,
      full,
      redeemer: Data.to<Data>(new Constr(6, [update]), undefined, {
        canonical: true,
      }),
      nextCacheDatum: encodeValidatorCache({
        ...cache,
        records: rotateCache(previous, targetRecord),
      }),
    };
  };
  const byCount = candidates.map(build).sort((a, b) =>
    a.signatureCount - b.signatureCount ||
    a.redeemer.length - b.redeemer.length ||
    a.redeemer.localeCompare(b.redeemer)
  );
  const smallest =
    [...byCount].sort((a, b) =>
      a.redeemer.length - b.redeemer.length ||
      a.signatureCount - b.signatureCount
    )[0];
  // A tighter proof can fit even when it needs another signature.
  const prepared = [...new Set([byCount[0], smallest, ...byCount])].slice(0, 3);
  const candidate = args.signerCandidate ?? 0;
  if (
    !Number.isInteger(candidate) || candidate < 0 ||
    candidate >= prepared.length
  ) {
    throw new Error("Invalid cached signer candidate");
  }
  return { ...prepared[candidate], candidateCount: prepared.length };
}

function fields(value: Data, count: number, index = 0): Data[] {
  if (
    !(value instanceof Constr) || value.index !== index ||
    value.fields.length !== count
  ) throw new Error("Malformed cached update witness");
  return value.fields;
}
function bytes(value: Data): string {
  if (typeof value !== "string") {
    throw new Error("Expected cached witness bytes");
  }
  return value;
}
function integer(value: Data): bigint {
  if (typeof value !== "bigint") {
    throw new Error("Expected cached witness integer");
  }
  return value;
}
function array(value: Data): Data[] {
  if (!Array.isArray(value)) throw new Error("Expected cached witness list");
  return value;
}
const position = (value: Data) => {
  const n = integer(value);
  if (n < 0n || n > 255n) throw new Error("Invalid cached validator position");
  return Number(n);
};
const decodeLeaf = (value: Data): CacheLeaf => {
  const [index, key, power] = fields(value, 3);
  return { index: position(index), pubkey: bytes(key), power: integer(power) };
};

export interface CachedUpdateWitness {
  cacheToken: CacheToken;
  signedHeader: CachedHeader["signedHeader"];
  trustedHeight: Height;
  signers: number[];
  set?:
    | { kind: "full"; target: CacheLeaf[]; trusted: CacheLeaf[] }
    | {
      kind: "powers";
      oldRoot: string;
      changes: {
        index: number;
        pubkey: string;
        oldPower: bigint;
        newPower: bigint;
      }[];
    };
}

/** Decode confirmed witnesses for header-event recovery. Their full validator
 * sets are recovered from durable cache history and checked against each root.
 */
export function decodeCachedUpdate(
  cbor: string,
): CachedUpdateWitness | undefined {
  const raw = Data.from(cbor);
  if (!(raw instanceof Constr) || raw.index !== 6) return undefined;
  const [payload] = fields(raw, 1, 6);
  const [token, signed, height, target, , , , sets] = fields(payload, 9);
  const [policyId, name] = fields(token, 2).map(bytes);
  const [tm, commitData] = fields(signed, 2);
  const h = fields(tm, 14);
  const [block, app] = fields(h[0], 2).map(integer);
  const blockId = (value: Data): BlockId => {
    const [hash, parts] = fields(value, 2);
    const [total, partHash] = fields(parts, 2);
    return {
      hash: bytes(hash),
      partSetHeader: { total: integer(total), hash: bytes(partHash) },
    };
  };
  const [commitHeight, round, id, sigs] = fields(commitData, 4);
  const [revisionNumber, revisionHeight] = fields(height, 2).map(integer);
  const result: CachedUpdateWitness = {
    cacheToken: { policyId, name },
    trustedHeight: { revisionNumber, revisionHeight },
    signedHeader: {
      header: {
        version: { block, app },
        chainId: bytes(h[1]),
        height: integer(h[2]),
        time: integer(h[3]),
        lastBlockId: blockId(h[4]),
        lastCommitHash: bytes(h[5]),
        dataHash: bytes(h[6]),
        validatorsHash: bytes(h[7]),
        nextValidatorsHash: bytes(h[8]),
        consensusHash: bytes(h[9]),
        appHash: bytes(h[10]),
        lastResultsHash: bytes(h[11]),
        evidenceHash: bytes(h[12]),
        proposerAddress: bytes(h[13]),
      },
      commit: {
        height: integer(commitHeight),
        round: integer(round),
        blockId: blockId(id),
        signatures: array(sigs).map((value) => {
          const [flag, address, time, signature] = fields(value, 4);
          return {
            block_id_flag: integer(flag),
            validator_address: bytes(address),
            timestamp: integer(time),
            signature: bytes(signature),
          };
        }),
      },
    },
    signers: array(target).map((value) => decodeLeaf(value).index),
  };
  const transitions = array(sets);
  if (transitions.length) {
    if (transitions.length !== 1 || !(transitions[0] instanceof Constr)) {
      throw new Error("Invalid cache transition");
    }
    const transition = transitions[0];
    if (transition.index === 0) {
      const [packed, trusted, signers] = fields(transition, 4);
      const target = decodePackedValidators(bytes(packed));
      result.set = {
        kind: "full",
        target,
        trusted: decodePackedTrusted(bytes(trusted), target),
      };
      result.signers = array(signers).map(position);
    } else {
      const [root, changes, , signers] = fields(transition, 4, 1);
      result.set = {
        kind: "powers",
        oldRoot: bytes(root),
        changes: array(changes).map((value) => {
          const [index, key, oldPower, newPower] = fields(value, 4);
          return {
            index: position(index),
            pubkey: bytes(key),
            oldPower: integer(oldPower),
            newPower: integer(newPower),
          };
        }),
      };
      result.signers = array(signers).map(position);
    }
  }
  if (
    result.signers.length !== result.signedHeader.commit.signatures.length ||
    result.signers.some((n, i) => i > 0 && result.signers[i - 1] >= n)
  ) throw new Error("Invalid cached signer ordering");
  return result;
}

export function decodeCacheAdmission(cbor: string): CacheLeaf[][] {
  const raw = Data.from(cbor);
  if (!(raw instanceof Constr) || raw.index !== 0 || raw.fields.length !== 3) {
    return [];
  }
  return raw.fields.slice(1).map((leaves) => array(leaves).map(decodeLeaf))
    .filter((leaves) => leaves.length > 0);
}

export function validatorCacheRoots(
  datum: string,
  client: CacheToken,
  policy: string,
): string[] {
  const [token, subject, , records] = fields(Data.from(datum), 4);
  const expected = validatorCacheToken(client, policy);
  const encode = (data: Data) =>
    Data.to<Data>(data, undefined, { canonical: true });
  if (
    encode(token) !== encode(cacheTokenData(expected)) ||
    encode(subject) !== encode(cacheTokenData(client))
  ) throw new Error("Historical cache identifies another client");
  return array(records).map((value) => bytes(fields(value, 3)[0]));
}

function decodePackedValidators(packed: string): CacheLeaf[] {
  if (!packed.length || packed.length % 80 !== 0) {
    throw new Error("Invalid packed target set");
  }
  const leaves = Array.from(
    { length: packed.length / 80 },
    (_, index) => ({
      index,
      pubkey: packed.slice(index * 80, index * 80 + 64),
      power: BigInt("0x" + packed.slice(index * 80 + 64, index * 80 + 80)),
    }),
  );
  cacheRecord(leaves);
  return leaves;
}

function decodePackedTrusted(packed: string, target: CacheLeaf[]): CacheLeaf[] {
  if (!packed) return target;
  const leaves: CacheLeaf[] = [];
  let offset = 0;
  while (offset < packed.length) {
    const tag = packed.slice(offset, offset += 2);
    let pubkey: string;
    if (tag === "00") {
      const index = Number.parseInt(packed.slice(offset, offset += 2), 16);
      if (!target[index]) throw new Error("Invalid trusted target reference");
      pubkey = target[index].pubkey;
    } else if (tag === "01") pubkey = packed.slice(offset, offset += 64);
    else throw new Error("Invalid trusted row tag");
    const power = packed.slice(offset, offset += 16);
    if (power.length !== 16) throw new Error("Truncated trusted power");
    leaves.push({ index: leaves.length, pubkey, power: BigInt("0x" + power) });
  }
  cacheRecord(leaves);
  return leaves;
}

export function applyCachedPowers(
  witness: CachedUpdateWitness,
  old: CacheLeaf[],
): CacheLeaf[] {
  if (
    witness.set?.kind !== "powers" ||
    cacheRecord(old).root !== witness.set.oldRoot
  ) throw new Error("Power history does not match its old root");
  const next = old.map((leaf) => ({ ...leaf }));
  for (const change of witness.set.changes) {
    const leaf = next[change.index];
    if (
      !leaf || leaf.pubkey !== change.pubkey || leaf.power !== change.oldPower
    ) throw new Error("Invalid historical power change");
    leaf.power = change.newPower;
  }
  if (cacheRecord(next).root !== witness.signedHeader.header.validatorsHash) {
    throw new Error("Historical powers do not authenticate the new root");
  }
  return next;
}

export async function reconstructCachedHeader(
  witness: CachedUpdateWitness,
  trustedRoot: string,
  resolve: (root: string) => Promise<CacheLeaf[]>,
) {
  const target = witness.set?.kind === "full"
    ? witness.set.target
    : await resolve(witness.signedHeader.header.validatorsHash);
  const trusted = witness.set?.kind === "full"
    ? witness.set.trusted
    : await resolve(trustedRoot);
  if (
    cacheRecord(target).root !== witness.signedHeader.header.validatorsHash ||
    cacheRecord(trusted).root !== trustedRoot
  ) {
    throw new Error(
      "Recovered validator sets do not match the authenticated roots",
    );
  }
  const validator = (leaf: CacheLeaf) => ({
    pubkey: leaf.pubkey,
    address: hash(leaf.pubkey).slice(0, 40),
    votingPower: leaf.power,
    proposerPriority: 0n,
  });
  const targetValidators = target.map(validator);
  const trustedValidators = trusted.map(validator);
  const proposer = targetValidators.find((v) =>
    v.address === witness.signedHeader.header.proposerAddress
  );
  if (!proposer) {
    throw new Error("Recovered set does not contain the header proposer");
  }
  const signatures: CommitSignature[] = target.map(() => ({
    block_id_flag: 1n,
    validator_address: "",
    timestamp: 0n,
    signature: "",
  }));
  witness.signers.forEach((index, i) => {
    if (!target[index]) {
      throw new Error("Recovered signer is outside the authenticated set");
    }
    signatures[index] = witness.signedHeader.commit.signatures[i];
  });
  return {
    signedHeader: {
      ...witness.signedHeader,
      commit: { ...witness.signedHeader.commit, signatures },
    },
    trustedHeight: witness.trustedHeight,
    validatorSet: {
      validators: targetValidators,
      proposer,
      totalVotingPower: cacheRecord(target).totalPower,
    },
    trustedValidators: {
      validators: trustedValidators,
      proposer: trustedValidators[0],
      totalVotingPower: cacheRecord(trusted).totalPower,
    },
  };
}
