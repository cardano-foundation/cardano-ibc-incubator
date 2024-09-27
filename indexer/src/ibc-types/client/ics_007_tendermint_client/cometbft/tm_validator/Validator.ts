import {Data} from '../../../../plutus/data';

export const ValidatorSchema = Data.Object({
  address: Data.Bytes(),
  pubkey: Data.Bytes(),
  voting_power: Data.Integer(),
  proposer_priority: Data.Integer(),
});
export type Validator = Data.Static<typeof ValidatorSchema>;
export const Validator = ValidatorSchema as unknown as Validator;
