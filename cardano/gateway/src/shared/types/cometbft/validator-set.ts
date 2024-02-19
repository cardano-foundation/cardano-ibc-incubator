import { Validator } from './validator';

export type ValidatorSet = {
  validators: Validator[];
  proposer: Validator;
  totalVotingPower: bigint;
};
