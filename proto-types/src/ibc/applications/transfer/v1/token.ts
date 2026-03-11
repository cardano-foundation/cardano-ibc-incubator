/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.applications.transfer.v1";
/** Token defines a struct which represents a token to be transferred. */
export interface Token {
  /** the token denomination */
  denom: Denom;
  /** the token amount to be transferred */
  amount: string;
}
/** Denom holds the base denom of a Token and a trace of the chains it was sent through. */
export interface Denom {
  /** the base token denomination */
  base: string;
  /** the trace of the token */
  trace: Hop[];
}
/** Hop defines a port ID, channel ID pair specifying a unique "hop" in a trace */
export interface Hop {
  port_id: string;
  channel_id: string;
}
function createBaseToken(): Token {
  return {
    denom: Denom.fromPartial({}),
    amount: "",
  };
}
export const Token = {
  typeUrl: "/ibc.applications.transfer.v1.Token",
  encode(message: Token, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.denom !== undefined) {
      Denom.encode(message.denom, writer.uint32(10).fork()).ldelim();
    }
    if (message.amount !== "") {
      writer.uint32(18).string(message.amount);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Token {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseToken();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.denom = Denom.decode(reader, reader.uint32());
          break;
        case 2:
          message.amount = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Token {
    const obj = createBaseToken();
    if (isSet(object.denom)) obj.denom = Denom.fromJSON(object.denom);
    if (isSet(object.amount)) obj.amount = String(object.amount);
    return obj;
  },
  toJSON(message: Token): unknown {
    const obj: any = {};
    message.denom !== undefined && (obj.denom = message.denom ? Denom.toJSON(message.denom) : undefined);
    message.amount !== undefined && (obj.amount = message.amount);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Token>, I>>(object: I): Token {
    const message = createBaseToken();
    if (object.denom !== undefined && object.denom !== null) {
      message.denom = Denom.fromPartial(object.denom);
    }
    message.amount = object.amount ?? "";
    return message;
  },
};
function createBaseDenom(): Denom {
  return {
    base: "",
    trace: [],
  };
}
export const Denom = {
  typeUrl: "/ibc.applications.transfer.v1.Denom",
  encode(message: Denom, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.base !== "") {
      writer.uint32(10).string(message.base);
    }
    for (const v of message.trace) {
      Hop.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Denom {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseDenom();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.base = reader.string();
          break;
        case 3:
          message.trace.push(Hop.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Denom {
    const obj = createBaseDenom();
    if (isSet(object.base)) obj.base = String(object.base);
    if (Array.isArray(object?.trace)) obj.trace = object.trace.map((e: any) => Hop.fromJSON(e));
    return obj;
  },
  toJSON(message: Denom): unknown {
    const obj: any = {};
    message.base !== undefined && (obj.base = message.base);
    if (message.trace) {
      obj.trace = message.trace.map((e) => (e ? Hop.toJSON(e) : undefined));
    } else {
      obj.trace = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Denom>, I>>(object: I): Denom {
    const message = createBaseDenom();
    message.base = object.base ?? "";
    message.trace = object.trace?.map((e) => Hop.fromPartial(e)) || [];
    return message;
  },
};
function createBaseHop(): Hop {
  return {
    port_id: "",
    channel_id: "",
  };
}
export const Hop = {
  typeUrl: "/ibc.applications.transfer.v1.Hop",
  encode(message: Hop, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Hop {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHop();
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
  fromJSON(object: any): Hop {
    const obj = createBaseHop();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: Hop): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Hop>, I>>(object: I): Hop {
    const message = createBaseHop();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  },
};
