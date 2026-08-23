import { type Data } from '@lucid-evolution/lucid';

type ModuleRegistration = {
  module_script_hash: string;
  port_token: { policy_id: string; name: string };
  module_token: { policy_id: string; name: string };
};

type ReferenceScriptRegistration = {
  target_count: bigint;
  target_root: string;
  last_out_ref: {
    transaction_id: string;
    output_index: bigint;
  };
};

export type HostStateDatum = {
  state: {
    version: bigint;
    ibc_state_root: string;
    next_client_sequence: bigint;
    next_connection_sequence: bigint;
    next_channel_sequence: bigint;
    bound_port: Map<string, ModuleRegistration>;
    last_update_time: bigint;
    live_client_count: bigint;
    live_connection_count: bigint;
    live_channel_count: bigint;
  };
  nft_policy: string;
  deployer: string;
  shutdown:
    | 'Active'
    | {
        ShuttingDown: {
          initiated_at: bigint;
          grace_period_end: bigint;
        };
      }
    | {
        Sealed: {
          sealed_at: bigint;
          proof_window_end: bigint;
        };
      };
  // None exists only during deployment, before the complete reference-script
  // inventory is registered. Some(n) is the authenticated number still live.
  live_reference_script_count: bigint | null;
  // Hash-chain commitment to the exact output references and script hashes.
  reference_script_inventory_root: string;
  // Frozen full-inventory target plus the last canonical output registered.
  reference_script_registration: ReferenceScriptRegistration | null;
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
  const ReferenceScriptRegistrationSchema = Data.Object({
    target_count: Data.Integer(),
    target_root: Data.Bytes(),
    last_out_ref: Data.Object({
      transaction_id: Data.Bytes(),
      output_index: Data.Integer(),
    }),
  });

  const HostStateStateSchema = Data.Object({
    version: Data.Integer(),
    ibc_state_root: Data.Bytes(),
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Map(Data.Bytes(), ModuleRegistrationSchema),
    last_update_time: Data.Integer(),
    live_client_count: Data.Integer(),
    live_connection_count: Data.Integer(),
    live_channel_count: Data.Integer(),
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
      Data.Object({
        Sealed: Data.Object({
          sealed_at: Data.Integer(),
          proof_window_end: Data.Integer(),
        }),
      }),
    ]),
    live_reference_script_count: Data.Nullable(Data.Integer()),
    reference_script_inventory_root: Data.Bytes(),
    reference_script_registration: Data.Nullable(ReferenceScriptRegistrationSchema),
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
  const ReferenceScriptRegistrationSchema = Data.Object({
    target_count: Data.Integer(),
    target_root: Data.Bytes(),
    last_out_ref: Data.Object({
      transaction_id: Data.Bytes(),
      output_index: Data.Integer(),
    }),
  });
  const HostStateStateSchema = Data.Object({
    version: Data.Integer(),
    ibc_state_root: Data.Bytes(),
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Map(Data.Bytes(), ModuleRegistrationSchema),
    last_update_time: Data.Integer(),
    live_client_count: Data.Integer(),
    live_connection_count: Data.Integer(),
    live_channel_count: Data.Integer(),
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
      Data.Object({
        Sealed: Data.Object({
          sealed_at: Data.Integer(),
          proof_window_end: Data.Integer(),
        }),
      }),
    ]),
    live_reference_script_count: Data.Nullable(Data.Integer()),
    reference_script_inventory_root: Data.Bytes(),
    reference_script_registration: Data.Nullable(ReferenceScriptRegistrationSchema),
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
