/* eslint-disable */
import { Height } from "../../client/v1/client";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.core.types.v1";
export interface EventAttribute {
  key: string;
  value: string;
  index: boolean;
}
export interface Event {
  type: string;
  event_attribute: EventAttribute[];
}
export interface ResponseDeliverTx {
  code: number;
  events: Event[];
}
export interface ResultBlockResults {
  /** height at which the proof was retrieved */
  height?: Height;
  /** txs result in blocks */
  txs_results: ResponseDeliverTx[];
}
function createBaseEventAttribute(): EventAttribute {
  return {
    key: "",
    value: "",
    index: false
  };
}
export const EventAttribute = {
  typeUrl: "/ibc.core.types.v1.EventAttribute",
  encode(message: EventAttribute, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key !== "") {
      writer.uint32(10).string(message.key);
    }
    if (message.value !== "") {
      writer.uint32(18).string(message.value);
    }
    if (message.index === true) {
      writer.uint32(24).bool(message.index);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): EventAttribute {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEventAttribute();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key = reader.string();
          break;
        case 2:
          message.value = reader.string();
          break;
        case 3:
          message.index = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): EventAttribute {
    const obj = createBaseEventAttribute();
    if (isSet(object.key)) obj.key = String(object.key);
    if (isSet(object.value)) obj.value = String(object.value);
    if (isSet(object.index)) obj.index = Boolean(object.index);
    return obj;
  },
  toJSON(message: EventAttribute): unknown {
    const obj: any = {};
    message.key !== undefined && (obj.key = message.key);
    message.value !== undefined && (obj.value = message.value);
    message.index !== undefined && (obj.index = message.index);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<EventAttribute>, I>>(object: I): EventAttribute {
    const message = createBaseEventAttribute();
    message.key = object.key ?? "";
    message.value = object.value ?? "";
    message.index = object.index ?? false;
    return message;
  }
};
function createBaseEvent(): Event {
  return {
    type: "",
    event_attribute: []
  };
}
export const Event = {
  typeUrl: "/ibc.core.types.v1.Event",
  encode(message: Event, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.type !== "") {
      writer.uint32(10).string(message.type);
    }
    for (const v of message.event_attribute) {
      EventAttribute.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Event {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEvent();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.type = reader.string();
          break;
        case 2:
          message.event_attribute.push(EventAttribute.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Event {
    const obj = createBaseEvent();
    if (isSet(object.type)) obj.type = String(object.type);
    if (Array.isArray(object?.event_attribute)) obj.event_attribute = object.event_attribute.map((e: any) => EventAttribute.fromJSON(e));
    return obj;
  },
  toJSON(message: Event): unknown {
    const obj: any = {};
    message.type !== undefined && (obj.type = message.type);
    if (message.event_attribute) {
      obj.event_attribute = message.event_attribute.map(e => e ? EventAttribute.toJSON(e) : undefined);
    } else {
      obj.event_attribute = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Event>, I>>(object: I): Event {
    const message = createBaseEvent();
    message.type = object.type ?? "";
    message.event_attribute = object.event_attribute?.map(e => EventAttribute.fromPartial(e)) || [];
    return message;
  }
};
function createBaseResponseDeliverTx(): ResponseDeliverTx {
  return {
    code: 0,
    events: []
  };
}
export const ResponseDeliverTx = {
  typeUrl: "/ibc.core.types.v1.ResponseDeliverTx",
  encode(message: ResponseDeliverTx, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.code !== 0) {
      writer.uint32(8).uint32(message.code);
    }
    for (const v of message.events) {
      Event.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ResponseDeliverTx {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseResponseDeliverTx();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.code = reader.uint32();
          break;
        case 2:
          message.events.push(Event.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ResponseDeliverTx {
    const obj = createBaseResponseDeliverTx();
    if (isSet(object.code)) obj.code = Number(object.code);
    if (Array.isArray(object?.events)) obj.events = object.events.map((e: any) => Event.fromJSON(e));
    return obj;
  },
  toJSON(message: ResponseDeliverTx): unknown {
    const obj: any = {};
    message.code !== undefined && (obj.code = Math.round(message.code));
    if (message.events) {
      obj.events = message.events.map(e => e ? Event.toJSON(e) : undefined);
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ResponseDeliverTx>, I>>(object: I): ResponseDeliverTx {
    const message = createBaseResponseDeliverTx();
    message.code = object.code ?? 0;
    message.events = object.events?.map(e => Event.fromPartial(e)) || [];
    return message;
  }
};
function createBaseResultBlockResults(): ResultBlockResults {
  return {
    height: undefined,
    txs_results: []
  };
}
export const ResultBlockResults = {
  typeUrl: "/ibc.core.types.v1.ResultBlockResults",
  encode(message: ResultBlockResults, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.txs_results) {
      ResponseDeliverTx.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ResultBlockResults {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseResultBlockResults();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = Height.decode(reader, reader.uint32());
          break;
        case 2:
          message.txs_results.push(ResponseDeliverTx.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ResultBlockResults {
    const obj = createBaseResultBlockResults();
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    if (Array.isArray(object?.txs_results)) obj.txs_results = object.txs_results.map((e: any) => ResponseDeliverTx.fromJSON(e));
    return obj;
  },
  toJSON(message: ResultBlockResults): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    if (message.txs_results) {
      obj.txs_results = message.txs_results.map(e => e ? ResponseDeliverTx.toJSON(e) : undefined);
    } else {
      obj.txs_results = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ResultBlockResults>, I>>(object: I): ResultBlockResults {
    const message = createBaseResultBlockResults();
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    message.txs_results = object.txs_results?.map(e => ResponseDeliverTx.fromPartial(e)) || [];
    return message;
  }
};