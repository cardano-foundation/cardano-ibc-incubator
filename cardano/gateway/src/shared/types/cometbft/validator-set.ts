import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { Validator, validateBasic as validateValidatorBasic } from './validator';
import { safeAddClip } from '../../helpers/number';
import { SimpleValidator } from '@plus/proto-types/build/tendermint/types/validator';
import crypto from 'crypto';

const MAX_TOTAL_VOTING_POWER = Number.MAX_SAFE_INTEGER / 8;

export type ValidatorSet = {
  validators: Validator[];
  proposer: Validator;
  totalVotingPower: bigint;
};

export function validateBasic(vals: ValidatorSet) {
  if (!vals) {
    throw new GrpcInvalidArgumentException('validator set is nil or empty');
  }

  for (const val of vals.validators) {
    validateValidatorBasic(val);
  }

  validateValidatorBasic(vals.proposer);
  return true;
}

// ValidatorSetFromProto converts a cmtproto.ValidatorSet to a ValidatorSet
export function validatorSetFromProto(vp: ValidatorSet): ValidatorSet | null {
  if (!vp) throw new GrpcInvalidArgumentException('nil validator set');

  const vals: ValidatorSet = {} as unknown as ValidatorSet;
  if (vp.validators.some((v) => !v)) throw new GrpcInvalidArgumentException('nil validator'); // Error occurred during validation

  vals.validators = vp.validators;
  vals.proposer = vp.proposer;
  vals.totalVotingPower = vp.totalVotingPower;

  // Recompute total voting power
  vals.totalVotingPower = getTotalVotingPower(vals); // Assuming this method calculates total voting power

  validateBasic(vals);

  return vals;
}

function leafHash(leaf: Uint8Array): Buffer {
  return crypto.createHash('sha256').update(Buffer.concat([Buffer.from([0]), Buffer.from(leaf)])).digest();
}

function innerHash(left: Uint8Array, right: Uint8Array): Buffer {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([Buffer.from([1]), Buffer.from(left), Buffer.from(right)]))
    .digest();
}

function getSplitPoint(length: number): number {
  if (length < 1) {
    throw new GrpcInvalidArgumentException(`invalid validator set hash length: ${length}`);
  }

  const bitLen = length.toString(2).length;
  const k = 2 ** (bitLen - 1);
  return k === length ? k / 2 : k;
}

function hashFromByteSlices(items: Uint8Array[]): Buffer {
  switch (items.length) {
    case 0:
      return crypto.createHash('sha256').update(Buffer.alloc(0)).digest();
    case 1:
      return leafHash(items[0]);
    default: {
      const k = getSplitPoint(items.length);
      const left = hashFromByteSlices(items.slice(0, k));
      const right = hashFromByteSlices(items.slice(k));
      return innerHash(left, right);
    }
  }
}

function simpleValidatorBytes(validator: Validator): Uint8Array {
  return SimpleValidator.encode({
    pub_key: {
      ed25519: Buffer.from(validator.pubkey, 'hex'),
      secp256k1: undefined,
    },
    voting_power: validator.votingPower,
  }).finish();
}

export function validatorSetHashHex(vals: ValidatorSet): string {
  const simpleValidators = vals.validators.map(simpleValidatorBytes);
  return hashFromByteSlices(simpleValidators).toString('hex');
}

function getTotalVotingPower(vp: ValidatorSet): bigint {
  if (vp.totalVotingPower || vp.totalVotingPower === 0n) {
    return getUpdateTotalVotingPower(vp);
  }
  return vp.totalVotingPower;
}

function getUpdateTotalVotingPower(vp: ValidatorSet): bigint {
  let sum = 0;
  for (const val of vp.validators) {
    sum = safeAddClip(sum, Number(val.votingPower));
    if (sum > MAX_TOTAL_VOTING_POWER) {
      throw new GrpcInvalidArgumentException(
        `Total voting power exceeds maximum: ${MAX_TOTAL_VOTING_POWER}, calculated: ${sum}`,
      );
    }
  }
  return BigInt(sum);
}
