import crypto from 'crypto';

import {
  TENDERMINT_MULTITX_MAX_BATCH_SIZE,
  TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT,
  TendermintUpdateMode,
  TendermintValidatorRange,
} from './update-client-plan';

const BLOCK_ID_FLAG_ABSENT = 1n;
const BLOCK_ID_FLAG_COMMIT = 2n;
const BLOCK_ID_FLAG_NIL = 3n;
const MAX_INT64 = (1n << 63n) - 1n;
export const TENDERMINT_MAX_TOTAL_VOTING_POWER = MAX_INT64 / 8n;

/** Structural subset of the Gateway's decoded Tendermint Validator type. */
export interface StagedTendermintValidator {
  address: string;
  pubkey: string;
  votingPower: bigint;
  proposerPriority: bigint;
}

/** Structural subset of the Gateway's decoded Tendermint CommitSig type. */
export interface StagedTendermintCommitSig {
  block_id_flag: bigint;
  validator_address: string;
  timestamp: bigint;
  signature: string;
}

/**
 * This is deliberately structural, so the existing decoded Header can be
 * passed without coupling the pure batching code to protobuf generation.
 */
export interface DecodedTendermintHeaderForStaging {
  signedHeader: {
    header: {
      validatorsHash: string;
    };
    commit: {
      signatures: StagedTendermintCommitSig[];
    };
  };
  validatorSet: {
    validators: StagedTendermintValidator[];
  };
  trustedValidators: {
    validators: StagedTendermintValidator[];
  };
}

export interface TrustedValidatorMembershipPayload {
  index: bigint;
  trustedValidator: StagedTendermintValidator;
  /** Root-to-leaf sibling hashes, matching the on-chain verifier. */
  auditPath: string[];
}

export interface TargetValidatorEntryPayload {
  targetValidator: StagedTendermintValidator;
  commitSig: StagedTendermintCommitSig;
  trustedMembership: TrustedValidatorMembershipPayload | null;
}

export interface TrustedValidatorBatchPayload {
  range: TendermintValidatorRange;
  validators: StagedTendermintValidator[];
}

export interface TargetValidatorBatchPayload {
  range: TendermintValidatorRange;
  entries: TargetValidatorEntryPayload[];
}

export interface TendermintStagedPayloads {
  targetValidatorRoot: string;
  trustedValidatorRoot: string | null;
  trustedBatches: TrustedValidatorBatchPayload[];
  targetBatches: TargetValidatorBatchPayload[];
}

export interface BuildTendermintStagedPayloadsInput {
  header: DecodedTendermintHeaderForStaging;
  mode: TendermintUpdateMode;
  /** Required for skipped updates; sourced from the trusted consensus state. */
  expectedTrustedValidatorsHash?: string;
  batchSize?: number;
}

/**
 * Convert an already decoded and structurally verified ICS-07 header into the
 * bounded redeemer payloads consumed by the sequential session validator.
 */
export function buildTendermintStagedPayloads(input: BuildTendermintStagedPayloadsInput): TendermintStagedPayloads {
  const batchSize = validateBatchSize(input.batchSize ?? TENDERMINT_MULTITX_MAX_BATCH_SIZE);
  const targetValidators = normalizeValidatorSet('target', input.header.validatorSet.validators, false);
  const commitSignatures = input.header.signedHeader.commit.signatures.map((signature, index) =>
    normalizeCommitSignature(signature, index),
  );

  if (targetValidators.length !== commitSignatures.length) {
    throw new Error(
      `target validator/signature length mismatch: ${targetValidators.length} validators, ${commitSignatures.length} signatures`,
    );
  }

  for (let index = 0; index < targetValidators.length; index += 1) {
    validateSignatureSlot(targetValidators[index], commitSignatures[index], index);
  }

  const targetValidatorRoot = hashTendermintValidatorSet(targetValidators);
  const expectedTargetRoot = normalizeDigest(input.header.signedHeader.header.validatorsHash, 'header.validatorsHash');
  if (targetValidatorRoot !== expectedTargetRoot) {
    throw new Error(`target validator root mismatch: expected ${expectedTargetRoot}, computed ${targetValidatorRoot}`);
  }

  if (input.mode === 'adjacent') {
    return {
      targetValidatorRoot,
      trustedValidatorRoot: null,
      trustedBatches: [],
      targetBatches: partition(targetValidators, batchSize).map(({ range, values: validators }) => ({
        range,
        entries: validators.map((validator, offset) => {
          const targetIndex = range.start + offset;
          return {
            targetValidator: validator,
            commitSig: commitSignatures[targetIndex],
            trustedMembership: null,
          };
        }),
      })),
    };
  }

  if (input.mode !== 'non_adjacent') {
    throw new Error(`unsupported Tendermint update mode: ${String(input.mode)}`);
  }

  if (!input.expectedTrustedValidatorsHash) {
    throw new Error('expectedTrustedValidatorsHash is required for a non-adjacent Tendermint update');
  }

  const trustedValidators = normalizeValidatorSet('trusted', input.header.trustedValidators.validators, false);
  const trustedLeaves = trustedValidators.map(encodeTendermintSimpleValidatorBytes);
  const trustedValidatorRoot = rfc6962Root(trustedLeaves).toString('hex');
  const expectedTrustedRoot = normalizeDigest(input.expectedTrustedValidatorsHash, 'expectedTrustedValidatorsHash');
  if (trustedValidatorRoot !== expectedTrustedRoot) {
    throw new Error(
      `trusted validator root mismatch: expected ${expectedTrustedRoot}, computed ${trustedValidatorRoot}`,
    );
  }

  const trustedIndexByPublicKey = new Map<string, number>();
  trustedValidators.forEach((validator, index) => trustedIndexByPublicKey.set(validator.pubkey, index));
  const claimedTrustedIndices = new Set<number>();

  const targetEntries = targetValidators.map((validator, index): TargetValidatorEntryPayload => {
    const commitSig = commitSignatures[index];
    if (commitSig.block_id_flag !== BLOCK_ID_FLAG_COMMIT) {
      return { targetValidator: validator, commitSig, trustedMembership: null };
    }

    const trustedIndex = trustedIndexByPublicKey.get(validator.pubkey);
    if (trustedIndex === undefined) {
      return { targetValidator: validator, commitSig, trustedMembership: null };
    }
    if (claimedTrustedIndices.has(trustedIndex)) {
      throw new Error(`trusted validator index ${trustedIndex} would be selected more than once`);
    }
    claimedTrustedIndices.add(trustedIndex);

    return {
      targetValidator: validator,
      commitSig,
      trustedMembership: {
        index: BigInt(trustedIndex),
        trustedValidator: trustedValidators[trustedIndex],
        auditPath: buildRfc6962AuditPathFromLeaves(trustedLeaves, trustedIndex),
      },
    };
  });

  return {
    targetValidatorRoot,
    trustedValidatorRoot,
    trustedBatches: partition(trustedValidators, batchSize).map(({ range, values: validators }) => ({
      range,
      validators,
    })),
    targetBatches: partition(targetEntries, batchSize).map(({ range, values: entries }) => ({ range, entries })),
  };
}

/** Exact protobuf bytes hashed by CometBFT's ValidatorSet.Hash. */
export function encodeTendermintSimpleValidator(validator: StagedTendermintValidator): string {
  return encodeTendermintSimpleValidatorBytes(normalizeValidator(validator, 'validator')).toString('hex');
}

/** Exact CometBFT RFC-6962 validator-set root. */
export function hashTendermintValidatorSet(validators: readonly StagedTendermintValidator[]): string {
  const normalized = normalizeValidatorSet('validator', validators, true);
  return rfc6962Root(normalized.map(encodeTendermintSimpleValidatorBytes)).toString('hex');
}

/** Exact root-to-leaf proof format consumed by rfc6962_membership.ak. */
export function buildTendermintValidatorAuditPath(
  validators: readonly StagedTendermintValidator[],
  index: number,
): string[] {
  const normalized = normalizeValidatorSet('validator', validators, false);
  return buildRfc6962AuditPathFromLeaves(normalized.map(encodeTendermintSimpleValidatorBytes), index);
}

export function verifyTendermintValidatorMembership(input: {
  expectedRoot: string;
  validator: StagedTendermintValidator;
  index: number;
  total: number;
  auditPath: readonly string[];
}): boolean {
  try {
    const expectedRoot = Buffer.from(normalizeDigest(input.expectedRoot, 'expectedRoot'), 'hex');
    if (!Number.isSafeInteger(input.total) || input.total < 1 || input.total > TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT) {
      return false;
    }
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= input.total) {
      return false;
    }
    const path = input.auditPath.map((hash, index) => Buffer.from(normalizeDigest(hash, `auditPath[${index}]`), 'hex'));
    const validator = normalizeValidator(input.validator, 'validator');
    const actualRoot = rootFromAuditPath(
      leafHash(encodeTendermintSimpleValidatorBytes(validator)),
      input.index,
      input.total,
      path,
      0,
    );
    return actualRoot.offset === path.length && actualRoot.hash.equals(expectedRoot);
  } catch {
    return false;
  }
}

function buildRfc6962AuditPathFromLeaves(leaves: readonly Buffer[], index: number): string[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`validator index ${index} is outside a ${leaves.length}-leaf tree`);
  }

  const cache = new Map<string, Buffer>();
  const subtreeHash = (start: number, end: number): Buffer => {
    const cacheKey = `${start}:${end}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const length = end - start;
    let hash: Buffer;
    if (length === 1) {
      hash = leafHash(leaves[start]);
    } else {
      const split = start + rfc6962SplitPoint(length);
      hash = innerHash(subtreeHash(start, split), subtreeHash(split, end));
    }
    cache.set(cacheKey, hash);
    return hash;
  };

  const visit = (start: number, end: number): Buffer[] => {
    if (end - start === 1) return [];
    const split = start + rfc6962SplitPoint(end - start);
    if (index < split) {
      return [subtreeHash(split, end), ...visit(start, split)];
    }
    return [subtreeHash(start, split), ...visit(split, end)];
  };

  return visit(0, leaves.length).map((hash) => hash.toString('hex'));
}

function rfc6962Root(leaves: readonly Buffer[]): Buffer {
  if (leaves.length === 0) return sha256(Buffer.alloc(0));
  if (leaves.length === 1) return leafHash(leaves[0]);
  const split = rfc6962SplitPoint(leaves.length);
  return innerHash(rfc6962Root(leaves.slice(0, split)), rfc6962Root(leaves.slice(split)));
}

function rfc6962SplitPoint(length: number): number {
  if (!Number.isSafeInteger(length) || length <= 1) {
    throw new Error(`RFC-6962 split requires a tree length greater than one, got ${length}`);
  }
  let split = 1;
  while (split * 2 < length) split *= 2;
  return split;
}

function rootFromAuditPath(
  leaf: Buffer,
  index: number,
  total: number,
  path: readonly Buffer[],
  offset: number,
): { hash: Buffer; offset: number } {
  if (total === 1) return { hash: leaf, offset };
  if (offset >= path.length) throw new Error('truncated RFC-6962 audit path');

  const sibling = path[offset];
  const split = rfc6962SplitPoint(total);
  if (index < split) {
    const child = rootFromAuditPath(leaf, index, split, path, offset + 1);
    return { hash: innerHash(child.hash, sibling), offset: child.offset };
  }
  const child = rootFromAuditPath(leaf, index - split, total - split, path, offset + 1);
  return { hash: innerHash(sibling, child.hash), offset: child.offset };
}

function leafHash(value: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0]), value]));
}

function innerHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([1]), left, right]));
}

function sha256(value: Buffer): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

function encodeTendermintSimpleValidatorBytes(validator: StagedTendermintValidator): Buffer {
  const publicKey = encodeBytesField(1, Buffer.from(validator.pubkey, 'hex'));
  return Buffer.concat([encodeMessageField(1, publicKey), encodeVarintField(2, validator.votingPower)]);
}

function encodeVarintField(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(0);
  return Buffer.concat([encodeVarint(BigInt(fieldNumber << 3)), encodeVarint(value)]);
}

function encodeBytesField(fieldNumber: number, value: Buffer): Buffer {
  if (value.length === 0) return Buffer.alloc(0);
  return Buffer.concat([encodeVarint(BigInt((fieldNumber << 3) | 2)), encodeVarint(BigInt(value.length)), value]);
}

function encodeMessageField(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeVarint(BigInt((fieldNumber << 3) | 2)), encodeVarint(BigInt(value.length)), value]);
}

function encodeVarint(value: bigint): Buffer {
  if (value < 0n) throw new Error(`cannot encode negative protobuf varint: ${value}`);
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function normalizeValidatorSet(
  label: string,
  validators: readonly StagedTendermintValidator[],
  allowEmpty: boolean,
): StagedTendermintValidator[] {
  if (!Array.isArray(validators) || (!allowEmpty && validators.length === 0)) {
    throw new Error(`${label} validator set must be non-empty`);
  }
  if (validators.length > TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT) {
    throw new Error(`${label} validator count ${validators.length} exceeds ${TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT}`);
  }

  const normalized = validators.map((validator, index) => normalizeValidator(validator, `${label}[${index}]`));
  const publicKeys = new Set<string>();
  const addresses = new Set<string>();
  normalized.forEach((validator, index) => {
    if (publicKeys.has(validator.pubkey)) {
      throw new Error(`${label} validator set has duplicate public key at index ${index}`);
    }
    if (addresses.has(validator.address)) {
      throw new Error(`${label} validator set has duplicate address at index ${index}`);
    }
    publicKeys.add(validator.pubkey);
    addresses.add(validator.address);
  });
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    const isCanonical =
      previous.votingPower > current.votingPower ||
      (previous.votingPower === current.votingPower && previous.address < current.address);
    if (!isCanonical) {
      throw new Error(`${label} validator set is not in canonical voting-power/address order at index ${index}`);
    }
  }
  let totalVotingPower = 0n;
  normalized.forEach((validator) => {
    totalVotingPower += validator.votingPower;
    if (totalVotingPower > TENDERMINT_MAX_TOTAL_VOTING_POWER) {
      throw new Error(`${label} total voting power exceeds ${TENDERMINT_MAX_TOTAL_VOTING_POWER.toString(10)}`);
    }
  });
  return normalized;
}

function normalizeValidator(validator: StagedTendermintValidator, label: string): StagedTendermintValidator {
  if (!validator) throw new Error(`${label} validator is missing`);
  const pubkey = normalizeHex(validator.pubkey, 32, `${label}.pubkey`);
  const address = normalizeHex(validator.address, 20, `${label}.address`);
  const expectedAddress = sha256(Buffer.from(pubkey, 'hex')).subarray(0, 20).toString('hex');
  if (address !== expectedAddress) {
    throw new Error(`${label}.address does not match SHA-256(public key)`);
  }
  if (typeof validator.votingPower !== 'bigint' || validator.votingPower <= 0n || validator.votingPower > MAX_INT64) {
    throw new Error(`${label}.votingPower must be a positive signed int64`);
  }
  if (typeof validator.proposerPriority !== 'bigint') {
    throw new Error(`${label}.proposerPriority must be a bigint`);
  }
  return { ...validator, address, pubkey };
}

function normalizeCommitSignature(signature: StagedTendermintCommitSig, index: number): StagedTendermintCommitSig {
  const label = `commit.signatures[${index}]`;
  if (!signature || typeof signature.block_id_flag !== 'bigint' || typeof signature.timestamp !== 'bigint') {
    throw new Error(`${label} is malformed`);
  }
  if (![BLOCK_ID_FLAG_ABSENT, BLOCK_ID_FLAG_COMMIT, BLOCK_ID_FLAG_NIL].includes(signature.block_id_flag)) {
    throw new Error(`${label}.block_id_flag is unsupported`);
  }
  return {
    ...signature,
    validator_address: normalizeEvenHex(signature.validator_address, `${label}.validator_address`),
    signature: normalizeEvenHex(signature.signature, `${label}.signature`),
  };
}

function validateSignatureSlot(
  validator: StagedTendermintValidator,
  signature: StagedTendermintCommitSig,
  index: number,
): void {
  if (signature.block_id_flag === BLOCK_ID_FLAG_ABSENT) {
    if (signature.validator_address !== '' || signature.signature !== '' || signature.timestamp !== 0n) {
      throw new Error(`absent commit signature at index ${index} must not contain vote data`);
    }
    return;
  }
  if (signature.validator_address !== validator.address) {
    throw new Error(`commit signature address does not match target validator at index ${index}`);
  }
  const signatureByteLength = signature.signature.length / 2;
  if (signatureByteLength < 1 || signatureByteLength > 64) {
    throw new Error(`commit signature at index ${index} must contain at most 64 bytes`);
  }
}

function normalizeDigest(value: string, label: string): string {
  return normalizeHex(value, 32, label);
}

function normalizeHex(value: string, byteLength: number, label: string): string {
  const normalized = normalizeEvenHex(value, label);
  if (normalized.length !== byteLength * 2) {
    throw new Error(`${label} must be ${byteLength} bytes`);
  }
  return normalized;
}

function normalizeEvenHex(value: string, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be hexadecimal`);
  const normalized = value.toLowerCase();
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/.test(normalized)) {
    throw new Error(`${label} must be even-length hexadecimal`);
  }
  return normalized;
}

function validateBatchSize(batchSize: number): number {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > TENDERMINT_MULTITX_MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer between 1 and ${TENDERMINT_MULTITX_MAX_BATCH_SIZE}`);
  }
  return batchSize;
}

function partition<T>(
  values: readonly T[],
  batchSize: number,
): Array<{ range: TendermintValidatorRange; values: T[] }> {
  const batches: Array<{ range: TendermintValidatorRange; values: T[] }> = [];
  for (let start = 0; start < values.length; start += batchSize) {
    const end = Math.min(start + batchSize, values.length);
    batches.push({ range: { start, end }, values: values.slice(start, end) });
  }
  return batches;
}
