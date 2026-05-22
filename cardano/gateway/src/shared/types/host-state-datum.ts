import { type Data } from '@lucid-evolution/lucid';

export type HostStateDatum = {
  state: {
    version: bigint;
    ibc_state_root: string;
    next_client_sequence: bigint;
    next_connection_sequence: bigint;
    next_channel_sequence: bigint;
    bound_port: bigint[];
    last_update_time: bigint;
  };
  nft_policy: string;
  deployer: string;
  shutdown: 'Active' | {
    ShuttingDown: {
      initiated_at: bigint;
      grace_period_end: bigint;
    };
  };
};

export async function encodeHostStateDatum(hostStateDatum: HostStateDatum, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const HostStateStateSchema = Data.Object({
    version: Data.Integer(),
    ibc_state_root: Data.Bytes(),
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Array(Data.Integer()),
    last_update_time: Data.Integer(),
  });
  const HostStateDatumSchema = Data.Object({
    state: HostStateStateSchema,
    nft_policy: Data.Bytes(),
    deployer: Data.Bytes(),
    shutdown: Data.Enum([
      Data.Literal('Active'),
      Data.Object({
        ShuttingDown: Data.Object({
          initiated_at: Data.Integer(),
          grace_period_end: Data.Integer(),
        }),
      }),
    ]),
  });
  type THostStateDatum = Data.Static<typeof HostStateDatumSchema>;
  const THostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;

  return Data.to(hostStateDatum, THostStateDatum, { canonical: true });
}

export async function decodeHostStateDatum(hostStateDatum: string, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;
  const HostStateStateSchema = Data.Object({
    version: Data.Integer(),
    ibc_state_root: Data.Bytes(),
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Array(Data.Integer()),
    last_update_time: Data.Integer(),
  });
  const HostStateDatumSchema = Data.Object({
    state: HostStateStateSchema,
    nft_policy: Data.Bytes(),
    deployer: Data.Bytes(),
    shutdown: Data.Enum([
      Data.Literal('Active'),
      Data.Object({
        ShuttingDown: Data.Object({
          initiated_at: Data.Integer(),
          grace_period_end: Data.Integer(),
        }),
      }),
    ]),
  });
  type THostStateDatum = Data.Static<typeof HostStateDatumSchema>;
  const THostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;
  return Data.from(hostStateDatum, THostStateDatum);
}
