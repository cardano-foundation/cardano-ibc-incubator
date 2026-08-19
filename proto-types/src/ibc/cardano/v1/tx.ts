/* eslint-disable */
import { Height } from "../../core/client/v1/client";
import { Any } from "../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../helpers";
export const protobufPackage = "ibc.cardano.v1";
/**
 * @name BuildHostStateHeartbeatRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatRequest
 */
export interface BuildHostStateHeartbeatRequest {
  /**
   * Cardano address whose UTxOs fund and sign the heartbeat transaction.
   */
  signer: string;
}
/**
 * @name BuildHostStateHeartbeatResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatResponse
 */
export interface BuildHostStateHeartbeatResponse {
  /**
   * False when an ordinary IBC transaction or heartbeat has already refreshed
   * HostState in the current epoch.
   */
  heartbeat_required: boolean;
  current_epoch: bigint;
  host_state_epoch: bigint;
  /**
   * Present only when heartbeat_required is true. The value contains the
   * unsigned Cardano transaction CBOR encoded as UTF-8 hex.
   */
  unsigned_tx?: Any;
}
/**
 * @name MsgPrunePacketHistory
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistory
 */
export interface MsgPrunePacketHistory {
  /**
   * Cardano address whose UTxOs fund and sign the pruning transaction.
   */
  signer: string;
  /**
   * Local Cardano channel identifiers whose retained history is pruned.
   */
  port_id: string;
  channel_id: string;
  sequence: bigint;
  /**
   * ICS-23 non-membership proof for the corresponding source-chain packet
   * commitment, evaluated at proof_height.
   */
  proof_commitment_absence: Uint8Array;
  proof_height?: Height;
}
/**
 * @name MsgPrunePacketHistoryResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistoryResponse
 */
export interface MsgPrunePacketHistoryResponse {
  /**
   * Unsigned Cardano transaction CBOR encoded as UTF-8 hex.
   */
  unsigned_tx?: Any;
}
/**
 * SubmitSignedTxRequest contains a signed Cardano transaction in CBOR format.
 * @name SubmitSignedTxRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxRequest
 */
export interface SubmitSignedTxRequest {
  /**
   * Signed transaction in CBOR hex format.
   * This is the completed, signed Cardano transaction ready for submission.
   */
  signed_tx_cbor: string;
  /**
   * Optional description for logging/debugging.
   */
  description: string;
}
/**
 * SubmitSignedTxResponse contains the result of submitting a signed transaction.
 * @name SubmitSignedTxResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxResponse
 */
export interface SubmitSignedTxResponse {
  /**
   * Transaction hash (Blake2b-256 hash of the signed transaction).
   */
  tx_hash: string;
  /**
   * Block height at which the transaction was confirmed (if available).
   */
  height: string;
  /**
   * Raw transaction events (for IBC event parsing).
   */
  events: Event[];
}
/**
 * Event represents a transaction event with type and attributes.
 * @name Event
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.Event
 */
export interface Event {
  type: string;
  attributes: EventAttribute[];
}
/**
 * EventAttribute represents a key-value pair in an event.
 * @name EventAttribute
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.EventAttribute
 */
export interface EventAttribute {
  key: string;
  value: string;
}
function createBaseBuildHostStateHeartbeatRequest(): BuildHostStateHeartbeatRequest {
  return {
    signer: "",
  };
}
/**
 * @name BuildHostStateHeartbeatRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatRequest
 */
export const BuildHostStateHeartbeatRequest = {
  typeUrl: "/ibc.cardano.v1.BuildHostStateHeartbeatRequest",
  encode(
    message: BuildHostStateHeartbeatRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BuildHostStateHeartbeatRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBuildHostStateHeartbeatRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BuildHostStateHeartbeatRequest {
    const obj = createBaseBuildHostStateHeartbeatRequest();
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: BuildHostStateHeartbeatRequest): unknown {
    const obj: any = {};
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BuildHostStateHeartbeatRequest>, I>>(
    object: I,
  ): BuildHostStateHeartbeatRequest {
    const message = createBaseBuildHostStateHeartbeatRequest();
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseBuildHostStateHeartbeatResponse(): BuildHostStateHeartbeatResponse {
  return {
    heartbeat_required: false,
    current_epoch: BigInt(0),
    host_state_epoch: BigInt(0),
    unsigned_tx: undefined,
  };
}
/**
 * @name BuildHostStateHeartbeatResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatResponse
 */
export const BuildHostStateHeartbeatResponse = {
  typeUrl: "/ibc.cardano.v1.BuildHostStateHeartbeatResponse",
  encode(
    message: BuildHostStateHeartbeatResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.heartbeat_required === true) {
      writer.uint32(8).bool(message.heartbeat_required);
    }
    if (message.current_epoch !== BigInt(0)) {
      writer.uint32(16).uint64(message.current_epoch);
    }
    if (message.host_state_epoch !== BigInt(0)) {
      writer.uint32(24).uint64(message.host_state_epoch);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BuildHostStateHeartbeatResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBuildHostStateHeartbeatResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.heartbeat_required = reader.bool();
          break;
        case 2:
          message.current_epoch = reader.uint64();
          break;
        case 3:
          message.host_state_epoch = reader.uint64();
          break;
        case 4:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BuildHostStateHeartbeatResponse {
    const obj = createBaseBuildHostStateHeartbeatResponse();
    if (isSet(object.heartbeat_required)) obj.heartbeat_required = Boolean(object.heartbeat_required);
    if (isSet(object.current_epoch)) obj.current_epoch = BigInt(object.current_epoch.toString());
    if (isSet(object.host_state_epoch)) obj.host_state_epoch = BigInt(object.host_state_epoch.toString());
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: BuildHostStateHeartbeatResponse): unknown {
    const obj: any = {};
    message.heartbeat_required !== undefined && (obj.heartbeat_required = message.heartbeat_required);
    message.current_epoch !== undefined &&
      (obj.current_epoch = (message.current_epoch || BigInt(0)).toString());
    message.host_state_epoch !== undefined &&
      (obj.host_state_epoch = (message.host_state_epoch || BigInt(0)).toString());
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BuildHostStateHeartbeatResponse>, I>>(
    object: I,
  ): BuildHostStateHeartbeatResponse {
    const message = createBaseBuildHostStateHeartbeatResponse();
    message.heartbeat_required = object.heartbeat_required ?? false;
    if (object.current_epoch !== undefined && object.current_epoch !== null) {
      message.current_epoch = BigInt(object.current_epoch.toString());
    }
    if (object.host_state_epoch !== undefined && object.host_state_epoch !== null) {
      message.host_state_epoch = BigInt(object.host_state_epoch.toString());
    }
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgPrunePacketHistory(): MsgPrunePacketHistory {
  return {
    signer: "",
    port_id: "",
    channel_id: "",
    sequence: BigInt(0),
    proof_commitment_absence: new Uint8Array(),
    proof_height: undefined,
  };
}
/**
 * @name MsgPrunePacketHistory
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistory
 */
export const MsgPrunePacketHistory = {
  typeUrl: "/ibc.cardano.v1.MsgPrunePacketHistory",
  encode(message: MsgPrunePacketHistory, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    if (message.port_id !== "") {
      writer.uint32(18).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(26).string(message.channel_id);
    }
    if (message.sequence !== BigInt(0)) {
      writer.uint32(32).uint64(message.sequence);
    }
    if (message.proof_commitment_absence.length !== 0) {
      writer.uint32(42).bytes(message.proof_commitment_absence);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(50).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPrunePacketHistory {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPrunePacketHistory();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signer = reader.string();
          break;
        case 2:
          message.port_id = reader.string();
          break;
        case 3:
          message.channel_id = reader.string();
          break;
        case 4:
          message.sequence = reader.uint64();
          break;
        case 5:
          message.proof_commitment_absence = reader.bytes();
          break;
        case 6:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgPrunePacketHistory {
    const obj = createBaseMsgPrunePacketHistory();
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.proof_commitment_absence))
      obj.proof_commitment_absence = bytesFromBase64(object.proof_commitment_absence);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: MsgPrunePacketHistory): unknown {
    const obj: any = {};
    message.signer !== undefined && (obj.signer = message.signer);
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.proof_commitment_absence !== undefined &&
      (obj.proof_commitment_absence = base64FromBytes(
        message.proof_commitment_absence !== undefined ? message.proof_commitment_absence : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPrunePacketHistory>, I>>(object: I): MsgPrunePacketHistory {
    const message = createBaseMsgPrunePacketHistory();
    message.signer = object.signer ?? "";
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    message.proof_commitment_absence = object.proof_commitment_absence ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseMsgPrunePacketHistoryResponse(): MsgPrunePacketHistoryResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgPrunePacketHistoryResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistoryResponse
 */
export const MsgPrunePacketHistoryResponse = {
  typeUrl: "/ibc.cardano.v1.MsgPrunePacketHistoryResponse",
  encode(message: MsgPrunePacketHistoryResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPrunePacketHistoryResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPrunePacketHistoryResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgPrunePacketHistoryResponse {
    const obj = createBaseMsgPrunePacketHistoryResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgPrunePacketHistoryResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPrunePacketHistoryResponse>, I>>(
    object: I,
  ): MsgPrunePacketHistoryResponse {
    const message = createBaseMsgPrunePacketHistoryResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseSubmitSignedTxRequest(): SubmitSignedTxRequest {
  return {
    signed_tx_cbor: "",
    description: "",
  };
}
/**
 * SubmitSignedTxRequest contains a signed Cardano transaction in CBOR format.
 * @name SubmitSignedTxRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxRequest
 */
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
/**
 * SubmitSignedTxResponse contains the result of submitting a signed transaction.
 * @name SubmitSignedTxResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxResponse
 */
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
/**
 * Event represents a transaction event with type and attributes.
 * @name Event
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.Event
 */
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
/**
 * EventAttribute represents a key-value pair in an event.
 * @name EventAttribute
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.EventAttribute
 */
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
