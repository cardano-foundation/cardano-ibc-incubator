import {Data} from '../../../../plutus/data';
import {ValidatorSchema} from '../tm_validator/Validator';

export const ValidatorSetSchema = Data.Object({
  validators: Data.Array(ValidatorSchema),
  proposer: ValidatorSchema,
  total_voting_power: Data.Integer(),
});
export type ValidatorSet = Data.Static<typeof ValidatorSetSchema>;
export const ValidatorSet = ValidatorSetSchema as unknown as ValidatorSet;
