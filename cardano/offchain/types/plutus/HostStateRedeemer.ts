import { Data } from "@lucid-evolution/lucid";
import { ModuleRegistrationSchema } from "./HostState.ts";

const SiblingHashesSchema = Data.Array(Data.Bytes());

const CreateClientSchema = Data.Object({
  client_state_siblings: SiblingHashesSchema,
  consensus_state_siblings: SiblingHashesSchema,
});

const CreateConnectionSchema = Data.Object({
  connection_siblings: SiblingHashesSchema,
});

const CreateChannelSchema = Data.Object({
  channel_siblings: SiblingHashesSchema,
  next_sequence_send_siblings: SiblingHashesSchema,
  next_sequence_recv_siblings: SiblingHashesSchema,
  next_sequence_ack_siblings: SiblingHashesSchema,
});

const BindPortSchema = Data.Object({
  port: Data.Integer(),
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

export const PacketStateTransitionSchema = Data.Enum([
  Data.Literal("SendPacketState"),
  Data.Object({
    RecvPacketState: Data.Object({
      acknowledgement_commitment: Data.Bytes(),
    }),
  }),
  Data.Literal("AcknowledgePacketState"),
  Data.Literal("TimeoutPacketState"),
]);

const HandlePacketSchema = Data.Object({
  transition: PacketStateTransitionSchema,
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
  Data.Object({ UpdateConnection: CreateConnectionSchema }),
  Data.Object({ UpdateChannel: UpdateChannelSchema }),
  Data.Object({ HandlePacket: HandlePacketSchema }),
  Data.Object({ EnterShutdown: EnterShutdownSchema }),
  Data.Literal("FinalizeShutdown"),
  Data.Literal("Heartbeat"),
]);

export type HostStateRedeemer = Data.Static<typeof HostStateRedeemerSchema>;
export const HostStateRedeemer =
  HostStateRedeemerSchema as unknown as HostStateRedeemer;
