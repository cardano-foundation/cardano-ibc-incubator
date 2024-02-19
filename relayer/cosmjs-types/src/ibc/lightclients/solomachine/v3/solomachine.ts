/* eslint-disable */
import { Any } from "../../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../../helpers";
export const protobufPackage = "ibc.lightclients.solomachine.v3";
/**
 * ClientState defines a solo machine client that tracks the current consensus
 * state and if the client is frozen.
 */
export interface ClientState {
  /** latest sequence of the client state */
  sequence: bigint;
  /** frozen sequence of the solo machine */
  is_frozen: boolean;
  consensus_state?: ConsensusState;
}
/**
 * ConsensusState defines a solo machine consensus state. The sequence of a
 * consensus state is contained in the "height" key used in storing the
 * consensus state.
 */
export interface ConsensusState {
  /** public key of the solo machine */
  public_key?: Any;
  /**
   * diversifier allows the same public key to be re-used across different solo
   * machine clients (potentially on different chains) without being considered
   * misbehaviour.
   */
  diversifier: string;
  timestamp: bigint;
}
/** Header defines a solo machine consensus header */
export interface Header {
  timestamp: bigint;
  signature: Uint8Array;
  new_public_key?: Any;
  new_diversifier: string;
}
/**
 * Misbehaviour defines misbehaviour for a solo machine which consists
 * of a sequence and two signatures over different messages at that sequence.
 */
export interface Misbehaviour {
  sequence: bigint;
  signature_one?: SignatureAndData;
  signature_two?: SignatureAndData;
}
/**
 * SignatureAndData contains a signature and the data signed over to create that
 * signature.
 */
export interface SignatureAndData {
  signature: Uint8Array;
  path: Uint8Array;
  data: Uint8Array;
  timestamp: bigint;
}
/**
 * TimestampedSignatureData contains the signature data and the timestamp of the
 * signature.
 */
export interface TimestampedSignatureData {
  signature_data: Uint8Array;
  timestamp: bigint;
}
/** SignBytes defines the signed bytes used for signature verification. */
export interface SignBytes {
  /** the sequence number */
  sequence: bigint;
  /** the proof timestamp */
  timestamp: bigint;
  /** the public key diversifier */
  diversifier: string;
  /** the standardised path bytes */
  path: Uint8Array;
  /** the marshaled data bytes */
  data: Uint8Array;
}
/** HeaderData returns the SignBytes data for update verification. */
export interface HeaderData {
  /** header public key */
  new_pub_key?: Any;
  /** header diversifier */
  new_diversifier: string;
}
function createBaseClientState(): ClientState {
  return {
    sequence: BigInt(0),
    is_frozen: false,
    consensus_state: undefined,
  };
}
export const ClientState = {
  typeUrl: "/ibc.lightclients.solomachine.v3.ClientState",
  encode(message: ClientState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.sequence !== BigInt(0)) {
      writer.uint32(8).uint64(message.sequence);
    }
    if (message.is_frozen === true) {
      writer.uint32(16).bool(message.is_frozen);
    }
    if (message.consensus_state !== undefined) {
      ConsensusState.encode(message.consensus_state, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ClientState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseClientState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sequence = reader.uint64();
          break;
        case 2:
          message.is_frozen = reader.bool();
          break;
        case 3:
          message.consensus_state = ConsensusState.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ClientState {
    const obj = createBaseClientState();
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.is_frozen)) obj.is_frozen = Boolean(object.is_frozen);
    if (isSet(object.consensus_state)) obj.consensus_state = ConsensusState.fromJSON(object.consensus_state);
    return obj;
  },
  toJSON(message: ClientState): unknown {
    const obj: any = {};
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.is_frozen !== undefined && (obj.is_frozen = message.is_frozen);
    message.consensus_state !== undefined &&
      (obj.consensus_state = message.consensus_state
        ? ConsensusState.toJSON(message.consensus_state)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ClientState>, I>>(object: I): ClientState {
    const message = createBaseClientState();
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    message.is_frozen = object.is_frozen ?? false;
    if (object.consensus_state !== undefined && object.consensus_state !== null) {
      message.consensus_state = ConsensusState.fromPartial(object.consensus_state);
    }
    return message;
  },
};
function createBaseConsensusState(): ConsensusState {
  return {
    public_key: undefined,
    diversifier: "",
    timestamp: BigInt(0),
  };
}
export const ConsensusState = {
  typeUrl: "/ibc.lightclients.solomachine.v3.ConsensusState",
  encode(message: ConsensusState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.public_key !== undefined) {
      Any.encode(message.public_key, writer.uint32(10).fork()).ldelim();
    }
    if (message.diversifier !== "") {
      writer.uint32(18).string(message.diversifier);
    }
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(24).uint64(message.timestamp);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ConsensusState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseConsensusState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.public_key = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.diversifier = reader.string();
          break;
        case 3:
          message.timestamp = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ConsensusState {
    const obj = createBaseConsensusState();
    if (isSet(object.public_key)) obj.public_key = Any.fromJSON(object.public_key);
    if (isSet(object.diversifier)) obj.diversifier = String(object.diversifier);
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    return obj;
  },
  toJSON(message: ConsensusState): unknown {
    const obj: any = {};
    message.public_key !== undefined &&
      (obj.public_key = message.public_key ? Any.toJSON(message.public_key) : undefined);
    message.diversifier !== undefined && (obj.diversifier = message.diversifier);
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ConsensusState>, I>>(object: I): ConsensusState {
    const message = createBaseConsensusState();
    if (object.public_key !== undefined && object.public_key !== null) {
      message.public_key = Any.fromPartial(object.public_key);
    }
    message.diversifier = object.diversifier ?? "";
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    return message;
  },
};
function createBaseHeader(): Header {
  return {
    timestamp: BigInt(0),
    signature: new Uint8Array(),
    new_public_key: undefined,
    new_diversifier: "",
  };
}
export const Header = {
  typeUrl: "/ibc.lightclients.solomachine.v3.Header",
  encode(message: Header, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(8).uint64(message.timestamp);
    }
    if (message.signature.length !== 0) {
      writer.uint32(18).bytes(message.signature);
    }
    if (message.new_public_key !== undefined) {
      Any.encode(message.new_public_key, writer.uint32(26).fork()).ldelim();
    }
    if (message.new_diversifier !== "") {
      writer.uint32(34).string(message.new_diversifier);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Header {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.timestamp = reader.uint64();
          break;
        case 2:
          message.signature = reader.bytes();
          break;
        case 3:
          message.new_public_key = Any.decode(reader, reader.uint32());
          break;
        case 4:
          message.new_diversifier = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Header {
    const obj = createBaseHeader();
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    if (isSet(object.signature)) obj.signature = bytesFromBase64(object.signature);
    if (isSet(object.new_public_key)) obj.new_public_key = Any.fromJSON(object.new_public_key);
    if (isSet(object.new_diversifier)) obj.new_diversifier = String(object.new_diversifier);
    return obj;
  },
  toJSON(message: Header): unknown {
    const obj: any = {};
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.signature !== undefined &&
      (obj.signature = base64FromBytes(
        message.signature !== undefined ? message.signature : new Uint8Array(),
      ));
    message.new_public_key !== undefined &&
      (obj.new_public_key = message.new_public_key ? Any.toJSON(message.new_public_key) : undefined);
    message.new_diversifier !== undefined && (obj.new_diversifier = message.new_diversifier);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Header>, I>>(object: I): Header {
    const message = createBaseHeader();
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    message.signature = object.signature ?? new Uint8Array();
    if (object.new_public_key !== undefined && object.new_public_key !== null) {
      message.new_public_key = Any.fromPartial(object.new_public_key);
    }
    message.new_diversifier = object.new_diversifier ?? "";
    return message;
  },
};
function createBaseMisbehaviour(): Misbehaviour {
  return {
    sequence: BigInt(0),
    signature_one: undefined,
    signature_two: undefined,
  };
}
export const Misbehaviour = {
  typeUrl: "/ibc.lightclients.solomachine.v3.Misbehaviour",
  encode(message: Misbehaviour, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.sequence !== BigInt(0)) {
      writer.uint32(8).uint64(message.sequence);
    }
    if (message.signature_one !== undefined) {
      SignatureAndData.encode(message.signature_one, writer.uint32(18).fork()).ldelim();
    }
    if (message.signature_two !== undefined) {
      SignatureAndData.encode(message.signature_two, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Misbehaviour {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMisbehaviour();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sequence = reader.uint64();
          break;
        case 2:
          message.signature_one = SignatureAndData.decode(reader, reader.uint32());
          break;
        case 3:
          message.signature_two = SignatureAndData.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Misbehaviour {
    const obj = createBaseMisbehaviour();
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.signature_one)) obj.signature_one = SignatureAndData.fromJSON(object.signature_one);
    if (isSet(object.signature_two)) obj.signature_two = SignatureAndData.fromJSON(object.signature_two);
    return obj;
  },
  toJSON(message: Misbehaviour): unknown {
    const obj: any = {};
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.signature_one !== undefined &&
      (obj.signature_one = message.signature_one
        ? SignatureAndData.toJSON(message.signature_one)
        : undefined);
    message.signature_two !== undefined &&
      (obj.signature_two = message.signature_two
        ? SignatureAndData.toJSON(message.signature_two)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Misbehaviour>, I>>(object: I): Misbehaviour {
    const message = createBaseMisbehaviour();
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    if (object.signature_one !== undefined && object.signature_one !== null) {
      message.signature_one = SignatureAndData.fromPartial(object.signature_one);
    }
    if (object.signature_two !== undefined && object.signature_two !== null) {
      message.signature_two = SignatureAndData.fromPartial(object.signature_two);
    }
    return message;
  },
};
function createBaseSignatureAndData(): SignatureAndData {
  return {
    signature: new Uint8Array(),
    path: new Uint8Array(),
    data: new Uint8Array(),
    timestamp: BigInt(0),
  };
}
export const SignatureAndData = {
  typeUrl: "/ibc.lightclients.solomachine.v3.SignatureAndData",
  encode(message: SignatureAndData, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signature.length !== 0) {
      writer.uint32(10).bytes(message.signature);
    }
    if (message.path.length !== 0) {
      writer.uint32(18).bytes(message.path);
    }
    if (message.data.length !== 0) {
      writer.uint32(26).bytes(message.data);
    }
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(32).uint64(message.timestamp);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SignatureAndData {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSignatureAndData();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signature = reader.bytes();
          break;
        case 2:
          message.path = reader.bytes();
          break;
        case 3:
          message.data = reader.bytes();
          break;
        case 4:
          message.timestamp = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SignatureAndData {
    const obj = createBaseSignatureAndData();
    if (isSet(object.signature)) obj.signature = bytesFromBase64(object.signature);
    if (isSet(object.path)) obj.path = bytesFromBase64(object.path);
    if (isSet(object.data)) obj.data = bytesFromBase64(object.data);
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    return obj;
  },
  toJSON(message: SignatureAndData): unknown {
    const obj: any = {};
    message.signature !== undefined &&
      (obj.signature = base64FromBytes(
        message.signature !== undefined ? message.signature : new Uint8Array(),
      ));
    message.path !== undefined &&
      (obj.path = base64FromBytes(message.path !== undefined ? message.path : new Uint8Array()));
    message.data !== undefined &&
      (obj.data = base64FromBytes(message.data !== undefined ? message.data : new Uint8Array()));
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SignatureAndData>, I>>(object: I): SignatureAndData {
    const message = createBaseSignatureAndData();
    message.signature = object.signature ?? new Uint8Array();
    message.path = object.path ?? new Uint8Array();
    message.data = object.data ?? new Uint8Array();
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    return message;
  },
};
function createBaseTimestampedSignatureData(): TimestampedSignatureData {
  return {
    signature_data: new Uint8Array(),
    timestamp: BigInt(0),
  };
}
export const TimestampedSignatureData = {
  typeUrl: "/ibc.lightclients.solomachine.v3.TimestampedSignatureData",
  encode(message: TimestampedSignatureData, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signature_data.length !== 0) {
      writer.uint32(10).bytes(message.signature_data);
    }
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(16).uint64(message.timestamp);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): TimestampedSignatureData {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTimestampedSignatureData();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signature_data = reader.bytes();
          break;
        case 2:
          message.timestamp = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): TimestampedSignatureData {
    const obj = createBaseTimestampedSignatureData();
    if (isSet(object.signature_data)) obj.signature_data = bytesFromBase64(object.signature_data);
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    return obj;
  },
  toJSON(message: TimestampedSignatureData): unknown {
    const obj: any = {};
    message.signature_data !== undefined &&
      (obj.signature_data = base64FromBytes(
        message.signature_data !== undefined ? message.signature_data : new Uint8Array(),
      ));
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<TimestampedSignatureData>, I>>(
    object: I,
  ): TimestampedSignatureData {
    const message = createBaseTimestampedSignatureData();
    message.signature_data = object.signature_data ?? new Uint8Array();
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    return message;
  },
};
function createBaseSignBytes(): SignBytes {
  return {
    sequence: BigInt(0),
    timestamp: BigInt(0),
    diversifier: "",
    path: new Uint8Array(),
    data: new Uint8Array(),
  };
}
export const SignBytes = {
  typeUrl: "/ibc.lightclients.solomachine.v3.SignBytes",
  encode(message: SignBytes, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.sequence !== BigInt(0)) {
      writer.uint32(8).uint64(message.sequence);
    }
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(16).uint64(message.timestamp);
    }
    if (message.diversifier !== "") {
      writer.uint32(26).string(message.diversifier);
    }
    if (message.path.length !== 0) {
      writer.uint32(34).bytes(message.path);
    }
    if (message.data.length !== 0) {
      writer.uint32(42).bytes(message.data);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SignBytes {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSignBytes();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sequence = reader.uint64();
          break;
        case 2:
          message.timestamp = reader.uint64();
          break;
        case 3:
          message.diversifier = reader.string();
          break;
        case 4:
          message.path = reader.bytes();
          break;
        case 5:
          message.data = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SignBytes {
    const obj = createBaseSignBytes();
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    if (isSet(object.diversifier)) obj.diversifier = String(object.diversifier);
    if (isSet(object.path)) obj.path = bytesFromBase64(object.path);
    if (isSet(object.data)) obj.data = bytesFromBase64(object.data);
    return obj;
  },
  toJSON(message: SignBytes): unknown {
    const obj: any = {};
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.diversifier !== undefined && (obj.diversifier = message.diversifier);
    message.path !== undefined &&
      (obj.path = base64FromBytes(message.path !== undefined ? message.path : new Uint8Array()));
    message.data !== undefined &&
      (obj.data = base64FromBytes(message.data !== undefined ? message.data : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SignBytes>, I>>(object: I): SignBytes {
    const message = createBaseSignBytes();
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    message.diversifier = object.diversifier ?? "";
    message.path = object.path ?? new Uint8Array();
    message.data = object.data ?? new Uint8Array();
    return message;
  },
};
function createBaseHeaderData(): HeaderData {
  return {
    new_pub_key: undefined,
    new_diversifier: "",
  };
}
export const HeaderData = {
  typeUrl: "/ibc.lightclients.solomachine.v3.HeaderData",
  encode(message: HeaderData, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.new_pub_key !== undefined) {
      Any.encode(message.new_pub_key, writer.uint32(10).fork()).ldelim();
    }
    if (message.new_diversifier !== "") {
      writer.uint32(18).string(message.new_diversifier);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): HeaderData {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHeaderData();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.new_pub_key = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.new_diversifier = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): HeaderData {
    const obj = createBaseHeaderData();
    if (isSet(object.new_pub_key)) obj.new_pub_key = Any.fromJSON(object.new_pub_key);
    if (isSet(object.new_diversifier)) obj.new_diversifier = String(object.new_diversifier);
    return obj;
  },
  toJSON(message: HeaderData): unknown {
    const obj: any = {};
    message.new_pub_key !== undefined &&
      (obj.new_pub_key = message.new_pub_key ? Any.toJSON(message.new_pub_key) : undefined);
    message.new_diversifier !== undefined && (obj.new_diversifier = message.new_diversifier);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<HeaderData>, I>>(object: I): HeaderData {
    const message = createBaseHeaderData();
    if (object.new_pub_key !== undefined && object.new_pub_key !== null) {
      message.new_pub_key = Any.fromPartial(object.new_pub_key);
    }
    message.new_diversifier = object.new_diversifier ?? "";
    return message;
  },
};
