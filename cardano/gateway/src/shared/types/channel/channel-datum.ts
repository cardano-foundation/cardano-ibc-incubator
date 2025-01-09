import { AuthToken } from '../auth-token';
import { Data } from '@lucid-evolution/lucid';
import { Channel } from './channel';
export type ChannelDatumState = {
  channel: Channel;
  next_sequence_send: bigint;
  next_sequence_recv: bigint;
  next_sequence_ack: bigint;
  packet_commitment: Map<bigint, string>;
  packet_receipt: Map<bigint, string>;
  packet_acknowledgement: Map<bigint, string>;
};

export type ChannelDatum = {
  state: ChannelDatumState;
  port: string;
  token: AuthToken;
};

export async function encodeChannelDatum(channelDatum: ChannelDatum, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const StateSchema = Data.Enum([
    Data.Literal('Uninitialized'),
    Data.Literal('Init'),
    Data.Literal('TryOpen'),
    Data.Literal('Open'),
    Data.Literal('Close'),
  ]);
  const OrderSchema = Data.Enum([Data.Literal('None'), Data.Literal('Unordered'), Data.Literal('Ordered')]);
  const ChannelCounterpartySchema = Data.Object({
    port_id: Data.Bytes(),
    channel_id: Data.Bytes(),
  });
  const ChannelSchema = Data.Object({
    state: StateSchema,
    ordering: OrderSchema,
    counterparty: ChannelCounterpartySchema,
    connection_hops: Data.Array(Data.Bytes()),
    version: Data.Bytes(),
  });
  const ChannelDatumStateSchema = Data.Object({
    channel: ChannelSchema,
    next_sequence_send: Data.Integer(),
    next_sequence_recv: Data.Integer(),
    next_sequence_ack: Data.Integer(),
    packet_commitment: Data.Map(Data.Integer(), Data.Bytes()),
    packet_receipt: Data.Map(Data.Integer(), Data.Bytes()),
    packet_acknowledgement: Data.Map(Data.Integer(), Data.Bytes()),
  });
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });

  const ChannelDatumSchema = Data.Object({
    state: ChannelDatumStateSchema,
    port: Data.Bytes(),
    token: AuthTokenSchema,
  });
  type TChannelDatum = Data.Static<typeof ChannelDatumSchema>;
  const TChannelDatum = ChannelDatumSchema as unknown as ChannelDatum;
  return Data.to(channelDatum, TChannelDatum);
}

export async function decodeChannelDatum(channelDatum: string, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const StateSchema = Data.Enum([
    Data.Literal('Uninitialized'),
    Data.Literal('Init'),
    Data.Literal('TryOpen'),
    Data.Literal('Open'),
    Data.Literal('Close'),
  ]);
  const OrderSchema = Data.Enum([Data.Literal('None'), Data.Literal('Unordered'), Data.Literal('Ordered')]);
  const ChannelCounterpartySchema = Data.Object({
    port_id: Data.Bytes(),
    channel_id: Data.Bytes(),
  });
  const ChannelSchema = Data.Object({
    state: StateSchema,
    ordering: OrderSchema,
    counterparty: ChannelCounterpartySchema,
    connection_hops: Data.Array(Data.Bytes()),
    version: Data.Bytes(),
  });
  const ChannelDatumStateSchema = Data.Object({
    channel: ChannelSchema,
    next_sequence_send: Data.Integer(),
    next_sequence_recv: Data.Integer(),
    next_sequence_ack: Data.Integer(),
    packet_commitment: Data.Map(Data.Integer(), Data.Bytes()),
    packet_receipt: Data.Map(Data.Integer(), Data.Bytes()),
    packet_acknowledgement: Data.Map(Data.Integer(), Data.Bytes()),
  });
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });

  const ChannelDatumSchema = Data.Object({
    state: ChannelDatumStateSchema,
    port: Data.Bytes(),
    token: AuthTokenSchema,
  });
  type TChannelDatum = Data.Static<typeof ChannelDatumSchema>;
  const TChannelDatum = ChannelDatumSchema as unknown as ChannelDatum;
  return Data.from(channelDatum, TChannelDatum);
}
