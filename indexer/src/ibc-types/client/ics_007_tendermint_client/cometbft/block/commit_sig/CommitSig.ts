import {Data} from '../../../../../plutus/data';

export const CommitSigSchema = Data.Object({
  block_id_flag: Data.Integer(),
  validator_address: Data.Bytes(),
  timestamp: Data.Integer(),
  signature: Data.Bytes(),
});
export type CommitSig = Data.Static<typeof CommitSigSchema>;
export const CommitSig = CommitSigSchema as unknown as CommitSig;
