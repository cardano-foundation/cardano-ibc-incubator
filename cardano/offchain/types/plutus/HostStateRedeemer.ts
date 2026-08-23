import { Data } from "@lucid-evolution/lucid";
import { ModuleRegistrationSchema } from "./HostState.ts";
import { OutputReferenceSchema } from "./OutputReference.ts";

const SiblingHashesSchema = Data.Array(Data.Bytes());

const CreateClientSchema = Data.Object({
  client_state_siblings: SiblingHashesSchema,
  consensus_state_siblings: SiblingHashesSchema,
  client_connection_count_siblings: SiblingHashesSchema,
});

const CreateConnectionSchema = Data.Object({
  connection_siblings: SiblingHashesSchema,
  client_connection_count: Data.Integer(),
  client_connection_count_siblings: SiblingHashesSchema,
});

const UpdateConnectionSchema = Data.Object({
  connection_siblings: SiblingHashesSchema,
});

const CreateChannelSchema = Data.Object({
  channel_siblings: SiblingHashesSchema,
  next_sequence_send_siblings: SiblingHashesSchema,
  next_sequence_recv_siblings: SiblingHashesSchema,
  next_sequence_ack_siblings: SiblingHashesSchema,
});

const BindPortSchema = Data.Object({
  port_id: Data.Bytes(),
  registration: ModuleRegistrationSchema,
  port_siblings: SiblingHashesSchema,
});

const UpdateClientSchema = Data.Object({
  client_state_siblings: SiblingHashesSchema,
  consensus_state_siblings: SiblingHashesSchema,
  removed_consensus_state_siblings: Data.Array(SiblingHashesSchema),
});

const UpdateChannelSchema = Data.Object({
  channel_siblings: SiblingHashesSchema,
});

const HandlePacketSchema = Data.Object({
  channel_siblings: SiblingHashesSchema,
  next_sequence_send_siblings: SiblingHashesSchema,
  next_sequence_recv_siblings: SiblingHashesSchema,
  next_sequence_ack_siblings: SiblingHashesSchema,
  packet_commitment_siblings: SiblingHashesSchema,
  packet_receipt_siblings: SiblingHashesSchema,
  packet_acknowledgement_siblings: SiblingHashesSchema,
});

const EnterShutdownSchema = Data.Object({
  grace_period_end: Data.Integer(),
});

export const HostStateRedeemerSchema = Data.Enum([
  Data.Object({ CreateClient: CreateClientSchema }),
  Data.Object({ CreateConnection: CreateConnectionSchema }),
  Data.Object({ CreateChannel: CreateChannelSchema }),
  Data.Object({ BindPort: BindPortSchema }),
  Data.Object({ UpdateClient: UpdateClientSchema }),
  Data.Object({ UpdateConnection: UpdateConnectionSchema }),
  Data.Object({ UpdateChannel: UpdateChannelSchema }),
  Data.Object({ HandlePacket: HandlePacketSchema }),
  Data.Object({ EnterShutdown: EnterShutdownSchema }),
  Data.Literal("FinalizeShutdown"),
  Data.Literal("Heartbeat"),
  Data.Object({
    PruneTerminalClient: Data.Object({
      removed_consensus_state_siblings: Data.Array(SiblingHashesSchema),
    }),
  }),
  Data.Literal("BeginConnectionRetirement"),
  Data.Literal("BeginChannelAbandonment"),
  Data.Object({
    ReclaimChannel: Data.Object({
      reclaim_to: Data.Bytes(),
      channel_siblings: SiblingHashesSchema,
      next_sequence_send_siblings: SiblingHashesSchema,
      next_sequence_recv_siblings: SiblingHashesSchema,
      next_sequence_ack_siblings: SiblingHashesSchema,
    }),
  }),
  Data.Object({
    ReclaimConnection: Data.Object({
      reclaim_to: Data.Bytes(),
      connection_siblings: SiblingHashesSchema,
      client_connection_count: Data.Integer(),
      client_connection_count_siblings: SiblingHashesSchema,
    }),
  }),
  Data.Object({
    ReclaimClient: Data.Object({
      reclaim_to: Data.Bytes(),
      client_state_siblings: SiblingHashesSchema,
      consensus_state_siblings: SiblingHashesSchema,
      client_connection_count_siblings: SiblingHashesSchema,
    }),
  }),
  Data.Literal("SealShutdown"),
  Data.Object({
    ReclaimHostState: Data.Object({ reclaim_to: Data.Bytes() }),
  }),
  Data.Object({
    UpdateModuleState: Data.Object({ port_id: Data.Bytes() }),
  }),
  Data.Object({
    ReclaimModule: Data.Object({ port_id: Data.Bytes() }),
  }),
  Data.Object({
    RegisterReferenceScripts: Data.Object({
      target_count: Data.Integer(),
      target_root: Data.Bytes(),
      batch_out_refs: Data.Array(OutputReferenceSchema),
    }),
  }),
  Data.Object({
    ReclaimReferenceScripts: Data.Object({
      predecessor_root: Data.Bytes(),
    }),
  }),
  Data.Literal("FinalizeReferenceScriptRegistration"),
]);

export type HostStateRedeemer = Data.Static<typeof HostStateRedeemerSchema>;
export const HostStateRedeemer =
  HostStateRedeemerSchema as unknown as HostStateRedeemer;
