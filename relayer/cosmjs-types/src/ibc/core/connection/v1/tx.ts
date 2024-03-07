/* eslint-disable */
import { Counterparty, Version } from "./connection";
import { Any } from "../../../../google/protobuf/any";
import { Height } from "../../client/v1/client";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.core.connection.v1";
/**
 * MsgConnectionOpenInit defines the msg sent by an account on Chain A to
 * initialize a connection with Chain B.
 */
export interface MsgConnectionOpenInit {
  client_id: string;
  counterparty: Counterparty;
  version?: Version;
  delay_period: bigint;
  signer: string;
}
/**
 * MsgConnectionOpenInitResponse defines the Msg/ConnectionOpenInit response
 * type.
 */
export interface MsgConnectionOpenInitResponse {
  unsigned_tx?: Any;
}
/**
 * MsgConnectionOpenTry defines a msg sent by a Relayer to try to open a
 * connection on Chain B.
 */
export interface MsgConnectionOpenTry {
  client_id: string;
  /** Deprecated: this field is unused. Crossing hellos are no longer supported in core IBC. */
  /** @deprecated */
  previous_connection_id: string;
  client_state?: Any;
  counterparty: Counterparty;
  delay_period: bigint;
  counterparty_versions: Version[];
  proof_height: Height;
  /**
   * proof of the initialization the connection on Chain A: `UNITIALIZED ->
   * INIT`
   */
  proof_init: Uint8Array;
  /** proof of client state included in message */
  proof_client: Uint8Array;
  /** proof of client consensus state */
  proof_consensus: Uint8Array;
  consensus_height: Height;
  signer: string;
  /** optional proof data for host state machines that are unable to introspect their own consensus state */
  host_consensus_state_proof: Uint8Array;
}
/** MsgConnectionOpenTryResponse defines the Msg/ConnectionOpenTry response type. */
export interface MsgConnectionOpenTryResponse {
  unsigned_tx?: Any;
}
/**
 * MsgConnectionOpenAck defines a msg sent by a Relayer to Chain A to
 * acknowledge the change of connection state to TRYOPEN on Chain B.
 */
export interface MsgConnectionOpenAck {
  connection_id: string;
  counterparty_connection_id: string;
  version?: Version;
  client_state?: Any;
  proof_height: Height;
  /**
   * proof of the initialization the connection on Chain B: `UNITIALIZED ->
   * TRYOPEN`
   */
  proof_try: Uint8Array;
  /** proof of client state included in message */
  proof_client: Uint8Array;
  /** proof of client consensus state */
  proof_consensus: Uint8Array;
  consensus_height: Height;
  signer: string;
  /** optional proof data for host state machines that are unable to introspect their own consensus state */
  host_consensus_state_proof: Uint8Array;
}
/** MsgConnectionOpenAckResponse defines the Msg/ConnectionOpenAck response type. */
export interface MsgConnectionOpenAckResponse {
  unsigned_tx?: Any;
}
/**
 * MsgConnectionOpenConfirm defines a msg sent by a Relayer to Chain B to
 * acknowledge the change of connection state to OPEN on Chain A.
 */
export interface MsgConnectionOpenConfirm {
  connection_id: string;
  /** proof for the change of the connection state on Chain A: `INIT -> OPEN` */
  proof_ack: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * MsgConnectionOpenConfirmResponse defines the Msg/ConnectionOpenConfirm
 * response type.
 */
export interface MsgConnectionOpenConfirmResponse {
  unsigned_tx?: Any;
}
function createBaseMsgConnectionOpenInit(): MsgConnectionOpenInit {
  return {
    client_id: "",
    counterparty: Counterparty.fromPartial({}),
    version: undefined,
    delay_period: BigInt(0),
    signer: ""
  };
}
export const MsgConnectionOpenInit = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenInit",
  encode(message: MsgConnectionOpenInit, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.counterparty !== undefined) {
      Counterparty.encode(message.counterparty, writer.uint32(18).fork()).ldelim();
    }
    if (message.version !== undefined) {
      Version.encode(message.version, writer.uint32(26).fork()).ldelim();
    }
    if (message.delay_period !== BigInt(0)) {
      writer.uint32(32).uint64(message.delay_period);
    }
    if (message.signer !== "") {
      writer.uint32(42).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenInit {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenInit();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.counterparty = Counterparty.decode(reader, reader.uint32());
          break;
        case 3:
          message.version = Version.decode(reader, reader.uint32());
          break;
        case 4:
          message.delay_period = reader.uint64();
          break;
        case 5:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgConnectionOpenInit {
    const obj = createBaseMsgConnectionOpenInit();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.counterparty)) obj.counterparty = Counterparty.fromJSON(object.counterparty);
    if (isSet(object.version)) obj.version = Version.fromJSON(object.version);
    if (isSet(object.delay_period)) obj.delay_period = BigInt(object.delay_period.toString());
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgConnectionOpenInit): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.counterparty !== undefined && (obj.counterparty = message.counterparty ? Counterparty.toJSON(message.counterparty) : undefined);
    message.version !== undefined && (obj.version = message.version ? Version.toJSON(message.version) : undefined);
    message.delay_period !== undefined && (obj.delay_period = (message.delay_period || BigInt(0)).toString());
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenInit>, I>>(object: I): MsgConnectionOpenInit {
    const message = createBaseMsgConnectionOpenInit();
    message.client_id = object.client_id ?? "";
    if (object.counterparty !== undefined && object.counterparty !== null) {
      message.counterparty = Counterparty.fromPartial(object.counterparty);
    }
    if (object.version !== undefined && object.version !== null) {
      message.version = Version.fromPartial(object.version);
    }
    if (object.delay_period !== undefined && object.delay_period !== null) {
      message.delay_period = BigInt(object.delay_period.toString());
    }
    message.signer = object.signer ?? "";
    return message;
  }
};
function createBaseMsgConnectionOpenInitResponse(): MsgConnectionOpenInitResponse {
  return {
    unsigned_tx: undefined
  };
}
export const MsgConnectionOpenInitResponse = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenInitResponse",
  encode(message: MsgConnectionOpenInitResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenInitResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenInitResponse();
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
  fromJSON(object: any): MsgConnectionOpenInitResponse {
    const obj = createBaseMsgConnectionOpenInitResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgConnectionOpenInitResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined && (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenInitResponse>, I>>(object: I): MsgConnectionOpenInitResponse {
    const message = createBaseMsgConnectionOpenInitResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  }
};
function createBaseMsgConnectionOpenTry(): MsgConnectionOpenTry {
  return {
    client_id: "",
    previous_connection_id: "",
    client_state: undefined,
    counterparty: Counterparty.fromPartial({}),
    delay_period: BigInt(0),
    counterparty_versions: [],
    proof_height: Height.fromPartial({}),
    proof_init: new Uint8Array(),
    proof_client: new Uint8Array(),
    proof_consensus: new Uint8Array(),
    consensus_height: Height.fromPartial({}),
    signer: "",
    host_consensus_state_proof: new Uint8Array()
  };
}
export const MsgConnectionOpenTry = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenTry",
  encode(message: MsgConnectionOpenTry, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.previous_connection_id !== "") {
      writer.uint32(18).string(message.previous_connection_id);
    }
    if (message.client_state !== undefined) {
      Any.encode(message.client_state, writer.uint32(26).fork()).ldelim();
    }
    if (message.counterparty !== undefined) {
      Counterparty.encode(message.counterparty, writer.uint32(34).fork()).ldelim();
    }
    if (message.delay_period !== BigInt(0)) {
      writer.uint32(40).uint64(message.delay_period);
    }
    for (const v of message.counterparty_versions) {
      Version.encode(v!, writer.uint32(50).fork()).ldelim();
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(58).fork()).ldelim();
    }
    if (message.proof_init.length !== 0) {
      writer.uint32(66).bytes(message.proof_init);
    }
    if (message.proof_client.length !== 0) {
      writer.uint32(74).bytes(message.proof_client);
    }
    if (message.proof_consensus.length !== 0) {
      writer.uint32(82).bytes(message.proof_consensus);
    }
    if (message.consensus_height !== undefined) {
      Height.encode(message.consensus_height, writer.uint32(90).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(98).string(message.signer);
    }
    if (message.host_consensus_state_proof.length !== 0) {
      writer.uint32(106).bytes(message.host_consensus_state_proof);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenTry {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenTry();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.previous_connection_id = reader.string();
          break;
        case 3:
          message.client_state = Any.decode(reader, reader.uint32());
          break;
        case 4:
          message.counterparty = Counterparty.decode(reader, reader.uint32());
          break;
        case 5:
          message.delay_period = reader.uint64();
          break;
        case 6:
          message.counterparty_versions.push(Version.decode(reader, reader.uint32()));
          break;
        case 7:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 8:
          message.proof_init = reader.bytes();
          break;
        case 9:
          message.proof_client = reader.bytes();
          break;
        case 10:
          message.proof_consensus = reader.bytes();
          break;
        case 11:
          message.consensus_height = Height.decode(reader, reader.uint32());
          break;
        case 12:
          message.signer = reader.string();
          break;
        case 13:
          message.host_consensus_state_proof = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgConnectionOpenTry {
    const obj = createBaseMsgConnectionOpenTry();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.previous_connection_id)) obj.previous_connection_id = String(object.previous_connection_id);
    if (isSet(object.client_state)) obj.client_state = Any.fromJSON(object.client_state);
    if (isSet(object.counterparty)) obj.counterparty = Counterparty.fromJSON(object.counterparty);
    if (isSet(object.delay_period)) obj.delay_period = BigInt(object.delay_period.toString());
    if (Array.isArray(object?.counterparty_versions)) obj.counterparty_versions = object.counterparty_versions.map((e: any) => Version.fromJSON(e));
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.proof_init)) obj.proof_init = bytesFromBase64(object.proof_init);
    if (isSet(object.proof_client)) obj.proof_client = bytesFromBase64(object.proof_client);
    if (isSet(object.proof_consensus)) obj.proof_consensus = bytesFromBase64(object.proof_consensus);
    if (isSet(object.consensus_height)) obj.consensus_height = Height.fromJSON(object.consensus_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.host_consensus_state_proof)) obj.host_consensus_state_proof = bytesFromBase64(object.host_consensus_state_proof);
    return obj;
  },
  toJSON(message: MsgConnectionOpenTry): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.previous_connection_id !== undefined && (obj.previous_connection_id = message.previous_connection_id);
    message.client_state !== undefined && (obj.client_state = message.client_state ? Any.toJSON(message.client_state) : undefined);
    message.counterparty !== undefined && (obj.counterparty = message.counterparty ? Counterparty.toJSON(message.counterparty) : undefined);
    message.delay_period !== undefined && (obj.delay_period = (message.delay_period || BigInt(0)).toString());
    if (message.counterparty_versions) {
      obj.counterparty_versions = message.counterparty_versions.map(e => e ? Version.toJSON(e) : undefined);
    } else {
      obj.counterparty_versions = [];
    }
    message.proof_height !== undefined && (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.proof_init !== undefined && (obj.proof_init = base64FromBytes(message.proof_init !== undefined ? message.proof_init : new Uint8Array()));
    message.proof_client !== undefined && (obj.proof_client = base64FromBytes(message.proof_client !== undefined ? message.proof_client : new Uint8Array()));
    message.proof_consensus !== undefined && (obj.proof_consensus = base64FromBytes(message.proof_consensus !== undefined ? message.proof_consensus : new Uint8Array()));
    message.consensus_height !== undefined && (obj.consensus_height = message.consensus_height ? Height.toJSON(message.consensus_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    message.host_consensus_state_proof !== undefined && (obj.host_consensus_state_proof = base64FromBytes(message.host_consensus_state_proof !== undefined ? message.host_consensus_state_proof : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenTry>, I>>(object: I): MsgConnectionOpenTry {
    const message = createBaseMsgConnectionOpenTry();
    message.client_id = object.client_id ?? "";
    message.previous_connection_id = object.previous_connection_id ?? "";
    if (object.client_state !== undefined && object.client_state !== null) {
      message.client_state = Any.fromPartial(object.client_state);
    }
    if (object.counterparty !== undefined && object.counterparty !== null) {
      message.counterparty = Counterparty.fromPartial(object.counterparty);
    }
    if (object.delay_period !== undefined && object.delay_period !== null) {
      message.delay_period = BigInt(object.delay_period.toString());
    }
    message.counterparty_versions = object.counterparty_versions?.map(e => Version.fromPartial(e)) || [];
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.proof_init = object.proof_init ?? new Uint8Array();
    message.proof_client = object.proof_client ?? new Uint8Array();
    message.proof_consensus = object.proof_consensus ?? new Uint8Array();
    if (object.consensus_height !== undefined && object.consensus_height !== null) {
      message.consensus_height = Height.fromPartial(object.consensus_height);
    }
    message.signer = object.signer ?? "";
    message.host_consensus_state_proof = object.host_consensus_state_proof ?? new Uint8Array();
    return message;
  }
};
function createBaseMsgConnectionOpenTryResponse(): MsgConnectionOpenTryResponse {
  return {
    unsigned_tx: undefined
  };
}
export const MsgConnectionOpenTryResponse = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenTryResponse",
  encode(message: MsgConnectionOpenTryResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenTryResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenTryResponse();
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
  fromJSON(object: any): MsgConnectionOpenTryResponse {
    const obj = createBaseMsgConnectionOpenTryResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgConnectionOpenTryResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined && (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenTryResponse>, I>>(object: I): MsgConnectionOpenTryResponse {
    const message = createBaseMsgConnectionOpenTryResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  }
};
function createBaseMsgConnectionOpenAck(): MsgConnectionOpenAck {
  return {
    connection_id: "",
    counterparty_connection_id: "",
    version: undefined,
    client_state: undefined,
    proof_height: Height.fromPartial({}),
    proof_try: new Uint8Array(),
    proof_client: new Uint8Array(),
    proof_consensus: new Uint8Array(),
    consensus_height: Height.fromPartial({}),
    signer: "",
    host_consensus_state_proof: new Uint8Array()
  };
}
export const MsgConnectionOpenAck = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenAck",
  encode(message: MsgConnectionOpenAck, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.connection_id !== "") {
      writer.uint32(10).string(message.connection_id);
    }
    if (message.counterparty_connection_id !== "") {
      writer.uint32(18).string(message.counterparty_connection_id);
    }
    if (message.version !== undefined) {
      Version.encode(message.version, writer.uint32(26).fork()).ldelim();
    }
    if (message.client_state !== undefined) {
      Any.encode(message.client_state, writer.uint32(34).fork()).ldelim();
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(42).fork()).ldelim();
    }
    if (message.proof_try.length !== 0) {
      writer.uint32(50).bytes(message.proof_try);
    }
    if (message.proof_client.length !== 0) {
      writer.uint32(58).bytes(message.proof_client);
    }
    if (message.proof_consensus.length !== 0) {
      writer.uint32(66).bytes(message.proof_consensus);
    }
    if (message.consensus_height !== undefined) {
      Height.encode(message.consensus_height, writer.uint32(74).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(82).string(message.signer);
    }
    if (message.host_consensus_state_proof.length !== 0) {
      writer.uint32(90).bytes(message.host_consensus_state_proof);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenAck {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenAck();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.connection_id = reader.string();
          break;
        case 2:
          message.counterparty_connection_id = reader.string();
          break;
        case 3:
          message.version = Version.decode(reader, reader.uint32());
          break;
        case 4:
          message.client_state = Any.decode(reader, reader.uint32());
          break;
        case 5:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 6:
          message.proof_try = reader.bytes();
          break;
        case 7:
          message.proof_client = reader.bytes();
          break;
        case 8:
          message.proof_consensus = reader.bytes();
          break;
        case 9:
          message.consensus_height = Height.decode(reader, reader.uint32());
          break;
        case 10:
          message.signer = reader.string();
          break;
        case 11:
          message.host_consensus_state_proof = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgConnectionOpenAck {
    const obj = createBaseMsgConnectionOpenAck();
    if (isSet(object.connection_id)) obj.connection_id = String(object.connection_id);
    if (isSet(object.counterparty_connection_id)) obj.counterparty_connection_id = String(object.counterparty_connection_id);
    if (isSet(object.version)) obj.version = Version.fromJSON(object.version);
    if (isSet(object.client_state)) obj.client_state = Any.fromJSON(object.client_state);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.proof_try)) obj.proof_try = bytesFromBase64(object.proof_try);
    if (isSet(object.proof_client)) obj.proof_client = bytesFromBase64(object.proof_client);
    if (isSet(object.proof_consensus)) obj.proof_consensus = bytesFromBase64(object.proof_consensus);
    if (isSet(object.consensus_height)) obj.consensus_height = Height.fromJSON(object.consensus_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.host_consensus_state_proof)) obj.host_consensus_state_proof = bytesFromBase64(object.host_consensus_state_proof);
    return obj;
  },
  toJSON(message: MsgConnectionOpenAck): unknown {
    const obj: any = {};
    message.connection_id !== undefined && (obj.connection_id = message.connection_id);
    message.counterparty_connection_id !== undefined && (obj.counterparty_connection_id = message.counterparty_connection_id);
    message.version !== undefined && (obj.version = message.version ? Version.toJSON(message.version) : undefined);
    message.client_state !== undefined && (obj.client_state = message.client_state ? Any.toJSON(message.client_state) : undefined);
    message.proof_height !== undefined && (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.proof_try !== undefined && (obj.proof_try = base64FromBytes(message.proof_try !== undefined ? message.proof_try : new Uint8Array()));
    message.proof_client !== undefined && (obj.proof_client = base64FromBytes(message.proof_client !== undefined ? message.proof_client : new Uint8Array()));
    message.proof_consensus !== undefined && (obj.proof_consensus = base64FromBytes(message.proof_consensus !== undefined ? message.proof_consensus : new Uint8Array()));
    message.consensus_height !== undefined && (obj.consensus_height = message.consensus_height ? Height.toJSON(message.consensus_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    message.host_consensus_state_proof !== undefined && (obj.host_consensus_state_proof = base64FromBytes(message.host_consensus_state_proof !== undefined ? message.host_consensus_state_proof : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenAck>, I>>(object: I): MsgConnectionOpenAck {
    const message = createBaseMsgConnectionOpenAck();
    message.connection_id = object.connection_id ?? "";
    message.counterparty_connection_id = object.counterparty_connection_id ?? "";
    if (object.version !== undefined && object.version !== null) {
      message.version = Version.fromPartial(object.version);
    }
    if (object.client_state !== undefined && object.client_state !== null) {
      message.client_state = Any.fromPartial(object.client_state);
    }
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.proof_try = object.proof_try ?? new Uint8Array();
    message.proof_client = object.proof_client ?? new Uint8Array();
    message.proof_consensus = object.proof_consensus ?? new Uint8Array();
    if (object.consensus_height !== undefined && object.consensus_height !== null) {
      message.consensus_height = Height.fromPartial(object.consensus_height);
    }
    message.signer = object.signer ?? "";
    message.host_consensus_state_proof = object.host_consensus_state_proof ?? new Uint8Array();
    return message;
  }
};
function createBaseMsgConnectionOpenAckResponse(): MsgConnectionOpenAckResponse {
  return {
    unsigned_tx: undefined
  };
}
export const MsgConnectionOpenAckResponse = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenAckResponse",
  encode(message: MsgConnectionOpenAckResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenAckResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenAckResponse();
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
  fromJSON(object: any): MsgConnectionOpenAckResponse {
    const obj = createBaseMsgConnectionOpenAckResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgConnectionOpenAckResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined && (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenAckResponse>, I>>(object: I): MsgConnectionOpenAckResponse {
    const message = createBaseMsgConnectionOpenAckResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  }
};
function createBaseMsgConnectionOpenConfirm(): MsgConnectionOpenConfirm {
  return {
    connection_id: "",
    proof_ack: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: ""
  };
}
export const MsgConnectionOpenConfirm = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenConfirm",
  encode(message: MsgConnectionOpenConfirm, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.connection_id !== "") {
      writer.uint32(10).string(message.connection_id);
    }
    if (message.proof_ack.length !== 0) {
      writer.uint32(18).bytes(message.proof_ack);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(34).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenConfirm {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenConfirm();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.connection_id = reader.string();
          break;
        case 2:
          message.proof_ack = reader.bytes();
          break;
        case 3:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 4:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgConnectionOpenConfirm {
    const obj = createBaseMsgConnectionOpenConfirm();
    if (isSet(object.connection_id)) obj.connection_id = String(object.connection_id);
    if (isSet(object.proof_ack)) obj.proof_ack = bytesFromBase64(object.proof_ack);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgConnectionOpenConfirm): unknown {
    const obj: any = {};
    message.connection_id !== undefined && (obj.connection_id = message.connection_id);
    message.proof_ack !== undefined && (obj.proof_ack = base64FromBytes(message.proof_ack !== undefined ? message.proof_ack : new Uint8Array()));
    message.proof_height !== undefined && (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenConfirm>, I>>(object: I): MsgConnectionOpenConfirm {
    const message = createBaseMsgConnectionOpenConfirm();
    message.connection_id = object.connection_id ?? "";
    message.proof_ack = object.proof_ack ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  }
};
function createBaseMsgConnectionOpenConfirmResponse(): MsgConnectionOpenConfirmResponse {
  return {
    unsigned_tx: undefined
  };
}
export const MsgConnectionOpenConfirmResponse = {
  typeUrl: "/ibc.core.connection.v1.MsgConnectionOpenConfirmResponse",
  encode(message: MsgConnectionOpenConfirmResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConnectionOpenConfirmResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConnectionOpenConfirmResponse();
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
  fromJSON(object: any): MsgConnectionOpenConfirmResponse {
    const obj = createBaseMsgConnectionOpenConfirmResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgConnectionOpenConfirmResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined && (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConnectionOpenConfirmResponse>, I>>(object: I): MsgConnectionOpenConfirmResponse {
    const message = createBaseMsgConnectionOpenConfirmResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  }
};
/** Msg defines the ibc/connection Msg service. */
export interface Msg {
  /** ConnectionOpenInit defines a rpc handler method for MsgConnectionOpenInit. */
  ConnectionOpenInit(request: MsgConnectionOpenInit): Promise<MsgConnectionOpenInitResponse>;
  /** ConnectionOpenTry defines a rpc handler method for MsgConnectionOpenTry. */
  ConnectionOpenTry(request: MsgConnectionOpenTry): Promise<MsgConnectionOpenTryResponse>;
  /** ConnectionOpenAck defines a rpc handler method for MsgConnectionOpenAck. */
  ConnectionOpenAck(request: MsgConnectionOpenAck): Promise<MsgConnectionOpenAckResponse>;
  /**
   * ConnectionOpenConfirm defines a rpc handler method for
   * MsgConnectionOpenConfirm.
   */
  ConnectionOpenConfirm(request: MsgConnectionOpenConfirm): Promise<MsgConnectionOpenConfirmResponse>;
}
export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.ConnectionOpenInit = this.ConnectionOpenInit.bind(this);
    this.ConnectionOpenTry = this.ConnectionOpenTry.bind(this);
    this.ConnectionOpenAck = this.ConnectionOpenAck.bind(this);
    this.ConnectionOpenConfirm = this.ConnectionOpenConfirm.bind(this);
  }
  ConnectionOpenInit(request: MsgConnectionOpenInit): Promise<MsgConnectionOpenInitResponse> {
    const data = MsgConnectionOpenInit.encode(request).finish();
    const promise = this.rpc.request("ibc.core.connection.v1.Msg", "ConnectionOpenInit", data);
    return promise.then(data => MsgConnectionOpenInitResponse.decode(new BinaryReader(data)));
  }
  ConnectionOpenTry(request: MsgConnectionOpenTry): Promise<MsgConnectionOpenTryResponse> {
    const data = MsgConnectionOpenTry.encode(request).finish();
    const promise = this.rpc.request("ibc.core.connection.v1.Msg", "ConnectionOpenTry", data);
    return promise.then(data => MsgConnectionOpenTryResponse.decode(new BinaryReader(data)));
  }
  ConnectionOpenAck(request: MsgConnectionOpenAck): Promise<MsgConnectionOpenAckResponse> {
    const data = MsgConnectionOpenAck.encode(request).finish();
    const promise = this.rpc.request("ibc.core.connection.v1.Msg", "ConnectionOpenAck", data);
    return promise.then(data => MsgConnectionOpenAckResponse.decode(new BinaryReader(data)));
  }
  ConnectionOpenConfirm(request: MsgConnectionOpenConfirm): Promise<MsgConnectionOpenConfirmResponse> {
    const data = MsgConnectionOpenConfirm.encode(request).finish();
    const promise = this.rpc.request("ibc.core.connection.v1.Msg", "ConnectionOpenConfirm", data);
    return promise.then(data => MsgConnectionOpenConfirmResponse.decode(new BinaryReader(data)));
  }
}