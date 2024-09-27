import {Data} from '../../../../plutus/data';
import {MerklePrefixSchema} from '../../../ics_023_vector_commitments/merkle_prefix/MerklePrefix';

export const CounterpartySchema = Data.Object({
  client_id: Data.Bytes(),
  connection_id: Data.Bytes(),
  prefix: MerklePrefixSchema,
});
export type Counterparty = Data.Static<typeof CounterpartySchema>;
export const Counterparty = CounterpartySchema as unknown as Counterparty;
