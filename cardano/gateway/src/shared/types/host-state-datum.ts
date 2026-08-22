import { type Data } from '@lucid-evolution/lucid';

export type ModuleRegistration = {
  module_script_hash: string;
  port_token: { policy_id: string; name: string };
  module_token: { policy_id: string; name: string };
};

export type HostStateDatum = {
  state: {
    version: bigint;
    ibc_state_root: string;
    next_client_sequence: bigint;
    next_connection_sequence: bigint;
    next_channel_sequence: bigint;
    // Retained as an empty integer list for the HostState ABI shipped by Injective.
    bound_port: bigint[];
    last_update_time: bigint;
  };
  nft_policy: string;
  deployer: string;
  // Injective decodes this fourth datum field as opaque CBOR, so Cardano-owned
  // control state can evolve here without changing its light client.
  control: {
    port_registry: Map<string, ModuleRegistration>;
    shutdown:
      | 'Active'
      | {
          ShuttingDown: {
            initiated_at: bigint;
            grace_period_end: bigint;
          };
        };
  };
};

export async function encodeHostStateDatum(
  hostStateDatum: HostStateDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;

  const AuthTokenSchema = Data.Object({
    policy_id: Data.Bytes(),
    name: Data.Bytes(),
  });
  const ModuleRegistrationSchema = Data.Object({
    module_script_hash: Data.Bytes(),
    port_token: AuthTokenSchema,
    module_token: AuthTokenSchema,
  });

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
    control: Data.Object({
      port_registry: Data.Map(Data.Bytes(), ModuleRegistrationSchema),
      shutdown: Data.Enum([
        Data.Literal('Active'),
        Data.Object({
          ShuttingDown: Data.Object({
            initiated_at: Data.Integer(),
            grace_period_end: Data.Integer(),
          }),
        }),
      ]),
    }),
  });
  type THostStateDatum = Data.Static<typeof HostStateDatumSchema>;
  const THostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;

  return Data.to(hostStateDatum, THostStateDatum, { canonical: true });
}

export async function decodeHostStateDatum(hostStateDatum: string, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policy_id: Data.Bytes(),
    name: Data.Bytes(),
  });
  const ModuleRegistrationSchema = Data.Object({
    module_script_hash: Data.Bytes(),
    port_token: AuthTokenSchema,
    module_token: AuthTokenSchema,
  });
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
    control: Data.Object({
      port_registry: Data.Map(Data.Bytes(), ModuleRegistrationSchema),
      shutdown: Data.Enum([
        Data.Literal('Active'),
        Data.Object({
          ShuttingDown: Data.Object({
            initiated_at: Data.Integer(),
            grace_period_end: Data.Integer(),
          }),
        }),
      ]),
    }),
  });
  type THostStateDatum = Data.Static<typeof HostStateDatumSchema>;
  const THostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;
  return Data.from(hostStateDatum, THostStateDatum);
}

export async function encodeModuleRegistration(
  registration: ModuleRegistration,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policy_id: Data.Bytes(),
    name: Data.Bytes(),
  });
  const ModuleRegistrationSchema = Data.Object({
    module_script_hash: Data.Bytes(),
    port_token: AuthTokenSchema,
    module_token: AuthTokenSchema,
  });
  return Data.to(registration as never, ModuleRegistrationSchema as never);
}
