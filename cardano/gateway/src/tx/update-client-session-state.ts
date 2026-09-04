import crypto from 'crypto';

import type { ClientDatum } from '../shared/types/client-datum';
import type { BlockID, CommitSig } from '../shared/types/cometbft/commit';
import type { TmHeader } from '../shared/types/cometbft/header';
import type { Validator } from '../shared/types/cometbft/validator';
import type { ConsensusState } from '../shared/types/consensus-state';
import type { Header } from '../shared/types/header';
import { ledgerVisibleValidityUpperBoundMs, type SlotConfig } from '../shared/helpers/time';
import type {
  MerkleAccumulator,
  SessionDatum,
  SessionPhase,
  SpendSessionRedeemer,
  TargetEntry,
  UpdatePlan,
  ValidatorOrderKey,
} from '../shared/types/tendermint-update-session';
import {
  encodeTendermintSimpleValidator,
  TENDERMINT_MAX_TOTAL_VOTING_POWER,
  TendermintStagedPayloads,
  verifyTendermintValidatorMembership,
} from './update-client-staged-payload';
import { TENDERMINT_MULTITX_MAX_BATCH_SIZE, TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT } from './update-client-plan';

const BLOCK_ID_FLAG_ABSENT = 1n;
const BLOCK_ID_FLAG_COMMIT = 2n;
const BLOCK_ID_FLAG_NIL = 3n;
const PRECOMMIT_TYPE = 2n;
const NANOS_PER_SECOND = 1_000_000_000n;
const NANOS_PER_MILLISECOND = 1_000_000n;
const MIN_TIMESTAMP_SECONDS = -62_135_596_800n;
const MAX_TIMESTAMP_SECONDS = 253_402_300_800n;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Keep the transaction upper bound strictly clear of the on-chain trust deadline. */
export const TENDERMINT_UPDATE_EXPIRY_SAFETY_MARGIN_MS = 5_000;
/** Do not create a staged session unless at least the ordinary transaction TTL remains. */
export const TENDERMINT_UPDATE_MIN_REMAINING_VALIDITY_MS = 120_000;

export type TendermintSessionAdvanceRedeemer = Exclude<SpendSessionRedeemer, 'Finalize' | 'Cancel'>;

interface DeriveTendermintSessionUpdatePlanInput {
  header: Header;
  clientDatum: ClientDatum;
  /**
   * Optional explicit copy supplied by a caller that has already selected the
   * trusted state. It must still equal the unique state at trustedHeight in the
   * current ClientDatum.
   */
  trustedConsensusState?: ConsensusState;
}

interface CapTendermintStagedValidToInput {
  proposedValidToMs: number;
  currentLedgerTimeMs: number;
  trustedHeight: UpdatePlan['trustedHeight'];
  clientDatum: ClientDatum;
  slotConfig: SlotConfig;
  safetyMarginMs?: number;
  minimumRemainingValidityMs?: number;
}

interface ValidateTendermintStagedFinalizationInput {
  validFromTimeMs: number;
  trustedHeight: UpdatePlan['trustedHeight'];
  headerTimeNs: bigint;
  clientDatum: ClientDatum;
}

/**
 * Reject finalization conditions that are already known before a staged
 * session is created. The on-chain validator repeats these checks and remains
 * authoritative.
 */
export function validateTendermintStagedFinalization(input: ValidateTendermintStagedFinalizationInput): void {
  const { validFromTimeMs, trustedHeight, headerTimeNs, clientDatum } = input;
  if (!Number.isSafeInteger(validFromTimeMs) || validFromTimeMs < 0) {
    throw new Error('validFromTimeMs must be a non-negative safe integer');
  }
  if (typeof headerTimeNs !== 'bigint') {
    throw new Error('header time must be an integer nanosecond timestamp');
  }

  const clientState = clientDatum.state.clientState;
  if (clientState.frozenHeight.revisionNumber !== 0n || clientState.frozenHeight.revisionHeight !== 0n) {
    throw new Error('Tendermint client is frozen');
  }
  if (typeof clientState.maxClockDrift !== 'bigint' || clientState.maxClockDrift <= 0n) {
    throw new Error('client max clock drift must be positive');
  }

  const trustedConsensusState = resolveTrustedConsensusState(clientDatum, trustedHeight);
  if (headerTimeNs <= trustedConsensusState.timestamp) {
    throw new Error('header time must be after the trusted consensus state timestamp');
  }
  const latestConsensusState = resolveTrustedConsensusState(clientDatum, clientState.latestHeight);
  if (headerTimeNs <= latestConsensusState.timestamp) {
    throw new Error('header time must be after the current latest consensus state timestamp');
  }
  const validFromTimeNs = BigInt(validFromTimeMs) * NANOS_PER_MILLISECOND;
  if (headerTimeNs >= validFromTimeNs + clientState.maxClockDrift) {
    throw new Error('header time must be before the validity lower bound plus max clock drift');
  }
}

/**
 * Bound the shared transaction-chain TTL by the two expirations checked during
 * finalization: the selected trusted state and the client's latest state.
 * This prevents paying for every verification link when the final transaction
 * is already guaranteed to fail because its validity upper bound is too late.
 */
export function capTendermintStagedValidTo(input: CapTendermintStagedValidToInput): number {
  const {
    proposedValidToMs,
    currentLedgerTimeMs,
    trustedHeight,
    clientDatum,
    slotConfig,
    safetyMarginMs = TENDERMINT_UPDATE_EXPIRY_SAFETY_MARGIN_MS,
    minimumRemainingValidityMs = TENDERMINT_UPDATE_MIN_REMAINING_VALIDITY_MS,
  } = input;
  for (const [label, value] of [
    ['proposedValidToMs', proposedValidToMs],
    ['currentLedgerTimeMs', currentLedgerTimeMs],
    ['safetyMarginMs', safetyMarginMs],
    ['minimumRemainingValidityMs', minimumRemainingValidityMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }

  const clientState = clientDatum.state.clientState;
  if (typeof clientState.trustingPeriod !== 'bigint' || clientState.trustingPeriod <= 0n) {
    throw new Error('client trusting period must be positive');
  }
  const trustedConsensusState = resolveTrustedConsensusState(clientDatum, trustedHeight);
  const latestConsensusState = resolveTrustedConsensusState(clientDatum, clientState.latestHeight);
  const trustedExpirationNs = trustedConsensusState.timestamp + clientState.trustingPeriod;
  const latestExpirationNs = latestConsensusState.timestamp + clientState.trustingPeriod;
  const earliestExpirationNs = trustedExpirationNs < latestExpirationNs ? trustedExpirationNs : latestExpirationNs;
  const latestSafeUpperBoundNs = earliestExpirationNs - BigInt(safetyMarginMs) * NANOS_PER_MILLISECOND - 1n;
  if (latestSafeUpperBoundNs < 0n) {
    throw new Error('Tendermint client trust deadline has already passed');
  }

  const latestSafeUpperBoundMs = latestSafeUpperBoundNs / NANOS_PER_MILLISECOND;
  if (latestSafeUpperBoundMs > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Tendermint client trust deadline is outside the supported time range');
  }
  const cappedValidToMs = ledgerVisibleValidityUpperBoundMs(
    Math.min(proposedValidToMs, Number(latestSafeUpperBoundMs)),
    slotConfig,
  );
  if (cappedValidToMs - currentLedgerTimeMs < minimumRemainingValidityMs) {
    throw new Error(
      `Tendermint update has less than ${minimumRemainingValidityMs}ms before the safe trust deadline; refresh the client before creating a staged session`,
    );
  }
  return cappedValidToMs;
}

/**
 * Extract the immutable Aiken UpdatePlan from the decoded ICS-07 Header and
 * the live client. Validator/signature arrays remain in the staged payloads.
 */
export function deriveTendermintSessionUpdatePlan(input: DeriveTendermintSessionUpdatePlanInput): UpdatePlan {
  const { header, clientDatum } = input;
  const tmHeader = header.signedHeader.header;
  const trustedHeight = {
    revisionNumber: requireBigInt(header.trustedHeight.revisionNumber, 'trustedHeight.revisionNumber'),
    revisionHeight: requireBigInt(header.trustedHeight.revisionHeight, 'trustedHeight.revisionHeight'),
  };
  const trustedConsensusState = resolveTrustedConsensusState(clientDatum, trustedHeight, input.trustedConsensusState);
  const clientState = clientDatum.state.clientState;

  if (
    normalizeEvenHex(clientState.chainId, 'clientState.chainId') !==
    normalizeEvenHex(tmHeader.chainId, 'header.chainId')
  ) {
    throw new Error('header chain ID does not match the current Tendermint client');
  }
  if (tmHeader.height <= trustedHeight.revisionHeight) {
    throw new Error('header height must be greater than the trusted height');
  }
  if (trustedHeight.revisionHeight <= 0n) {
    throw new Error('trusted height must be positive');
  }
  if (parseChainIdRevision(tmHeader.chainId) !== trustedHeight.revisionNumber) {
    throw new Error('trusted height revision does not match the header chain ID');
  }
  if (header.signedHeader.commit.height !== tmHeader.height) {
    throw new Error('commit height does not match the Tendermint header height');
  }
  if (header.signedHeader.commit.round < 0n) {
    throw new Error('commit round must be non-negative');
  }

  validateValidatorCount('target', header.validatorSet.validators.length, false);
  const adjacent = tmHeader.height === trustedHeight.revisionHeight + 1n;
  if (!adjacent) validateValidatorCount('trusted', header.trustedValidators.validators.length, false);

  validateDigest(tmHeader.validatorsHash, 'header.validatorsHash');
  validateDigest(tmHeader.nextValidatorsHash, 'header.nextValidatorsHash');
  validateDigest(trustedConsensusState.next_validators_hash, 'trustedConsensusState.next_validators_hash');
  validateTrustLevel(clientState.trustLevel.numerator, clientState.trustLevel.denominator);
  if (clientState.trustingPeriod <= 0n) throw new Error('client trusting period must be positive');
  if (clientState.maxClockDrift <= 0n) throw new Error('client max clock drift must be positive');

  return {
    clientToken: { ...clientDatum.token },
    trustedHeight,
    trustedConsensusState: cloneConsensusState(trustedConsensusState),
    trustLevel: { ...clientState.trustLevel },
    trustingPeriod: clientState.trustingPeriod,
    maxClockDrift: clientState.maxClockDrift,
    header: cloneTmHeader(tmHeader),
    commit: {
      height: header.signedHeader.commit.height,
      round: header.signedHeader.commit.round,
      blockId: cloneBlockId(header.signedHeader.commit.blockId),
    },
    targetValidatorCount: BigInt(header.validatorSet.validators.length),
    // Adjacent plans canonically commit to zero because the relayed trusted
    // validator set is unused by the session validator in this mode.
    trustedValidatorCount: adjacent ? 0n : BigInt(header.trustedValidators.validators.length),
  };
}

/** Exact initial phase selected by session.initial_datum after plan validation. */
export function initialTendermintSessionPhase(plan: UpdatePlan): SessionPhase {
  validatePlanValidatorCounts(plan);
  if (isAdjacent(plan)) {
    return {
      AdjacentTarget: {
        targetAccumulator: emptyTendermintMerkleAccumulator(),
        targetTotalPower: 0n,
        targetSignedPower: 0n,
        lastTarget: null,
      },
    };
  }
  return {
    NonAdjacentTrusted: {
      trustedAccumulator: emptyTendermintMerkleAccumulator(),
      trustedTotalPower: 0n,
      lastTrusted: null,
    },
  };
}

/**
 * Pure mirror of session.advance. The returned datum can be encoded as the
 * unique continuation datum for the next verification transaction.
 */
export function advanceTendermintSession(
  datum: SessionDatum,
  redeemer: TendermintSessionAdvanceRedeemer,
): SessionDatum {
  if ('VerifyTrusted' in redeemer) {
    return advanceTrusted(datum, redeemer.VerifyTrusted.validators);
  }
  if ('VerifyTarget' in redeemer) {
    return advanceTarget(datum, redeemer.VerifyTarget.entries);
  }
  throw new Error('terminal session actions cannot advance a session datum');
}

/**
 * Select the next bounded verification redeemer from decoded on-chain
 * progress. Payload partition boundaries are intentionally ignored: a retry
 * resumes at the accumulator count even if earlier transactions used smaller
 * batches.
 */
export function nextTendermintSessionAdvance(
  datum: SessionDatum,
  payloads: TendermintStagedPayloads,
  batchSize = TENDERMINT_MULTITX_MAX_BATCH_SIZE,
): TendermintSessionAdvanceRedeemer | null {
  validateBatchLength(batchSize);
  if ('Complete' in datum.phase) return null;

  if ('NonAdjacentTrusted' in datum.phase) {
    const validators = flattenPayloadBatches(payloads.trustedBatches, (batch) => batch.validators, 'trusted validator');
    const start = sessionProgressIndex(
      datum.phase.NonAdjacentTrusted.trustedAccumulator.count,
      datum.plan.trustedValidatorCount,
      validators.length,
      'trusted validator',
    );
    return { VerifyTrusted: { validators: validators.slice(start, start + batchSize) } };
  }

  const entries = flattenPayloadBatches(payloads.targetBatches, (batch) => batch.entries, 'target validator');
  const count =
    'AdjacentTarget' in datum.phase
      ? datum.phase.AdjacentTarget.targetAccumulator.count
      : datum.phase.NonAdjacentTarget.targetAccumulator.count;
  const start = sessionProgressIndex(count, datum.plan.targetValidatorCount, entries.length, 'target validator');
  return { VerifyTarget: { entries: entries.slice(start, start + batchSize) } };
}

export function emptyTendermintMerkleAccumulator(): MerkleAccumulator {
  return { count: 0n, peaks: [] };
}

/** Append one un-hashed CometBFT SimpleValidator protobuf value. */
export function appendTendermintMerkleAccumulator(
  accumulator: MerkleAccumulator,
  validatorBytes: string,
): MerkleAccumulator {
  validateAccumulator(accumulator);
  const incomingRoot = leafHash(Buffer.from(normalizeEvenHex(validatorBytes, 'validatorBytes'), 'hex')).toString('hex');
  let incoming = { size: 1n, root: incomingRoot };
  let peakIndex = 0;

  while (peakIndex < accumulator.peaks.length && accumulator.peaks[peakIndex].size === incoming.size) {
    incoming = {
      size: incoming.size * 2n,
      root: innerHash(
        Buffer.from(accumulator.peaks[peakIndex].root, 'hex'),
        Buffer.from(incoming.root, 'hex'),
      ).toString('hex'),
    };
    peakIndex += 1;
  }
  if (peakIndex < accumulator.peaks.length && incoming.size >= accumulator.peaks[peakIndex].size) {
    throw new Error('Merkle accumulator peaks are not in canonical smallest-to-largest order');
  }

  return {
    count: accumulator.count + 1n,
    peaks: [incoming, ...accumulator.peaks.slice(peakIndex).map((peak) => ({ ...peak }))],
  };
}

/** Finalize the streaming peaks to CometBFT's exact RFC-6962 root. */
export function tendermintMerkleAccumulatorRoot(accumulator: MerkleAccumulator): string {
  validateAccumulator(accumulator);
  if (accumulator.count === 0n) return sha256(Buffer.alloc(0)).toString('hex');

  const peaks = [...accumulator.peaks].reverse();
  let root: Buffer<ArrayBufferLike> = Buffer.from(peaks[peaks.length - 1].root, 'hex');
  for (let index = peaks.length - 2; index >= 0; index -= 1) {
    root = innerHash(Buffer.from(peaks[index].root, 'hex'), root);
  }
  return root.toString('hex');
}

function advanceTrusted(datum: SessionDatum, validators: Validator[]): SessionDatum {
  if (!('NonAdjacentTrusted' in datum.phase)) {
    throw new Error('trusted validator batch submitted in the wrong session phase');
  }
  validateBatchLength(validators.length);
  const current = datum.phase.NonAdjacentTrusted;
  if (current.trustedAccumulator.count + BigInt(validators.length) > datum.plan.trustedValidatorCount) {
    throw new Error('trusted validator batch exceeds the plan validator count');
  }

  let accumulator = cloneAccumulator(current.trustedAccumulator);
  let totalPower = current.trustedTotalPower;
  let lastTrusted = current.lastTrusted ? { ...current.lastTrusted } : null;

  validators.forEach((validator, index) => {
    const normalized = normalizeValidator(validator, `validators[${index}]`);
    requireCanonicalOrder(lastTrusted, normalized, `validators[${index}]`);
    accumulator = appendTendermintMerkleAccumulator(accumulator, encodeTendermintSimpleValidator(normalized));
    totalPower = addVotingPower(totalPower, normalized.votingPower);
    lastTrusted = orderKey(normalized);
  });

  let phase: SessionPhase;
  if (accumulator.count === datum.plan.trustedValidatorCount) {
    const trustedRoot = tendermintMerkleAccumulatorRoot(accumulator);
    if (trustedRoot !== validateDigest(datum.plan.trustedConsensusState.next_validators_hash, 'trusted root')) {
      throw new Error('trusted validator accumulator root does not match the trusted consensus state');
    }
    phase = {
      NonAdjacentTarget: {
        trustedRoot,
        trustedTotalPower: totalPower,
        targetAccumulator: emptyTendermintMerkleAccumulator(),
        targetTotalPower: 0n,
        targetSignedPower: 0n,
        trustedSignedPower: 0n,
        usedTrustedIndices: 0n,
        lastTarget: null,
      },
    };
  } else {
    phase = {
      NonAdjacentTrusted: {
        trustedAccumulator: accumulator,
        trustedTotalPower: totalPower,
        lastTrusted,
      },
    };
  }

  return { ...datum, phase };
}

function advanceTarget(datum: SessionDatum, entries: TargetEntry[]): SessionDatum {
  validateBatchLength(entries.length);
  if ('AdjacentTarget' in datum.phase) return advanceAdjacentTarget(datum, entries);
  if ('NonAdjacentTarget' in datum.phase) return advanceNonAdjacentTarget(datum, entries);
  throw new Error('target validator batch submitted in the wrong session phase');
}

function advanceAdjacentTarget(datum: SessionDatum, entries: TargetEntry[]): SessionDatum {
  if (!('AdjacentTarget' in datum.phase)) throw new Error('adjacent target phase is required');
  const current = datum.phase.AdjacentTarget;
  requireBatchWithinPlan(current.targetAccumulator.count, entries.length, datum.plan.targetValidatorCount, 'target');

  let accumulator = cloneAccumulator(current.targetAccumulator);
  let totalPower = current.targetTotalPower;
  let signedPower = current.targetSignedPower;
  let lastTarget = current.lastTarget ? { ...current.lastTarget } : null;

  entries.forEach((entry, index) => {
    const { validator, signature } = validateSignatureSlot(entry, index);
    if (entry.trustedMembership !== null) {
      throw new Error(`entries[${index}].trustedMembership must be null for an adjacent update`);
    }
    requireCanonicalOrder(lastTarget, validator, `entries[${index}].targetValidator`);
    if (signature.block_id_flag === BLOCK_ID_FLAG_COMMIT) {
      verifyCommitSignature(datum.plan, validator, signature, index);
      signedPower += validator.votingPower;
    }
    accumulator = appendTendermintMerkleAccumulator(accumulator, encodeTendermintSimpleValidator(validator));
    totalPower = addVotingPower(totalPower, validator.votingPower);
    lastTarget = orderKey(validator);
  });

  if (accumulator.count !== datum.plan.targetValidatorCount) {
    return {
      ...datum,
      phase: {
        AdjacentTarget: {
          targetAccumulator: accumulator,
          targetTotalPower: totalPower,
          targetSignedPower: signedPower,
          lastTarget,
        },
      },
    };
  }

  const targetRoot = validateCompletedTarget(datum.plan, accumulator, totalPower, signedPower);
  if (targetRoot !== validateDigest(datum.plan.trustedConsensusState.next_validators_hash, 'trusted root')) {
    throw new Error('adjacent target root does not match the trusted consensus state');
  }
  return {
    ...datum,
    phase: {
      Complete: {
        targetRoot,
        targetTotalPower: totalPower,
        targetSignedPower: signedPower,
        trustedRoot: null,
        trustedTotalPower: 0n,
        trustedSignedPower: 0n,
      },
    },
  };
}

function advanceNonAdjacentTarget(datum: SessionDatum, entries: TargetEntry[]): SessionDatum {
  if (!('NonAdjacentTarget' in datum.phase)) throw new Error('non-adjacent target phase is required');
  const current = datum.phase.NonAdjacentTarget;
  requireBatchWithinPlan(current.targetAccumulator.count, entries.length, datum.plan.targetValidatorCount, 'target');

  let accumulator = cloneAccumulator(current.targetAccumulator);
  let totalPower = current.targetTotalPower;
  let signedPower = current.targetSignedPower;
  let trustedSignedPower = current.trustedSignedPower;
  let usedTrustedIndices = current.usedTrustedIndices;
  let lastTarget = current.lastTarget ? { ...current.lastTarget } : null;

  entries.forEach((entry, index) => {
    const { validator, signature } = validateSignatureSlot(entry, index);
    requireCanonicalOrder(lastTarget, validator, `entries[${index}].targetValidator`);
    const isCommit = signature.block_id_flag === BLOCK_ID_FLAG_COMMIT;
    if (isCommit) {
      verifyCommitSignature(datum.plan, validator, signature, index);
      signedPower += validator.votingPower;
    } else if (entry.trustedMembership !== null) {
      throw new Error(`entries[${index}] cannot include trusted membership without a commit signature`);
    }

    if (entry.trustedMembership !== null) {
      const membership = entry.trustedMembership;
      const trustedValidator = normalizeValidator(membership.trustedValidator, `entries[${index}].trustedMembership`);
      if (trustedValidator.pubkey !== validator.pubkey) {
        throw new Error(`entries[${index}] trusted and target public keys differ`);
      }
      const membershipIndex = requireTrustedIndex(membership.index, datum.plan.trustedValidatorCount, index);
      if (
        !verifyTendermintValidatorMembership({
          expectedRoot: current.trustedRoot,
          validator: trustedValidator,
          index: membershipIndex,
          total: Number(datum.plan.trustedValidatorCount),
          auditPath: membership.auditPath,
        })
      ) {
        throw new Error(`entries[${index}] has an invalid trusted validator membership proof`);
      }
      const seenBit = 1n << BigInt(membershipIndex);
      if ((usedTrustedIndices / seenBit) % 2n !== 0n) {
        throw new Error(`trusted validator index ${membershipIndex} has already contributed voting power`);
      }
      trustedSignedPower += trustedValidator.votingPower;
      usedTrustedIndices += seenBit;
    }

    accumulator = appendTendermintMerkleAccumulator(accumulator, encodeTendermintSimpleValidator(validator));
    totalPower = addVotingPower(totalPower, validator.votingPower);
    lastTarget = orderKey(validator);
  });

  if (accumulator.count !== datum.plan.targetValidatorCount) {
    return {
      ...datum,
      phase: {
        NonAdjacentTarget: {
          trustedRoot: current.trustedRoot,
          trustedTotalPower: current.trustedTotalPower,
          targetAccumulator: accumulator,
          targetTotalPower: totalPower,
          targetSignedPower: signedPower,
          trustedSignedPower,
          usedTrustedIndices,
          lastTarget,
        },
      },
    };
  }

  const targetRoot = validateCompletedTarget(datum.plan, accumulator, totalPower, signedPower);
  if (!trustedQuorum(datum.plan, trustedSignedPower, current.trustedTotalPower)) {
    throw new Error('trusted validator overlap does not exceed the configured trust level');
  }
  return {
    ...datum,
    phase: {
      Complete: {
        targetRoot,
        targetTotalPower: totalPower,
        targetSignedPower: signedPower,
        trustedRoot: current.trustedRoot,
        trustedTotalPower: current.trustedTotalPower,
        trustedSignedPower,
      },
    },
  };
}

function validateCompletedTarget(
  plan: UpdatePlan,
  accumulator: MerkleAccumulator,
  totalPower: bigint,
  signedPower: bigint,
): string {
  const targetRoot = tendermintMerkleAccumulatorRoot(accumulator);
  if (targetRoot !== validateDigest(plan.header.validatorsHash, 'header.validatorsHash')) {
    throw new Error('target validator accumulator root does not match the Tendermint header');
  }
  if (signedPower * 3n <= totalPower * 2n) {
    throw new Error('target commit voting power does not exceed two thirds');
  }
  return targetRoot;
}

function validateSignatureSlot(entry: TargetEntry, index: number): { validator: Validator; signature: CommitSig } {
  const validator = normalizeValidator(entry.targetValidator, `entries[${index}].targetValidator`);
  const signature = normalizeCommitSignature(entry.commitSig, `entries[${index}].commitSig`);
  if (
    (signature.block_id_flag === BLOCK_ID_FLAG_COMMIT || signature.block_id_flag === BLOCK_ID_FLAG_NIL) &&
    signature.validator_address !== validator.address
  ) {
    throw new Error(`entries[${index}] commit signature address does not match its target validator`);
  }
  return { validator, signature };
}

function verifyCommitSignature(plan: UpdatePlan, validator: Validator, signature: CommitSig, index: number): void {
  const message = canonicalVoteSignBytes(plan, signature.timestamp);
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(validator.pubkey, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  if (!crypto.verify(null, message, publicKey, Buffer.from(signature.signature, 'hex'))) {
    throw new Error(`entries[${index}] has an invalid Ed25519 commit signature`);
  }
}

function canonicalVoteSignBytes(plan: UpdatePlan, timestamp: bigint): Buffer {
  const fields = [
    encodeVarintField(1, PRECOMMIT_TYPE),
    encodeFixed64Field(2, plan.commit.height),
    encodeFixed64Field(3, plan.commit.round),
    encodeMessageField(4, encodeBlockId(plan.commit.blockId)),
    encodeMessageField(5, encodeTimestamp(timestamp)),
    encodeBytesField(6, Buffer.from(normalizeEvenHex(plan.header.chainId, 'header.chainId'), 'hex')),
  ];
  const message = Buffer.concat(fields);
  return Buffer.concat([encodeUnsignedVarint(BigInt(message.length)), message]);
}

function encodeBlockId(blockId: BlockID): Buffer {
  const partSetHeader = Buffer.concat([
    encodeVarintField(1, blockId.partSetHeader.total),
    encodeBytesField(2, Buffer.from(normalizeEvenHex(blockId.partSetHeader.hash, 'blockId.partSetHeader.hash'), 'hex')),
  ]);
  return Buffer.concat([
    encodeBytesField(1, Buffer.from(normalizeEvenHex(blockId.hash, 'blockId.hash'), 'hex')),
    encodeMessageField(2, partSetHeader),
  ]);
}

function encodeTimestamp(nanoseconds: bigint): Buffer {
  const seconds = nanoseconds / NANOS_PER_SECOND;
  const nanos = nanoseconds % NANOS_PER_SECOND;
  if (seconds < MIN_TIMESTAMP_SECONDS || seconds >= MAX_TIMESTAMP_SECONDS || nanos < 0n || nanos > NANOS_PER_SECOND) {
    throw new Error('commit signature timestamp is outside the protobuf Timestamp range');
  }
  return Buffer.concat([encodeSignedVarintField(1, seconds), encodeSignedVarintField(2, nanos)]);
}

function encodeFixed64Field(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(0);
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt.asUintN(64, value));
  return Buffer.concat([Buffer.from([(fieldNumber << 3) | 1]), bytes]);
}

function encodeVarintField(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(0);
  if (value < 0n) throw new Error('protobuf unsigned integer cannot be negative');
  return Buffer.concat([encodeUnsignedVarint(BigInt(fieldNumber << 3)), encodeUnsignedVarint(value)]);
}

function encodeSignedVarintField(fieldNumber: number, value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(0);
  return Buffer.concat([
    encodeUnsignedVarint(BigInt(fieldNumber << 3)),
    encodeUnsignedVarint(BigInt.asUintN(64, value)),
  ]);
}

function encodeBytesField(fieldNumber: number, value: Buffer): Buffer {
  if (value.length === 0) return Buffer.alloc(0);
  return Buffer.concat([
    encodeUnsignedVarint(BigInt((fieldNumber << 3) | 2)),
    encodeUnsignedVarint(BigInt(value.length)),
    value,
  ]);
}

function encodeMessageField(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([
    encodeUnsignedVarint(BigInt((fieldNumber << 3) | 2)),
    encodeUnsignedVarint(BigInt(value.length)),
    value,
  ]);
}

function encodeUnsignedVarint(value: bigint): Buffer {
  if (value < 0n) throw new Error('cannot encode a negative unsigned varint');
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function normalizeValidator(validator: Validator, label: string): Validator {
  if (!validator) throw new Error(`${label} is missing`);
  const pubkey = normalizeHex(validator.pubkey, 32, `${label}.pubkey`);
  const address = normalizeHex(validator.address, 20, `${label}.address`);
  const expectedAddress = sha256(Buffer.from(pubkey, 'hex')).subarray(0, 20).toString('hex');
  if (address !== expectedAddress) throw new Error(`${label}.address does not match SHA-256(public key)`);
  if (typeof validator.votingPower !== 'bigint' || validator.votingPower <= 0n) {
    throw new Error(`${label}.votingPower must be positive`);
  }
  if (typeof validator.proposerPriority !== 'bigint') throw new Error(`${label}.proposerPriority must be a bigint`);
  return { ...validator, address, pubkey };
}

function normalizeCommitSignature(signature: CommitSig, label: string): CommitSig {
  if (!signature || typeof signature.block_id_flag !== 'bigint' || typeof signature.timestamp !== 'bigint') {
    throw new Error(`${label} is malformed`);
  }
  const validatorAddress = normalizeEvenHex(signature.validator_address, `${label}.validator_address`);
  const signatureBytes = normalizeEvenHex(signature.signature, `${label}.signature`);

  if (signature.block_id_flag === BLOCK_ID_FLAG_ABSENT) {
    if (validatorAddress !== '' || signature.timestamp !== 0n || signatureBytes !== '') {
      throw new Error(`${label} absent signature must not contain vote data`);
    }
  } else if (signature.block_id_flag === BLOCK_ID_FLAG_COMMIT || signature.block_id_flag === BLOCK_ID_FLAG_NIL) {
    if (validatorAddress.length !== 40) throw new Error(`${label}.validator_address must be 20 bytes`);
    if (signatureBytes.length === 0 || signatureBytes.length > 128) {
      throw new Error(`${label}.signature must contain between 1 and 64 bytes`);
    }
  } else {
    throw new Error(`${label}.block_id_flag is unsupported`);
  }

  return { ...signature, validator_address: validatorAddress, signature: signatureBytes };
}

function requireCanonicalOrder(previous: ValidatorOrderKey | null, current: Validator, label: string): void {
  if (!previous) return;
  const follows =
    current.votingPower < previous.votingPower ||
    (current.votingPower === previous.votingPower &&
      Buffer.compare(Buffer.from(previous.address, 'hex'), Buffer.from(current.address, 'hex')) < 0);
  if (!follows) throw new Error(`${label} does not follow canonical voting-power/address order`);
}

function orderKey(validator: Validator): ValidatorOrderKey {
  return { votingPower: validator.votingPower, address: validator.address };
}

function addVotingPower(total: bigint, votingPower: bigint): bigint {
  const next = total + votingPower;
  if (next > TENDERMINT_MAX_TOTAL_VOTING_POWER) {
    throw new Error(`total voting power exceeds ${TENDERMINT_MAX_TOTAL_VOTING_POWER.toString(10)}`);
  }
  return next;
}

function requireTrustedIndex(index: bigint, trustedCount: bigint, entryIndex: number): number {
  if (typeof index !== 'bigint' || index < 0n || index >= trustedCount) {
    throw new Error(`entries[${entryIndex}].trustedMembership.index is outside the trusted validator set`);
  }
  return Number(index);
}

function trustedQuorum(plan: UpdatePlan, signedPower: bigint, totalPower: bigint): boolean {
  const { numerator, denominator } = plan.trustLevel;
  validateTrustLevel(numerator, denominator);
  return signedPower * denominator > totalPower * numerator;
}

function validateTrustLevel(numerator: bigint, denominator: bigint): void {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n) {
    throw new Error('trust level must have a positive denominator');
  }
  if (numerator * 3n < denominator || numerator > denominator) {
    throw new Error('trust level must be between one third and one');
  }
}

function validateBatchLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < 1 || length > TENDERMINT_MULTITX_MAX_BATCH_SIZE) {
    throw new Error(`session batch must contain between 1 and ${TENDERMINT_MULTITX_MAX_BATCH_SIZE} entries`);
  }
}

function flattenPayloadBatches<T, B extends { range: { start: number; end: number } }>(
  batches: readonly B[],
  valuesOf: (batch: B) => readonly T[],
  label: string,
): T[] {
  const values: T[] = [];
  let expectedStart = 0;
  batches.forEach((batch, index) => {
    const batchValues = valuesOf(batch);
    if (
      !Number.isSafeInteger(batch.range.start) ||
      !Number.isSafeInteger(batch.range.end) ||
      batch.range.start !== expectedStart ||
      batch.range.end < batch.range.start ||
      batch.range.end - batch.range.start !== batchValues.length
    ) {
      throw new Error(`${label} payload range ${index} is not a contiguous exact range`);
    }
    values.push(...batchValues);
    expectedStart = batch.range.end;
  });
  return values;
}

function sessionProgressIndex(count: bigint, plannedCount: bigint, payloadCount: number, label: string): number {
  validateBigIntValidatorCount(label, plannedCount, false);
  if (BigInt(payloadCount) !== plannedCount) {
    throw new Error(`${label} payload count ${payloadCount} does not match plan count ${plannedCount.toString()}`);
  }
  if (typeof count !== 'bigint' || count < 0n || count >= plannedCount) {
    throw new Error(`${label} phase count must identify unfinished on-chain progress`);
  }
  return Number(count);
}

function requireBatchWithinPlan(currentCount: bigint, length: number, plannedCount: bigint, label: string): void {
  if (currentCount + BigInt(length) > plannedCount) {
    throw new Error(`${label} validator batch exceeds the plan validator count`);
  }
}

function validatePlanValidatorCounts(plan: UpdatePlan): void {
  validateBigIntValidatorCount('target', plan.targetValidatorCount, false);
  validateBigIntValidatorCount('trusted', plan.trustedValidatorCount, isAdjacent(plan));
  if (isAdjacent(plan) && plan.trustedValidatorCount !== 0n) {
    throw new Error('adjacent session plan must have zero trusted validators');
  }
}

function validateValidatorCount(label: string, count: number, allowZero: boolean): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(count) || count < minimum || count > TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT) {
    throw new Error(
      `${label} validator count must be between ${minimum} and ${TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT}`,
    );
  }
}

function validateBigIntValidatorCount(label: string, count: bigint, allowZero: boolean): void {
  const minimum = allowZero ? 0n : 1n;
  if (typeof count !== 'bigint' || count < minimum || count > BigInt(TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT)) {
    throw new Error(
      `${label} validator count must be between ${minimum} and ${TENDERMINT_MULTITX_MAX_VALIDATOR_COUNT}`,
    );
  }
}

function validateAccumulator(accumulator: MerkleAccumulator): void {
  if (
    !accumulator ||
    typeof accumulator.count !== 'bigint' ||
    accumulator.count < 0n ||
    !Array.isArray(accumulator.peaks)
  ) {
    throw new Error('invalid Merkle accumulator');
  }
  let sum = 0n;
  let previousSize = 0n;
  accumulator.peaks.forEach((peak, index) => {
    if (typeof peak.size !== 'bigint' || peak.size <= previousSize || (peak.size & (peak.size - 1n)) !== 0n) {
      throw new Error(`Merkle accumulator peak ${index} has an invalid size or order`);
    }
    validateDigest(peak.root, `Merkle accumulator peak ${index}`);
    sum += peak.size;
    previousSize = peak.size;
  });
  if (sum !== accumulator.count) throw new Error('Merkle accumulator peak sizes do not equal its count');
}

function cloneAccumulator(accumulator: MerkleAccumulator): MerkleAccumulator {
  return { count: accumulator.count, peaks: accumulator.peaks.map((peak) => ({ ...peak })) };
}

function resolveTrustedConsensusState(
  clientDatum: ClientDatum,
  trustedHeight: { revisionNumber: bigint; revisionHeight: bigint },
  explicit?: ConsensusState,
): ConsensusState {
  const matches = Array.from(clientDatum.state.consensusStates.entries()).filter(
    ([height]) =>
      height.revisionNumber === trustedHeight.revisionNumber && height.revisionHeight === trustedHeight.revisionHeight,
  );
  if (matches.length !== 1) {
    throw new Error(`trusted height must identify exactly one current consensus state; found ${matches.length}`);
  }
  const stored = matches[0][1];
  if (explicit && !sameConsensusState(stored, explicit)) {
    throw new Error('explicit trusted consensus state does not match the current client datum');
  }
  return explicit ?? stored;
}

function sameConsensusState(left: ConsensusState, right: ConsensusState): boolean {
  return (
    left.timestamp === right.timestamp &&
    normalizeEvenHex(left.next_validators_hash, 'stored next validators hash') ===
      normalizeEvenHex(right.next_validators_hash, 'explicit next validators hash') &&
    normalizeEvenHex(left.root.hash, 'stored consensus root') ===
      normalizeEvenHex(right.root.hash, 'explicit consensus root')
  );
}

function cloneConsensusState(state: ConsensusState): ConsensusState {
  return {
    timestamp: state.timestamp,
    next_validators_hash: state.next_validators_hash,
    root: { hash: state.root.hash },
  };
}

function cloneBlockId(blockId: BlockID): BlockID {
  return {
    hash: blockId.hash,
    partSetHeader: { total: blockId.partSetHeader.total, hash: blockId.partSetHeader.hash },
  };
}

function cloneTmHeader(header: TmHeader): TmHeader {
  return {
    ...header,
    version: { ...header.version },
    lastBlockId: cloneBlockId(header.lastBlockId),
  };
}

function parseChainIdRevision(chainId: string): bigint {
  const text = Buffer.from(normalizeEvenHex(chainId, 'header.chainId'), 'hex').toString('utf8');
  const separator = text.lastIndexOf('-');
  if (separator < 0) return 0n;
  const suffix = text.slice(separator + 1);
  return /^[0-9]+$/.test(suffix) ? BigInt(suffix) : 0n;
}

function isAdjacent(plan: UpdatePlan): boolean {
  return plan.header.height === plan.trustedHeight.revisionHeight + 1n;
}

function validateDigest(value: string, label: string): string {
  return normalizeHex(value, 32, label);
}

function normalizeHex(value: string, byteLength: number, label: string): string {
  const normalized = normalizeEvenHex(value, label);
  if (normalized.length !== byteLength * 2) throw new Error(`${label} must be ${byteLength} bytes`);
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

function requireBigInt(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint') throw new Error(`${label} must be a bigint`);
  return value;
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
