import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { Validator, validateBasic as validateValidatorBasic } from './validator';
import { safeAddClip } from '../../helpers/number';

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

  let vals: ValidatorSet = {} as unknown as ValidatorSet;
  if (vp.validators.some((v) => !v)) throw new GrpcInvalidArgumentException('nil validator'); // Error occurred during validation

  vals.validators = vp.validators;
  vals.proposer = vp.proposer;
  vals.totalVotingPower = vp.totalVotingPower;

  // Recompute total voting power
  vals.totalVotingPower = getTotalVotingPower(vals); // Assuming this method calculates total voting power

  validateBasic(vals);

  return vals;
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
