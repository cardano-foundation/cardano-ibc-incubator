import { Data } from '@lucid-evolution/lucid';
import { AuthToken } from '../auth-token';
import { ConnectionEnd } from './connection-end';

export type ConnectionDatum = {
  state: ConnectionEnd;
  token: AuthToken;
};

/**
 * Encode a `ConnectionEnd` value exactly as the on-chain Aiken code does.
 *
 * This encoding is used for the `ibc_state_root` commitment tree value bytes at:
 * `connections/{connectionId}`.
 */
export async function encodeConnectionEndValue(
  connectionEnd: ConnectionEnd,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
  const { Data } = Lucid;

  const VersionSchema = Data.Object({
    identifier: Data.Bytes(),
    features: Data.Array(Data.Bytes()),
  });
  const StateSchema = Data.Enum([
    Data.Literal('Uninitialized'),
    Data.Literal('Init'),
    Data.Literal('TryOpen'),
    Data.Literal('Open'),
  ]);
  const MerklePrefixSchema = Data.Object({
    key_prefix: Data.Bytes(),
  });
  const CounterpartySchema = Data.Object({
    // identifies the client on the counterparty chain associated with a given connection.
    client_id: Data.Bytes(),
    // identifies the connection end on the counterparty chain associated with a given connection.
    connection_id: Data.Bytes(),
    // commitment merkle prefix of the counterparty chain.
    prefix: MerklePrefixSchema,
  });
  const ConnectionEndSchema = Data.Object({
    client_id: Data.Bytes(),
    versions: Data.Array(VersionSchema),
    state: StateSchema,
    counterparty: CounterpartySchema,
    delay_period: Data.Integer(),
  });

  // IMPORTANT: do NOT set `{ canonical: true }` here.
  //
  // On-chain we commit to `aiken/cbor.serialise(...)` of these values, and Aiken's
  // CBOR serialization is not canonical (it may use indefinite-length arrays).
  //
  // For root correctness enforcement to work, the Gateway must produce the exact
  // same bytes as the on-chain `cbor.serialise` call.
  return Data.to(connectionEnd, ConnectionEndSchema as any);
}

export async function encodeConnectionDatum(
  connectionDatum: ConnectionDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;

  const VersionSchema = Data.Object({
    identifier: Data.Bytes(),
    features: Data.Array(Data.Bytes()),
  });
  const StateSchema = Data.Enum([
    Data.Literal('Uninitialized'),
    Data.Literal('Init'),
    Data.Literal('TryOpen'),
    Data.Literal('Open'),
  ]);
  const MerklePrefixSchema = Data.Object({
    key_prefix: Data.Bytes(),
  });
  const CounterpartySchema = Data.Object({
    // identifies the client on the counterparty chain associated with a given connection.
    client_id: Data.Bytes(),
    // identifies the connection end on the counterparty chain associated with a given connection.
    connection_id: Data.Bytes(),
    // commitment merkle prefix of the counterparty chain.
    prefix: MerklePrefixSchema,
  });
  const ConnectionEndSchema = Data.Object({
    client_id: Data.Bytes(),
    versions: Data.Array(VersionSchema),
    state: StateSchema,
    counterparty: CounterpartySchema,
    delay_period: Data.Integer(),
  });

  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });

  const ConnectionDatumSchema = Data.Object({
    state: ConnectionEndSchema,
    token: AuthTokenSchema,
  });
  type TConnectionDatum = Data.Static<typeof ConnectionDatumSchema>;
  const TConnectionDatum = ConnectionDatumSchema as unknown as ConnectionDatum;
  return Data.to(connectionDatum, TConnectionDatum, { canonical: true });
}

export async function decodeConnectionDatum(connectionDatum: string, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const VersionSchema = Data.Object({
    identifier: Data.Bytes(),
    features: Data.Array(Data.Bytes()),
  });
  const StateSchema = Data.Enum([
    Data.Literal('Uninitialized'),
    Data.Literal('Init'),
    Data.Literal('TryOpen'),
    Data.Literal('Open'),
  ]);
  const MerklePrefixSchema = Data.Object({
    key_prefix: Data.Bytes(),
  });
  const CounterpartySchema = Data.Object({
    // identifies the client on the counterparty chain associated with a given connection.
    client_id: Data.Bytes(),
    // identifies the connection end on the counterparty chain associated with a given connection.
    connection_id: Data.Bytes(),
    // commitment merkle prefix of the counterparty chain.
    prefix: MerklePrefixSchema,
  });
  const ConnectionEndSchema = Data.Object({
    client_id: Data.Bytes(),
    versions: Data.Array(VersionSchema),
    state: StateSchema,
    counterparty: CounterpartySchema,
    delay_period: Data.Integer(),
  });

  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });

  const ConnectionDatumSchema = Data.Object({
    state: ConnectionEndSchema,
    token: AuthTokenSchema,
  });
  type TConnectionDatum = Data.Static<typeof ConnectionDatumSchema>;
  const TConnectionDatum = ConnectionDatumSchema as unknown as ConnectionDatum;
  return Data.from(connectionDatum, TConnectionDatum);
}
