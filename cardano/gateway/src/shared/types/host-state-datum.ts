import { AuthToken } from './auth-token';
import { type Data } from '@lucid-evolution/lucid';

export type HostStateDatum = {
  state: {
    version: bigint;
    next_client_sequence: bigint;
    next_connection_sequence: bigint;
    next_channel_sequence: bigint;
    bound_port: bigint[];
    ibc_state_root: string;
  };
  token: AuthToken;
};

export async function encodeHostStateDatum(hostStateDatum: HostStateDatum, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const HostStateStateSchema = Data.Object({
    version: Data.Integer(),
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Array(Data.Integer()),
    ibc_state_root: Data.Bytes(),
  });
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HostStateDatumSchema = Data.Object({
    state: HostStateStateSchema,
    token: AuthTokenSchema,
  });
  type THostStateDatum = Data.Static<typeof HostStateDatumSchema>;
  const THostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;

  return Data.to(hostStateDatum, THostStateDatum);
}

export async function decodeHostStateDatum(hostStateDatum: string, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;
  const HostStateStateSchema = Data.Object({
    version: Data.Integer(),
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Array(Data.Integer()),
    ibc_state_root: Data.Bytes(),
  });
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HostStateDatumSchema = Data.Object({
    state: HostStateStateSchema,
    token: AuthTokenSchema,
  });
  type THostStateDatum = Data.Static<typeof HostStateDatumSchema>;
  const THostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;
  return Data.from(hostStateDatum, THostStateDatum);
}
