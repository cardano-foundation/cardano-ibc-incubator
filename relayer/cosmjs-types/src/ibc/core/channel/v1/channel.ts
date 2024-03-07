/* eslint-disable */
import { Height } from "../../client/v1/client";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../../helpers";
export const protobufPackage = "ibc.core.channel.v1";
/**
 * State defines if a channel is in one of the following states:
 * CLOSED, INIT, TRYOPEN, OPEN or UNINITIALIZED.
 */
export enum State {
  /** STATE_UNINITIALIZED_UNSPECIFIED - Default State */
  STATE_UNINITIALIZED_UNSPECIFIED = 0,
  /** STATE_INIT - A channel has just started the opening handshake. */
  STATE_INIT = 1,
  /** STATE_TRYOPEN - A channel has acknowledged the handshake step on the counterparty chain. */
  STATE_TRYOPEN = 2,
  /**
   * STATE_OPEN - A channel has completed the handshake. Open channels are
   * ready to send and receive packets.
   */
  STATE_OPEN = 3,
  /**
   * STATE_CLOSED - A channel has been closed and can no longer be used to send or receive
   * packets.
   */
  STATE_CLOSED = 4,
  UNRECOGNIZED = -1,
}
export function stateFromJSON(object: any): State {
  switch (object) {
    case 0:
    case "STATE_UNINITIALIZED_UNSPECIFIED":
      return State.STATE_UNINITIALIZED_UNSPECIFIED;
    case 1:
    case "STATE_INIT":
      return State.STATE_INIT;
    case 2:
    case "STATE_TRYOPEN":
      return State.STATE_TRYOPEN;
    case 3:
    case "STATE_OPEN":
      return State.STATE_OPEN;
    case 4:
    case "STATE_CLOSED":
      return State.STATE_CLOSED;
    case -1:
    case "UNRECOGNIZED":
    default:
      return State.UNRECOGNIZED;
  }
}
export function stateToJSON(object: State): string {
  switch (object) {
    case State.STATE_UNINITIALIZED_UNSPECIFIED:
      return "STATE_UNINITIALIZED_UNSPECIFIED";
    case State.STATE_INIT:
      return "STATE_INIT";
    case State.STATE_TRYOPEN:
      return "STATE_TRYOPEN";
    case State.STATE_OPEN:
      return "STATE_OPEN";
    case State.STATE_CLOSED:
      return "STATE_CLOSED";
    case State.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}
/** Order defines if a channel is ORDERED or UNORDERED */
export enum Order {
  /** ORDER_NONE_UNSPECIFIED - zero-value for channel ordering */
  ORDER_NONE_UNSPECIFIED = 0,
  /**
   * ORDER_UNORDERED - packets can be delivered in any order, which may differ from the order in
   * which they were sent.
   */
  ORDER_UNORDERED = 1,
  /** ORDER_ORDERED - packets are delivered exactly in the order which they were sent */
  ORDER_ORDERED = 2,
  UNRECOGNIZED = -1,
}
export function orderFromJSON(object: any): Order {
  switch (object) {
    case 0:
    case "ORDER_NONE_UNSPECIFIED":
      return Order.ORDER_NONE_UNSPECIFIED;
    case 1:
    case "ORDER_UNORDERED":
      return Order.ORDER_UNORDERED;
    case 2:
    case "ORDER_ORDERED":
      return Order.ORDER_ORDERED;
    case -1:
    case "UNRECOGNIZED":
    default:
      return Order.UNRECOGNIZED;
  }
}
export function orderToJSON(object: Order): string {
  switch (object) {
    case Order.ORDER_NONE_UNSPECIFIED:
      return "ORDER_NONE_UNSPECIFIED";
    case Order.ORDER_UNORDERED:
      return "ORDER_UNORDERED";
    case Order.ORDER_ORDERED:
      return "ORDER_ORDERED";
    case Order.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}
/**
 * Channel defines pipeline for exactly-once packet delivery between specific
 * modules on separate blockchains, which has at least one end capable of
 * sending packets and one end capable of receiving packets.
 */
export interface Channel {
  /** current state of the channel end */
  state: State;
  /** whether the channel is ordered or unordered */
  ordering: Order;
  /** counterparty channel end */
  counterparty: Counterparty;
  /**
   * list of connection identifiers, in order, along which packets sent on
   * this channel will travel
   */
  connection_hops: string[];
  /** opaque channel version, which is agreed upon during the handshake */
  version: string;
}
/**
 * IdentifiedChannel defines a channel with additional port and channel
 * identifier fields.
 */
export interface IdentifiedChannel {
  /** current state of the channel end */
  state: State;
  /** whether the channel is ordered or unordered */
  ordering: Order;
  /** counterparty channel end */
  counterparty: Counterparty;
  /**
   * list of connection identifiers, in order, along which packets sent on
   * this channel will travel
   */
  connection_hops: string[];
  /** opaque channel version, which is agreed upon during the handshake */
  version: string;
  /** port identifier */
  port_id: string;
  /** channel identifier */
  channel_id: string;
}
/** Counterparty defines a channel end counterparty */
export interface Counterparty {
  /** port on the counterparty chain which owns the other end of the channel. */
  port_id: string;
  /** channel end on the counterparty chain */
  channel_id: string;
}
/** Packet defines a type that carries data across different chains through IBC */
export interface Packet {
  /**
   * number corresponds to the order of sends and receives, where a Packet
   * with an earlier sequence number must be sent and received before a Packet
   * with a later sequence number.
   */
  sequence: bigint;
  /** identifies the port on the sending chain. */
  source_port: string;
  /** identifies the channel end on the sending chain. */
  source_channel: string;
  /** identifies the port on the receiving chain. */
  destination_port: string;
  /** identifies the channel end on the receiving chain. */
  destination_channel: string;
  /** actual opaque bytes transferred directly to the application module */
  data: Uint8Array;
  /** block height after which the packet times out */
  timeout_height: Height;
  /** block timestamp (in nanoseconds) after which the packet times out */
  timeout_timestamp: bigint;
}
/**
 * PacketState defines the generic type necessary to retrieve and store
 * packet commitments, acknowledgements, and receipts.
 * Caller is responsible for knowing the context necessary to interpret this
 * state as a commitment, acknowledgement, or a receipt.
 */
export interface PacketState {
  /** channel port identifier. */
  port_id: string;
  /** channel unique identifier. */
  channel_id: string;
  /** packet sequence. */
  sequence: bigint;
  /** embedded data that represents packet state. */
  data: Uint8Array;
}
/**
 * PacketId is an identifer for a unique Packet
 * Source chains refer to packets by source port/channel
 * Destination chains refer to packets by destination port/channel
 */
export interface PacketId {
  /** channel port identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** packet sequence */
  sequence: bigint;
}
/**
 * Acknowledgement is the recommended acknowledgement format to be used by
 * app-specific protocols.
 * NOTE: The field numbers 21 and 22 were explicitly chosen to avoid accidental
 * conflicts with other protobuf message formats used for acknowledgements.
 * The first byte of any message with this format will be the non-ASCII values
 * `0xaa` (result) or `0xb2` (error). Implemented as defined by ICS:
 * https://github.com/cosmos/ibc/tree/master/spec/core/ics-004-channel-and-packet-semantics#acknowledgement-envelope
 */
export interface Acknowledgement {
  result?: Uint8Array;
  error?: string;
}
function createBaseChannel(): Channel {
  return {
    state: 0,
    ordering: 0,
    counterparty: Counterparty.fromPartial({}),
    connection_hops: [],
    version: ""
  };
}
export const Channel = {
  typeUrl: "/ibc.core.channel.v1.Channel",
  encode(message: Channel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.state !== 0) {
      writer.uint32(8).int32(message.state);
    }
    if (message.ordering !== 0) {
      writer.uint32(16).int32(message.ordering);
    }
    if (message.counterparty !== undefined) {
      Counterparty.encode(message.counterparty, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.connection_hops) {
      writer.uint32(34).string(v!);
    }
    if (message.version !== "") {
      writer.uint32(42).string(message.version);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Channel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseChannel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.state = (reader.int32() as any);
          break;
        case 2:
          message.ordering = (reader.int32() as any);
          break;
        case 3:
          message.counterparty = Counterparty.decode(reader, reader.uint32());
          break;
        case 4:
          message.connection_hops.push(reader.string());
          break;
        case 5:
          message.version = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Channel {
    const obj = createBaseChannel();
    if (isSet(object.state)) obj.state = stateFromJSON(object.state);
    if (isSet(object.ordering)) obj.ordering = orderFromJSON(object.ordering);
    if (isSet(object.counterparty)) obj.counterparty = Counterparty.fromJSON(object.counterparty);
    if (Array.isArray(object?.connection_hops)) obj.connection_hops = object.connection_hops.map((e: any) => String(e));
    if (isSet(object.version)) obj.version = String(object.version);
    return obj;
  },
  toJSON(message: Channel): unknown {
    const obj: any = {};
    message.state !== undefined && (obj.state = stateToJSON(message.state));
    message.ordering !== undefined && (obj.ordering = orderToJSON(message.ordering));
    message.counterparty !== undefined && (obj.counterparty = message.counterparty ? Counterparty.toJSON(message.counterparty) : undefined);
    if (message.connection_hops) {
      obj.connection_hops = message.connection_hops.map(e => e);
    } else {
      obj.connection_hops = [];
    }
    message.version !== undefined && (obj.version = message.version);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Channel>, I>>(object: I): Channel {
    const message = createBaseChannel();
    message.state = object.state ?? 0;
    message.ordering = object.ordering ?? 0;
    if (object.counterparty !== undefined && object.counterparty !== null) {
      message.counterparty = Counterparty.fromPartial(object.counterparty);
    }
    message.connection_hops = object.connection_hops?.map(e => e) || [];
    message.version = object.version ?? "";
    return message;
  }
};
function createBaseIdentifiedChannel(): IdentifiedChannel {
  return {
    state: 0,
    ordering: 0,
    counterparty: Counterparty.fromPartial({}),
    connection_hops: [],
    version: "",
    port_id: "",
    channel_id: ""
  };
}
export const IdentifiedChannel = {
  typeUrl: "/ibc.core.channel.v1.IdentifiedChannel",
  encode(message: IdentifiedChannel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.state !== 0) {
      writer.uint32(8).int32(message.state);
    }
    if (message.ordering !== 0) {
      writer.uint32(16).int32(message.ordering);
    }
    if (message.counterparty !== undefined) {
      Counterparty.encode(message.counterparty, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.connection_hops) {
      writer.uint32(34).string(v!);
    }
    if (message.version !== "") {
      writer.uint32(42).string(message.version);
    }
    if (message.port_id !== "") {
      writer.uint32(50).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(58).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): IdentifiedChannel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseIdentifiedChannel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.state = (reader.int32() as any);
          break;
        case 2:
          message.ordering = (reader.int32() as any);
          break;
        case 3:
          message.counterparty = Counterparty.decode(reader, reader.uint32());
          break;
        case 4:
          message.connection_hops.push(reader.string());
          break;
        case 5:
          message.version = reader.string();
          break;
        case 6:
          message.port_id = reader.string();
          break;
        case 7:
          message.channel_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): IdentifiedChannel {
    const obj = createBaseIdentifiedChannel();
    if (isSet(object.state)) obj.state = stateFromJSON(object.state);
    if (isSet(object.ordering)) obj.ordering = orderFromJSON(object.ordering);
    if (isSet(object.counterparty)) obj.counterparty = Counterparty.fromJSON(object.counterparty);
    if (Array.isArray(object?.connection_hops)) obj.connection_hops = object.connection_hops.map((e: any) => String(e));
    if (isSet(object.version)) obj.version = String(object.version);
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: IdentifiedChannel): unknown {
    const obj: any = {};
    message.state !== undefined && (obj.state = stateToJSON(message.state));
    message.ordering !== undefined && (obj.ordering = orderToJSON(message.ordering));
    message.counterparty !== undefined && (obj.counterparty = message.counterparty ? Counterparty.toJSON(message.counterparty) : undefined);
    if (message.connection_hops) {
      obj.connection_hops = message.connection_hops.map(e => e);
    } else {
      obj.connection_hops = [];
    }
    message.version !== undefined && (obj.version = message.version);
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<IdentifiedChannel>, I>>(object: I): IdentifiedChannel {
    const message = createBaseIdentifiedChannel();
    message.state = object.state ?? 0;
    message.ordering = object.ordering ?? 0;
    if (object.counterparty !== undefined && object.counterparty !== null) {
      message.counterparty = Counterparty.fromPartial(object.counterparty);
    }
    message.connection_hops = object.connection_hops?.map(e => e) || [];
    message.version = object.version ?? "";
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  }
};
function createBaseCounterparty(): Counterparty {
  return {
    port_id: "",
    channel_id: ""
  };
}
export const Counterparty = {
  typeUrl: "/ibc.core.channel.v1.Counterparty",
  encode(message: Counterparty, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Counterparty {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCounterparty();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Counterparty {
    const obj = createBaseCounterparty();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: Counterparty): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Counterparty>, I>>(object: I): Counterparty {
    const message = createBaseCounterparty();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  }
};
function createBasePacket(): Packet {
  return {
    sequence: BigInt(0),
    source_port: "",
    source_channel: "",
    destination_port: "",
    destination_channel: "",
    data: new Uint8Array(),
    timeout_height: Height.fromPartial({}),
    timeout_timestamp: BigInt(0)
  };
}
export const Packet = {
  typeUrl: "/ibc.core.channel.v1.Packet",
  encode(message: Packet, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.sequence !== BigInt(0)) {
      writer.uint32(8).uint64(message.sequence);
    }
    if (message.source_port !== "") {
      writer.uint32(18).string(message.source_port);
    }
    if (message.source_channel !== "") {
      writer.uint32(26).string(message.source_channel);
    }
    if (message.destination_port !== "") {
      writer.uint32(34).string(message.destination_port);
    }
    if (message.destination_channel !== "") {
      writer.uint32(42).string(message.destination_channel);
    }
    if (message.data.length !== 0) {
      writer.uint32(50).bytes(message.data);
    }
    if (message.timeout_height !== undefined) {
      Height.encode(message.timeout_height, writer.uint32(58).fork()).ldelim();
    }
    if (message.timeout_timestamp !== BigInt(0)) {
      writer.uint32(64).uint64(message.timeout_timestamp);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Packet {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePacket();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sequence = reader.uint64();
          break;
        case 2:
          message.source_port = reader.string();
          break;
        case 3:
          message.source_channel = reader.string();
          break;
        case 4:
          message.destination_port = reader.string();
          break;
        case 5:
          message.destination_channel = reader.string();
          break;
        case 6:
          message.data = reader.bytes();
          break;
        case 7:
          message.timeout_height = Height.decode(reader, reader.uint32());
          break;
        case 8:
          message.timeout_timestamp = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Packet {
    const obj = createBasePacket();
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.source_port)) obj.source_port = String(object.source_port);
    if (isSet(object.source_channel)) obj.source_channel = String(object.source_channel);
    if (isSet(object.destination_port)) obj.destination_port = String(object.destination_port);
    if (isSet(object.destination_channel)) obj.destination_channel = String(object.destination_channel);
    if (isSet(object.data)) obj.data = bytesFromBase64(object.data);
    if (isSet(object.timeout_height)) obj.timeout_height = Height.fromJSON(object.timeout_height);
    if (isSet(object.timeout_timestamp)) obj.timeout_timestamp = BigInt(object.timeout_timestamp.toString());
    return obj;
  },
  toJSON(message: Packet): unknown {
    const obj: any = {};
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.source_port !== undefined && (obj.source_port = message.source_port);
    message.source_channel !== undefined && (obj.source_channel = message.source_channel);
    message.destination_port !== undefined && (obj.destination_port = message.destination_port);
    message.destination_channel !== undefined && (obj.destination_channel = message.destination_channel);
    message.data !== undefined && (obj.data = base64FromBytes(message.data !== undefined ? message.data : new Uint8Array()));
    message.timeout_height !== undefined && (obj.timeout_height = message.timeout_height ? Height.toJSON(message.timeout_height) : undefined);
    message.timeout_timestamp !== undefined && (obj.timeout_timestamp = (message.timeout_timestamp || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Packet>, I>>(object: I): Packet {
    const message = createBasePacket();
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    message.source_port = object.source_port ?? "";
    message.source_channel = object.source_channel ?? "";
    message.destination_port = object.destination_port ?? "";
    message.destination_channel = object.destination_channel ?? "";
    message.data = object.data ?? new Uint8Array();
    if (object.timeout_height !== undefined && object.timeout_height !== null) {
      message.timeout_height = Height.fromPartial(object.timeout_height);
    }
    if (object.timeout_timestamp !== undefined && object.timeout_timestamp !== null) {
      message.timeout_timestamp = BigInt(object.timeout_timestamp.toString());
    }
    return message;
  }
};
function createBasePacketState(): PacketState {
  return {
    port_id: "",
    channel_id: "",
    sequence: BigInt(0),
    data: new Uint8Array()
  };
}
export const PacketState = {
  typeUrl: "/ibc.core.channel.v1.PacketState",
  encode(message: PacketState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.sequence !== BigInt(0)) {
      writer.uint32(24).uint64(message.sequence);
    }
    if (message.data.length !== 0) {
      writer.uint32(34).bytes(message.data);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PacketState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePacketState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.sequence = reader.uint64();
          break;
        case 4:
          message.data = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PacketState {
    const obj = createBasePacketState();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.data)) obj.data = bytesFromBase64(object.data);
    return obj;
  },
  toJSON(message: PacketState): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.data !== undefined && (obj.data = base64FromBytes(message.data !== undefined ? message.data : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PacketState>, I>>(object: I): PacketState {
    const message = createBasePacketState();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    message.data = object.data ?? new Uint8Array();
    return message;
  }
};
function createBasePacketId(): PacketId {
  return {
    port_id: "",
    channel_id: "",
    sequence: BigInt(0)
  };
}
export const PacketId = {
  typeUrl: "/ibc.core.channel.v1.PacketId",
  encode(message: PacketId, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.sequence !== BigInt(0)) {
      writer.uint32(24).uint64(message.sequence);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PacketId {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePacketId();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.sequence = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PacketId {
    const obj = createBasePacketId();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    return obj;
  },
  toJSON(message: PacketId): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PacketId>, I>>(object: I): PacketId {
    const message = createBasePacketId();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    return message;
  }
};
function createBaseAcknowledgement(): Acknowledgement {
  return {
    result: undefined,
    error: undefined
  };
}
export const Acknowledgement = {
  typeUrl: "/ibc.core.channel.v1.Acknowledgement",
  encode(message: Acknowledgement, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.result !== undefined) {
      writer.uint32(170).bytes(message.result);
    }
    if (message.error !== undefined) {
      writer.uint32(178).string(message.error);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Acknowledgement {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAcknowledgement();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 21:
          message.result = reader.bytes();
          break;
        case 22:
          message.error = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Acknowledgement {
    const obj = createBaseAcknowledgement();
    if (isSet(object.result)) obj.result = bytesFromBase64(object.result);
    if (isSet(object.error)) obj.error = String(object.error);
    return obj;
  },
  toJSON(message: Acknowledgement): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = message.result !== undefined ? base64FromBytes(message.result) : undefined);
    message.error !== undefined && (obj.error = message.error);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Acknowledgement>, I>>(object: I): Acknowledgement {
    const message = createBaseAcknowledgement();
    message.result = object.result ?? undefined;
    message.error = object.error ?? undefined;
    return message;
  }
};