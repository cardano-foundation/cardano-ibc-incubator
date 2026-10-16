/* eslint-disable */
import { Timeout, Order, orderFromJSON, orderToJSON } from "./channel";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.core.channel.v1";
/**
 * Upgrade is a verifiable type which contains the relevant information
 * for an attempted upgrade. It provides the proposed changes to the channel
 * end, the timeout for this upgrade attempt and the next packet sequence
 * which allows the counterparty to efficiently know the highest sequence it has received.
 * The next sequence send is used for pruning and upgrading from unordered to ordered channels.
 * @name Upgrade
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.Upgrade
 */
export interface Upgrade {
  fields: UpgradeFields;
  timeout: Timeout;
  next_sequence_send: bigint;
}
/**
 * UpgradeFields are the fields in a channel end which may be changed
 * during a channel upgrade.
 * @name UpgradeFields
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.UpgradeFields
 */
export interface UpgradeFields {
  ordering: Order;
  connection_hops: string[];
  version: string;
}
/**
 * ErrorReceipt defines a type which encapsulates the upgrade sequence and error associated with the
 * upgrade handshake failure. When a channel upgrade handshake is aborted both chains are expected to increment to the
 * next sequence.
 * @name ErrorReceipt
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.ErrorReceipt
 */
export interface ErrorReceipt {
  /**
   * the channel upgrade sequence
   */
  sequence: bigint;
  /**
   * the error message detailing the cause of failure
   */
  message: string;
}
function createBaseUpgrade(): Upgrade {
  return {
    fields: UpgradeFields.fromPartial({}),
    timeout: Timeout.fromPartial({}),
    next_sequence_send: BigInt(0),
  };
}
/**
 * Upgrade is a verifiable type which contains the relevant information
 * for an attempted upgrade. It provides the proposed changes to the channel
 * end, the timeout for this upgrade attempt and the next packet sequence
 * which allows the counterparty to efficiently know the highest sequence it has received.
 * The next sequence send is used for pruning and upgrading from unordered to ordered channels.
 * @name Upgrade
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.Upgrade
 */
export const Upgrade = {
  typeUrl: "/ibc.core.channel.v1.Upgrade",
  encode(message: Upgrade, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.fields !== undefined) {
      UpgradeFields.encode(message.fields, writer.uint32(10).fork()).ldelim();
    }
    if (message.timeout !== undefined) {
      Timeout.encode(message.timeout, writer.uint32(18).fork()).ldelim();
    }
    if (message.next_sequence_send !== BigInt(0)) {
      writer.uint32(24).uint64(message.next_sequence_send);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Upgrade {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpgrade();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.fields = UpgradeFields.decode(reader, reader.uint32());
          break;
        case 2:
          message.timeout = Timeout.decode(reader, reader.uint32());
          break;
        case 3:
          message.next_sequence_send = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Upgrade {
    const obj = createBaseUpgrade();
    if (isSet(object.fields)) obj.fields = UpgradeFields.fromJSON(object.fields);
    if (isSet(object.timeout)) obj.timeout = Timeout.fromJSON(object.timeout);
    if (isSet(object.next_sequence_send))
      obj.next_sequence_send = BigInt(object.next_sequence_send.toString());
    return obj;
  },
  toJSON(message: Upgrade): unknown {
    const obj: any = {};
    message.fields !== undefined &&
      (obj.fields = message.fields ? UpgradeFields.toJSON(message.fields) : undefined);
    message.timeout !== undefined &&
      (obj.timeout = message.timeout ? Timeout.toJSON(message.timeout) : undefined);
    message.next_sequence_send !== undefined &&
      (obj.next_sequence_send = (message.next_sequence_send || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Upgrade>, I>>(object: I): Upgrade {
    const message = createBaseUpgrade();
    if (object.fields !== undefined && object.fields !== null) {
      message.fields = UpgradeFields.fromPartial(object.fields);
    }
    if (object.timeout !== undefined && object.timeout !== null) {
      message.timeout = Timeout.fromPartial(object.timeout);
    }
    if (object.next_sequence_send !== undefined && object.next_sequence_send !== null) {
      message.next_sequence_send = BigInt(object.next_sequence_send.toString());
    }
    return message;
  },
};
function createBaseUpgradeFields(): UpgradeFields {
  return {
    ordering: 0,
    connection_hops: [],
    version: "",
  };
}
/**
 * UpgradeFields are the fields in a channel end which may be changed
 * during a channel upgrade.
 * @name UpgradeFields
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.UpgradeFields
 */
export const UpgradeFields = {
  typeUrl: "/ibc.core.channel.v1.UpgradeFields",
  encode(message: UpgradeFields, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.ordering !== 0) {
      writer.uint32(8).int32(message.ordering);
    }
    for (const v of message.connection_hops) {
      writer.uint32(18).string(v!);
    }
    if (message.version !== "") {
      writer.uint32(26).string(message.version);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): UpgradeFields {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpgradeFields();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.ordering = reader.int32() as any;
          break;
        case 2:
          message.connection_hops.push(reader.string());
          break;
        case 3:
          message.version = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): UpgradeFields {
    const obj = createBaseUpgradeFields();
    if (isSet(object.ordering)) obj.ordering = orderFromJSON(object.ordering);
    if (Array.isArray(object?.connection_hops))
      obj.connection_hops = object.connection_hops.map((e: any) => String(e));
    if (isSet(object.version)) obj.version = String(object.version);
    return obj;
  },
  toJSON(message: UpgradeFields): unknown {
    const obj: any = {};
    message.ordering !== undefined && (obj.ordering = orderToJSON(message.ordering));
    if (message.connection_hops) {
      obj.connection_hops = message.connection_hops.map((e) => e);
    } else {
      obj.connection_hops = [];
    }
    message.version !== undefined && (obj.version = message.version);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<UpgradeFields>, I>>(object: I): UpgradeFields {
    const message = createBaseUpgradeFields();
    message.ordering = object.ordering ?? 0;
    message.connection_hops = object.connection_hops?.map((e) => e) || [];
    message.version = object.version ?? "";
    return message;
  },
};
function createBaseErrorReceipt(): ErrorReceipt {
  return {
    sequence: BigInt(0),
    message: "",
  };
}
/**
 * ErrorReceipt defines a type which encapsulates the upgrade sequence and error associated with the
 * upgrade handshake failure. When a channel upgrade handshake is aborted both chains are expected to increment to the
 * next sequence.
 * @name ErrorReceipt
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.ErrorReceipt
 */
export const ErrorReceipt = {
  typeUrl: "/ibc.core.channel.v1.ErrorReceipt",
  encode(message: ErrorReceipt, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.sequence !== BigInt(0)) {
      writer.uint32(8).uint64(message.sequence);
    }
    if (message.message !== "") {
      writer.uint32(18).string(message.message);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ErrorReceipt {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseErrorReceipt();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sequence = reader.uint64();
          break;
        case 2:
          message.message = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ErrorReceipt {
    const obj = createBaseErrorReceipt();
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.message)) obj.message = String(object.message);
    return obj;
  },
  toJSON(message: ErrorReceipt): unknown {
    const obj: any = {};
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.message !== undefined && (obj.message = message.message);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ErrorReceipt>, I>>(object: I): ErrorReceipt {
    const message = createBaseErrorReceipt();
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    message.message = object.message ?? "";
    return message;
  },
};
