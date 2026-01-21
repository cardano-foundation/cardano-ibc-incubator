/* eslint-disable */
import { IdentifiedChannel, PacketState } from "./channel";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.core.channel.v1";
/** GenesisState defines the ibc channel submodule's genesis state. */
export interface GenesisState {
  channels: IdentifiedChannel[];
  acknowledgements: PacketState[];
  commitments: PacketState[];
  receipts: PacketState[];
  send_sequences: PacketSequence[];
  recv_sequences: PacketSequence[];
  ack_sequences: PacketSequence[];
  /** the sequence for the next generated channel identifier */
  next_channel_sequence: bigint;
}
/**
 * PacketSequence defines the genesis type necessary to retrieve and store
 * next send and receive sequences.
 */
export interface PacketSequence {
  port_id: string;
  channel_id: string;
  sequence: bigint;
}
function createBaseGenesisState(): GenesisState {
  return {
    channels: [],
    acknowledgements: [],
    commitments: [],
    receipts: [],
    send_sequences: [],
    recv_sequences: [],
    ack_sequences: [],
    next_channel_sequence: BigInt(0),
  };
}
export const GenesisState = {
  typeUrl: "/ibc.core.channel.v1.GenesisState",
  encode(message: GenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.channels) {
      IdentifiedChannel.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.acknowledgements) {
      PacketState.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.commitments) {
      PacketState.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.receipts) {
      PacketState.encode(v!, writer.uint32(34).fork()).ldelim();
    }
    for (const v of message.send_sequences) {
      PacketSequence.encode(v!, writer.uint32(42).fork()).ldelim();
    }
    for (const v of message.recv_sequences) {
      PacketSequence.encode(v!, writer.uint32(50).fork()).ldelim();
    }
    for (const v of message.ack_sequences) {
      PacketSequence.encode(v!, writer.uint32(58).fork()).ldelim();
    }
    if (message.next_channel_sequence !== BigInt(0)) {
      writer.uint32(64).uint64(message.next_channel_sequence);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): GenesisState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGenesisState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channels.push(IdentifiedChannel.decode(reader, reader.uint32()));
          break;
        case 2:
          message.acknowledgements.push(PacketState.decode(reader, reader.uint32()));
          break;
        case 3:
          message.commitments.push(PacketState.decode(reader, reader.uint32()));
          break;
        case 4:
          message.receipts.push(PacketState.decode(reader, reader.uint32()));
          break;
        case 5:
          message.send_sequences.push(PacketSequence.decode(reader, reader.uint32()));
          break;
        case 6:
          message.recv_sequences.push(PacketSequence.decode(reader, reader.uint32()));
          break;
        case 7:
          message.ack_sequences.push(PacketSequence.decode(reader, reader.uint32()));
          break;
        case 8:
          message.next_channel_sequence = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): GenesisState {
    const obj = createBaseGenesisState();
    if (Array.isArray(object?.channels))
      obj.channels = object.channels.map((e: any) => IdentifiedChannel.fromJSON(e));
    if (Array.isArray(object?.acknowledgements))
      obj.acknowledgements = object.acknowledgements.map((e: any) => PacketState.fromJSON(e));
    if (Array.isArray(object?.commitments))
      obj.commitments = object.commitments.map((e: any) => PacketState.fromJSON(e));
    if (Array.isArray(object?.receipts))
      obj.receipts = object.receipts.map((e: any) => PacketState.fromJSON(e));
    if (Array.isArray(object?.send_sequences))
      obj.send_sequences = object.send_sequences.map((e: any) => PacketSequence.fromJSON(e));
    if (Array.isArray(object?.recv_sequences))
      obj.recv_sequences = object.recv_sequences.map((e: any) => PacketSequence.fromJSON(e));
    if (Array.isArray(object?.ack_sequences))
      obj.ack_sequences = object.ack_sequences.map((e: any) => PacketSequence.fromJSON(e));
    if (isSet(object.next_channel_sequence))
      obj.next_channel_sequence = BigInt(object.next_channel_sequence.toString());
    return obj;
  },
  toJSON(message: GenesisState): unknown {
    const obj: any = {};
    if (message.channels) {
      obj.channels = message.channels.map((e) => (e ? IdentifiedChannel.toJSON(e) : undefined));
    } else {
      obj.channels = [];
    }
    if (message.acknowledgements) {
      obj.acknowledgements = message.acknowledgements.map((e) => (e ? PacketState.toJSON(e) : undefined));
    } else {
      obj.acknowledgements = [];
    }
    if (message.commitments) {
      obj.commitments = message.commitments.map((e) => (e ? PacketState.toJSON(e) : undefined));
    } else {
      obj.commitments = [];
    }
    if (message.receipts) {
      obj.receipts = message.receipts.map((e) => (e ? PacketState.toJSON(e) : undefined));
    } else {
      obj.receipts = [];
    }
    if (message.send_sequences) {
      obj.send_sequences = message.send_sequences.map((e) => (e ? PacketSequence.toJSON(e) : undefined));
    } else {
      obj.send_sequences = [];
    }
    if (message.recv_sequences) {
      obj.recv_sequences = message.recv_sequences.map((e) => (e ? PacketSequence.toJSON(e) : undefined));
    } else {
      obj.recv_sequences = [];
    }
    if (message.ack_sequences) {
      obj.ack_sequences = message.ack_sequences.map((e) => (e ? PacketSequence.toJSON(e) : undefined));
    } else {
      obj.ack_sequences = [];
    }
    message.next_channel_sequence !== undefined &&
      (obj.next_channel_sequence = (message.next_channel_sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisState>, I>>(object: I): GenesisState {
    const message = createBaseGenesisState();
    message.channels = object.channels?.map((e) => IdentifiedChannel.fromPartial(e)) || [];
    message.acknowledgements = object.acknowledgements?.map((e) => PacketState.fromPartial(e)) || [];
    message.commitments = object.commitments?.map((e) => PacketState.fromPartial(e)) || [];
    message.receipts = object.receipts?.map((e) => PacketState.fromPartial(e)) || [];
    message.send_sequences = object.send_sequences?.map((e) => PacketSequence.fromPartial(e)) || [];
    message.recv_sequences = object.recv_sequences?.map((e) => PacketSequence.fromPartial(e)) || [];
    message.ack_sequences = object.ack_sequences?.map((e) => PacketSequence.fromPartial(e)) || [];
    if (object.next_channel_sequence !== undefined && object.next_channel_sequence !== null) {
      message.next_channel_sequence = BigInt(object.next_channel_sequence.toString());
    }
    return message;
  },
};
function createBasePacketSequence(): PacketSequence {
  return {
    port_id: "",
    channel_id: "",
    sequence: BigInt(0),
  };
}
export const PacketSequence = {
  typeUrl: "/ibc.core.channel.v1.PacketSequence",
  encode(message: PacketSequence, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
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
  decode(input: BinaryReader | Uint8Array, length?: number): PacketSequence {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePacketSequence();
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
  fromJSON(object: any): PacketSequence {
    const obj = createBasePacketSequence();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    return obj;
  },
  toJSON(message: PacketSequence): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PacketSequence>, I>>(object: I): PacketSequence {
    const message = createBasePacketSequence();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    return message;
  },
};
