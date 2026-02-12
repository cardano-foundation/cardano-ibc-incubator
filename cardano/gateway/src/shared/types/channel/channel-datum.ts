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

/**
 * Encode a `Channel` value exactly as the on-chain Aiken code does.
 *
 * This encoding is used for the `ibc_state_root` commitment tree value bytes at:
 * `channelEnds/ports/{portId}/channels/{channelId}`.
 */
export async function encodeChannelEndValue(
  channelEnd: Channel,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
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

  // IMPORTANT: do NOT set `{ canonical: true }` here.
  //
  // On-chain we commit to `aiken/cbor.serialise(...)` of these values, and Aiken's
  // CBOR serialization is not canonical (it may use indefinite-length arrays).
  //
  // For root correctness enforcement to work, the Gateway must produce the exact
  // same bytes as the on-chain `cbor.serialise` call.
  return Data.to(channelEnd, ChannelSchema as any);
}

export async function encodeChannelDatum(channelDatum: ChannelDatum, Lucid: typeof import('@lucid-evolution/lucid')) {
  const CML = (Lucid as any).CML;
  if (!CML) {
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

  const bytesData = (hex: string) => CML.PlutusData.new_bytes(Buffer.from(hex, 'hex'));
  const intData = (value: bigint) => CML.PlutusData.new_integer(CML.BigInteger.from_str(value.toString()));
  const listData = (items: any[]) => {
    const list = CML.PlutusDataList.new();
    for (const item of items) {
      list.add(item);
    }
    return list;
  };
  const constrData = (index: number, fields: any[]) =>
    CML.PlutusData.new_constr_plutus_data(CML.ConstrPlutusData.new(BigInt(index), listData(fields)));
  const mapData = (entries: Map<bigint, string>) => {
    const map = CML.PlutusMap.new();
    // Preserve insertion order: this is required for unordered recv packet validation
    // where packet_receipt prepends the latest sequence.
    for (const [key, value] of entries.entries()) {
      map.set(intData(key), bytesData(value));
    }
    return CML.PlutusData.new_map(map);
  };

  const channelStateIndex: Record<string, number> = {
    Uninitialized: 0,
    Init: 1,
    TryOpen: 2,
    Open: 3,
    Close: 4,
  };
  const channelOrderIndex: Record<string, number> = {
    None: 0,
    Unordered: 1,
    Ordered: 2,
  };

  const stateIndex = channelStateIndex[channelDatum.state.channel.state];
  const orderIndex = channelOrderIndex[channelDatum.state.channel.ordering];
  if (stateIndex === undefined || orderIndex === undefined) {
    throw new Error('Invalid channel state/order for channel datum encoding');
  }

  const counterpartyData = constrData(0, [
    bytesData(channelDatum.state.channel.counterparty.port_id),
    bytesData(channelDatum.state.channel.counterparty.channel_id),
  ]);

  const connectionHops = CML.PlutusDataList.new();
  for (const hop of channelDatum.state.channel.connection_hops) {
    connectionHops.add(bytesData(hop));
  }

  const channelData = constrData(0, [
    constrData(stateIndex, []),
    constrData(orderIndex, []),
    counterpartyData,
    CML.PlutusData.new_list(connectionHops),
    bytesData(channelDatum.state.channel.version),
  ]);

  const stateData = constrData(0, [
    channelData,
    intData(channelDatum.state.next_sequence_send),
    intData(channelDatum.state.next_sequence_recv),
    intData(channelDatum.state.next_sequence_ack),
    mapData(channelDatum.state.packet_commitment),
    mapData(channelDatum.state.packet_receipt),
    mapData(channelDatum.state.packet_acknowledgement),
  ]);

  const tokenData = constrData(0, [bytesData(channelDatum.token.policyId), bytesData(channelDatum.token.name)]);
  const channelDatumData = constrData(0, [stateData, bytesData(channelDatum.port), tokenData]);

  return channelDatumData.to_cbor_hex();
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
