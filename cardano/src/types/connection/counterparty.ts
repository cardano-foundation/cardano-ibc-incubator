import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { MerklePrefixSchema } from "../isc-23/merkle_prefix.ts";

export const CounterpartySchema = Data.Object({
  // identifies the client on the counterparty chain associated with a given connection.
  client_id: Data.Bytes(),
  // identifies the connection end on the counterparty chain associated with a given connection.
  connection_id: Data.Bytes(),
  // commitment merkle prefix of the counterparty chain.
  prefix: MerklePrefixSchema,
});
export type Counterparty = Data.Static<typeof CounterpartySchema>;
export const Counterparty = CounterpartySchema as unknown as Counterparty;
