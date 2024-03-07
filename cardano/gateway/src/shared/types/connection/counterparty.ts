import { MerklePrefix } from '../isc-23/merkle_prefix';

export type Counterparty = {
  client_id: string;
  // identifies the connection end on the counterparty chain associated with a given connection.
  connection_id: string;
  // commitment merkle prefix of the counterparty chain.
  prefix: MerklePrefix;
};
