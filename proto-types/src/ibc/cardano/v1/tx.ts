/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact } from "../../../helpers";
export const protobufPackage = "ibc.cardano.v1";
/** SubmitSignedTxRequest contains a signed Cardano transaction in CBOR format. */
export interface SubmitSignedTxRequest {
  /**
   * Signed transaction in CBOR hex format.
   * This is the completed, signed Cardano transaction ready for submission.
   */
  signed_tx_cbor: string;
  /** Optional description for logging/debugging. */
  description: string;
}
/** SubmitSignedTxResponse contains the result of submitting a signed transaction. */
export interface SubmitSignedTxResponse {
  /** Transaction hash (Blake2b-256 hash of the signed transaction). */
  tx_hash: string;
  /** Block height at which the transaction was confirmed (if available). */
  height: string;
  /** Raw transaction events (for IBC event parsing). */
  events: Event[];
}
/** Event represents a transaction event with type and attributes. */
export interface Event {
  type: string;
  attributes: EventAttribute[];
}
/** EventAttribute represents a key-value pair in an event. */
export interface EventAttribute {
  key: string;
  value: string;
}
function createBaseSubmitSignedTxRequest(): SubmitSignedTxRequest {
  return {
    signed_tx_cbor: "",
    description: "",
  };
}
export const SubmitSignedTxRequest = {
  typeUrl: "/ibc.cardano.v1.SubmitSignedTxRequest",
  encode(message: SubmitSignedTxRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signed_tx_cbor !== "") {
      writer.uint32(10).string(message.signed_tx_cbor);
    }
    if (message.description !== "") {
      writer.uint32(18).string(message.description);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SubmitSignedTxRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSubmitSignedTxRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signed_tx_cbor = reader.string();
          break;
        case 2:
          message.description = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SubmitSignedTxRequest {
    const obj = createBaseSubmitSignedTxRequest();
    if (isSet(object.signed_tx_cbor)) obj.signed_tx_cbor = String(object.signed_tx_cbor);
    if (isSet(object.description)) obj.description = String(object.description);
    return obj;
  },
  toJSON(message: SubmitSignedTxRequest): unknown {
    const obj: any = {};
    message.signed_tx_cbor !== undefined && (obj.signed_tx_cbor = message.signed_tx_cbor);
    message.description !== undefined && (obj.description = message.description);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SubmitSignedTxRequest>, I>>(object: I): SubmitSignedTxRequest {
    const message = createBaseSubmitSignedTxRequest();
    message.signed_tx_cbor = object.signed_tx_cbor ?? "";
    message.description = object.description ?? "";
    return message;
  },
};
function createBaseSubmitSignedTxResponse(): SubmitSignedTxResponse {
  return {
    tx_hash: "",
    height: "",
    events: [],
  };
}
export const SubmitSignedTxResponse = {
  typeUrl: "/ibc.cardano.v1.SubmitSignedTxResponse",
  encode(message: SubmitSignedTxResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.tx_hash !== "") {
      writer.uint32(10).string(message.tx_hash);
    }
    if (message.height !== "") {
      writer.uint32(18).string(message.height);
    }
    for (const v of message.events) {
      Event.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SubmitSignedTxResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSubmitSignedTxResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.tx_hash = reader.string();
          break;
        case 2:
          message.height = reader.string();
          break;
        case 3:
          message.events.push(Event.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SubmitSignedTxResponse {
    const obj = createBaseSubmitSignedTxResponse();
    if (isSet(object.tx_hash)) obj.tx_hash = String(object.tx_hash);
    if (isSet(object.height)) obj.height = String(object.height);
    if (Array.isArray(object?.events)) obj.events = object.events.map((e: any) => Event.fromJSON(e));
    return obj;
  },
  toJSON(message: SubmitSignedTxResponse): unknown {
    const obj: any = {};
    message.tx_hash !== undefined && (obj.tx_hash = message.tx_hash);
    message.height !== undefined && (obj.height = message.height);
    if (message.events) {
      obj.events = message.events.map((e) => (e ? Event.toJSON(e) : undefined));
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SubmitSignedTxResponse>, I>>(object: I): SubmitSignedTxResponse {
    const message = createBaseSubmitSignedTxResponse();
    message.tx_hash = object.tx_hash ?? "";
    message.height = object.height ?? "";
    message.events = object.events?.map((e) => Event.fromPartial(e)) || [];
    return message;
  },
};
function createBaseEvent(): Event {
  return {
    type: "",
    attributes: [],
  };
}
export const Event = {
  typeUrl: "/ibc.cardano.v1.Event",
  encode(message: Event, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.type !== "") {
      writer.uint32(10).string(message.type);
    }
    for (const v of message.attributes) {
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
          message.attributes.push(EventAttribute.decode(reader, reader.uint32()));
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
    if (Array.isArray(object?.attributes))
      obj.attributes = object.attributes.map((e: any) => EventAttribute.fromJSON(e));
    return obj;
  },
  toJSON(message: Event): unknown {
    const obj: any = {};
    message.type !== undefined && (obj.type = message.type);
    if (message.attributes) {
      obj.attributes = message.attributes.map((e) => (e ? EventAttribute.toJSON(e) : undefined));
    } else {
      obj.attributes = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Event>, I>>(object: I): Event {
    const message = createBaseEvent();
    message.type = object.type ?? "";
    message.attributes = object.attributes?.map((e) => EventAttribute.fromPartial(e)) || [];
    return message;
  },
};
function createBaseEventAttribute(): EventAttribute {
  return {
    key: "",
    value: "",
  };
}
export const EventAttribute = {
  typeUrl: "/ibc.cardano.v1.EventAttribute",
  encode(message: EventAttribute, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key !== "") {
      writer.uint32(10).string(message.key);
    }
    if (message.value !== "") {
      writer.uint32(18).string(message.value);
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
    return obj;
  },
  toJSON(message: EventAttribute): unknown {
    const obj: any = {};
    message.key !== undefined && (obj.key = message.key);
    message.value !== undefined && (obj.value = message.value);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<EventAttribute>, I>>(object: I): EventAttribute {
    const message = createBaseEventAttribute();
    message.key = object.key ?? "";
    message.value = object.value ?? "";
    return message;
  },
};
