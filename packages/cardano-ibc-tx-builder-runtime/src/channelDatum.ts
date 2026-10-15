// Plutus encoding of the on-chain `ChannelDatum`, shared by the Gateway and
// the runtime. It mirrors cardano/onchain/lib/ibc/core/ics-004/channel_datum.ak
// and types/channel.ak. Hex strings hold byte fields.

type LucidModule = typeof import('@lucid-evolution/lucid');

export type HeightValue = { revisionNumber: bigint; revisionHeight: bigint };

export type UpgradeFieldsValue = {
  ordering: string;
  connection_hops: string[];
  version: string;
};

export type UpgradeValue = {
  fields: UpgradeFieldsValue;
  timeout: { height: HeightValue; timestamp: bigint };
  next_sequence_send: bigint;
};

export type ErrorReceiptValue = { sequence: bigint; message: string };

export type PendingUpgradeValue = {
  upgrade: UpgradeValue;
  timeout_period: bigint;
  counterparty_upgrade: UpgradeValue | null;
  flushed_lanes: bigint;
};

export type ChannelUpgradeStateValue = {
  pending: PendingUpgradeValue | null;
  error_receipt: ErrorReceiptValue | null;
  recv_start_sequence: bigint;
};

/** Constructor order of the Aiken `ChannelState`. */
export const CHANNEL_STATES = [
  'Uninitialized',
  'Init',
  'TryOpen',
  'Open',
  'Close',
  'Flushing',
  'FlushComplete',
] as const;

/** Constructor order of the Aiken `Order`. */
export const CHANNEL_ORDERS = ['None', 'Unordered', 'Ordered'] as const;

/** A channel starts without an upgrade. */
export function initialChannelUpgradeState(): ChannelUpgradeStateValue {
  return { pending: null, error_receipt: null, recv_start_sequence: 0n };
}

export function channelSchemas(Lucid: LucidModule) {
  const { Data } = Lucid;
  const State = Data.Enum(CHANNEL_STATES.map((state) => Data.Literal(state)) as any);
  const Order = Data.Enum(CHANNEL_ORDERS.map((order) => Data.Literal(order)) as any);
  const Height = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const Channel = Data.Object({
    state: State,
    ordering: Order,
    counterparty: Data.Object({
      port_id: Data.Bytes(),
      channel_id: Data.Bytes(),
    }),
    connection_hops: Data.Array(Data.Bytes()),
    version: Data.Bytes(),
    upgrade_sequence: Data.Integer(),
  });
  const UpgradeFields = Data.Object({
    ordering: Order,
    connection_hops: Data.Array(Data.Bytes()),
    version: Data.Bytes(),
  });
  const Upgrade = Data.Object({
    fields: UpgradeFields,
    timeout: Data.Object({ height: Height, timestamp: Data.Integer() }),
    next_sequence_send: Data.Integer(),
  });
  const ErrorReceipt = Data.Object({
    sequence: Data.Integer(),
    message: Data.Bytes(),
  });
  const UpgradeState = Data.Object({
    pending: Data.Nullable(
      Data.Object({
        upgrade: Upgrade,
        timeout_period: Data.Integer(),
        counterparty_upgrade: Data.Nullable(Upgrade),
        flushed_lanes: Data.Integer(),
      }),
    ),
    error_receipt: Data.Nullable(ErrorReceipt),
    recv_start_sequence: Data.Integer(),
  });
  const Datum = Data.Object({
    state: Data.Object({
      channel: Channel,
      next_sequence_send: Data.Integer(),
      next_sequence_recv: Data.Integer(),
      next_sequence_ack: Data.Integer(),
      packet_commitment: Data.Map(Data.Integer(), Data.Bytes()),
      packet_receipt: Data.Map(Data.Integer(), Data.Bytes()),
      packet_acknowledgement: Data.Map(Data.Integer(), Data.Bytes()),
      minimum_receive_proof_height: Height,
      maximum_receive_proof_height: Height,
      upgrade: UpgradeState,
    }),
    port: Data.Bytes(),
    token: Data.Object({ policyId: Data.Bytes(), name: Data.Bytes() }),
  });
  return { Channel, Upgrade, ErrorReceipt, UpgradeState, Datum };
}

export async function decodeChannelDatum<T = any>(
  encoded: string,
  Lucid: LucidModule,
): Promise<T> {
  const raw = Lucid.Data.from(encoded) as any;
  if (raw?.index !== 0 || raw?.fields?.length !== 3 ||
      raw.fields[0]?.index !== 0 || raw.fields[0]?.fields?.length !== 10 ||
      raw.fields[0].fields[0]?.index !== 0 || raw.fields[0].fields[0]?.fields?.length !== 6) {
    throw new Error('Incompatible channel datum schema: this runtime requires a fresh schema 5 deployment with channel upgrade state');
  }
  return Lucid.Data.from(encoded, channelSchemas(Lucid).Datum as any) as T;
}

export async function encodeChannelDatum(
  channelDatum: any,
  Lucid: LucidModule,
): Promise<string> {
  const schemas = channelSchemas(Lucid);
  const CML = (Lucid as any).CML;
  if (!CML) {
    return Lucid.Data.to(channelDatum, schemas.Datum as any);
  }

  // Build the datum with CML so packet maps keep their insertion order, which
  // unordered receives rely on when they prepend the latest receipt.
  const embedded = (value: any, schema: unknown) =>
    CML.PlutusData.from_cbor_hex(Lucid.Data.to(value, schema as any));
  const bytesData = (hex: string) => CML.PlutusData.new_bytes(Buffer.from(hex, 'hex'));
  const intData = (value: bigint) => CML.PlutusData.new_integer(CML.BigInteger.from_str(value.toString()));
  const constrData = (index: number, fields: any[]) => {
    const list = CML.PlutusDataList.new();
    for (const field of fields) {
      list.add(field);
    }
    return CML.PlutusData.new_constr_plutus_data(CML.ConstrPlutusData.new(BigInt(index), list));
  };
  const mapData = (entries: Map<bigint, string>) => {
    const map = CML.PlutusMap.new();
    for (const [key, value] of entries.entries()) {
      map.set(intData(key), bytesData(value));
    }
    return CML.PlutusData.new_map(map);
  };
  const heightData = (height: HeightValue) =>
    constrData(0, [intData(height.revisionNumber), intData(height.revisionHeight)]);

  const state = channelDatum.state;
  if (!CHANNEL_STATES.includes(state.channel.state) || !CHANNEL_ORDERS.includes(state.channel.ordering)) {
    throw new Error(
      `Invalid channel datum state/order: state=${String(state.channel.state)}, order=${String(state.channel.ordering)}`,
    );
  }
  const stateData = constrData(0, [
    embedded(state.channel, schemas.Channel),
    intData(state.next_sequence_send),
    intData(state.next_sequence_recv),
    intData(state.next_sequence_ack),
    mapData(state.packet_commitment),
    mapData(state.packet_receipt),
    mapData(state.packet_acknowledgement),
    heightData(state.minimum_receive_proof_height),
    heightData(state.maximum_receive_proof_height),
    embedded(state.upgrade, schemas.UpgradeState),
  ]);
  const tokenData = constrData(0, [bytesData(channelDatum.token.policyId), bytesData(channelDatum.token.name)]);
  return constrData(0, [stateData, bytesData(channelDatum.port), tokenData]).to_cbor_hex();
}
