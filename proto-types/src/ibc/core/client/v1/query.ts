/* eslint-disable */
import { PageRequest, PageResponse } from "../../../../cosmos/base/query/v1beta1/pagination";
import { Any } from "../../../../google/protobuf/any";
import { Height, IdentifiedClientState, ConsensusStateWithHeight, Params } from "./client";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { DeepPartial, Exact, isSet, bytesFromBase64, base64FromBytes, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.core.client.v1";
export interface QueryLatestHeightRequest {}
export interface QueryLatestHeightResponse {
  height: bigint;
}
/**
 * QueryClientStateRequest is the request type for the Query/ClientState RPC
 * method
 */
export interface QueryClientStateRequest {
  /** client state unique identifier */
  client_id: string;
}
/**
 * QueryClientStateResponse is the response type for the Query/ClientState RPC
 * method. Besides the client state, it includes a proof and the height from
 * which the proof was retrieved.
 */
export interface QueryClientStateResponse {
  /** client state associated with the request identifier */
  client_state?: Any;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/**
 * QueryClientStatesRequest is the request type for the Query/ClientStates RPC
 * method
 */
export interface QueryClientStatesRequest {
  /** pagination request */
  pagination?: PageRequest;
}
/**
 * QueryClientStatesResponse is the response type for the Query/ClientStates RPC
 * method.
 */
export interface QueryClientStatesResponse {
  /** list of stored ClientStates of the chain. */
  client_states: IdentifiedClientState[];
  /** pagination response */
  pagination?: PageResponse;
}
/**
 * QueryConsensusStateRequest is the request type for the Query/ConsensusState
 * RPC method. Besides the consensus state, it includes a proof and the height
 * from which the proof was retrieved.
 */
export interface QueryConsensusStateRequest {
  /** client identifier */
  client_id: string;
  /** consensus state revision number */
  revision_number: bigint;
  /** consensus state revision height */
  revision_height: bigint;
  /** latest_height overrides the height fields and queries the latest stored ConsensusState */
  latest_height: boolean;
}
/**
 * QueryConsensusStateResponse is the response type for the Query/ConsensusState
 * RPC method
 */
export interface QueryConsensusStateResponse {
  /** consensus state associated with the client identifier at the given height */
  consensus_state?: Any;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/**
 * QueryConsensusStatesRequest is the request type for the Query/ConsensusStates
 * RPC method.
 */
export interface QueryConsensusStatesRequest {
  /** client identifier */
  client_id: string;
  /** pagination request */
  pagination?: PageRequest;
}
/**
 * QueryConsensusStatesResponse is the response type for the
 * Query/ConsensusStates RPC method
 */
export interface QueryConsensusStatesResponse {
  /** consensus states associated with the identifier */
  consensus_states: ConsensusStateWithHeight[];
  /** pagination response */
  pagination?: PageResponse;
}
/**
 * QueryConsensusStateHeightsRequest is the request type for Query/ConsensusStateHeights
 * RPC method.
 */
export interface QueryConsensusStateHeightsRequest {
  /** client identifier */
  client_id: string;
  /** pagination request */
  pagination?: PageRequest;
}
/**
 * QueryConsensusStateHeightsResponse is the response type for the
 * Query/ConsensusStateHeights RPC method
 */
export interface QueryConsensusStateHeightsResponse {
  /** consensus state heights */
  consensus_state_heights: Height[];
  /** pagination response */
  pagination?: PageResponse;
}
/**
 * QueryClientStatusRequest is the request type for the Query/ClientStatus RPC
 * method
 */
export interface QueryClientStatusRequest {
  /** client unique identifier */
  client_id: string;
}
/**
 * QueryClientStatusResponse is the response type for the Query/ClientStatus RPC
 * method. It returns the current status of the IBC client.
 */
export interface QueryClientStatusResponse {
  status: string;
}
/**
 * QueryClientParamsRequest is the request type for the Query/ClientParams RPC
 * method.
 */
export interface QueryClientParamsRequest {}
/**
 * QueryClientParamsResponse is the response type for the Query/ClientParams RPC
 * method.
 */
export interface QueryClientParamsResponse {
  /** params defines the parameters of the module. */
  params?: Params;
}
/**
 * QueryUpgradedClientStateRequest is the request type for the
 * Query/UpgradedClientState RPC method
 */
export interface QueryUpgradedClientStateRequest {}
/**
 * QueryUpgradedClientStateResponse is the response type for the
 * Query/UpgradedClientState RPC method.
 */
export interface QueryUpgradedClientStateResponse {
  /** client state associated with the request identifier */
  upgraded_client_state?: Any;
}
/**
 * QueryUpgradedConsensusStateRequest is the request type for the
 * Query/UpgradedConsensusState RPC method
 */
export interface QueryUpgradedConsensusStateRequest {}
/**
 * QueryUpgradedConsensusStateResponse is the response type for the
 * Query/UpgradedConsensusState RPC method.
 */
export interface QueryUpgradedConsensusStateResponse {
  /** Consensus state associated with the request identifier */
  upgraded_consensus_state?: Any;
}
export interface QueryNewClientRequest {
  /** Block number to query */
  height: bigint;
}
export interface QueryNewClientResponse {
  /** client state associated with the request identifier */
  client_state?: Any;
  /** consensus state associated with the request identifier */
  consensus_state?: Any;
}
export interface QueryBlockDataRequest {
  /** Block number to query */
  height: bigint;
}
export interface QueryBlockDataResponse {
  /** block data associated with the request identifier */
  block_data?: Any;
}
function createBaseQueryLatestHeightRequest(): QueryLatestHeightRequest {
  return {};
}
export const QueryLatestHeightRequest = {
  typeUrl: "/ibc.core.client.v1.QueryLatestHeightRequest",
  encode(_: QueryLatestHeightRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryLatestHeightRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryLatestHeightRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(_: any): QueryLatestHeightRequest {
    const obj = createBaseQueryLatestHeightRequest();
    return obj;
  },
  toJSON(_: QueryLatestHeightRequest): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryLatestHeightRequest>, I>>(_: I): QueryLatestHeightRequest {
    const message = createBaseQueryLatestHeightRequest();
    return message;
  },
};
function createBaseQueryLatestHeightResponse(): QueryLatestHeightResponse {
  return {
    height: BigInt(0),
  };
}
export const QueryLatestHeightResponse = {
  typeUrl: "/ibc.core.client.v1.QueryLatestHeightResponse",
  encode(message: QueryLatestHeightResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== BigInt(0)) {
      writer.uint32(8).uint64(message.height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryLatestHeightResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryLatestHeightResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryLatestHeightResponse {
    const obj = createBaseQueryLatestHeightResponse();
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    return obj;
  },
  toJSON(message: QueryLatestHeightResponse): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryLatestHeightResponse>, I>>(
    object: I,
  ): QueryLatestHeightResponse {
    const message = createBaseQueryLatestHeightResponse();
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    return message;
  },
};
function createBaseQueryClientStateRequest(): QueryClientStateRequest {
  return {
    client_id: "",
  };
}
export const QueryClientStateRequest = {
  typeUrl: "/ibc.core.client.v1.QueryClientStateRequest",
  encode(message: QueryClientStateRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientStateRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientStateRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryClientStateRequest {
    const obj = createBaseQueryClientStateRequest();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    return obj;
  },
  toJSON(message: QueryClientStateRequest): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientStateRequest>, I>>(object: I): QueryClientStateRequest {
    const message = createBaseQueryClientStateRequest();
    message.client_id = object.client_id ?? "";
    return message;
  },
};
function createBaseQueryClientStateResponse(): QueryClientStateResponse {
  return {
    client_state: undefined,
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryClientStateResponse = {
  typeUrl: "/ibc.core.client.v1.QueryClientStateResponse",
  encode(message: QueryClientStateResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_state !== undefined) {
      Any.encode(message.client_state, writer.uint32(10).fork()).ldelim();
    }
    if (message.proof.length !== 0) {
      writer.uint32(18).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientStateResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientStateResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_state = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.proof = reader.bytes();
          break;
        case 3:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryClientStateResponse {
    const obj = createBaseQueryClientStateResponse();
    if (isSet(object.client_state)) obj.client_state = Any.fromJSON(object.client_state);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryClientStateResponse): unknown {
    const obj: any = {};
    message.client_state !== undefined &&
      (obj.client_state = message.client_state ? Any.toJSON(message.client_state) : undefined);
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientStateResponse>, I>>(
    object: I,
  ): QueryClientStateResponse {
    const message = createBaseQueryClientStateResponse();
    if (object.client_state !== undefined && object.client_state !== null) {
      message.client_state = Any.fromPartial(object.client_state);
    }
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryClientStatesRequest(): QueryClientStatesRequest {
  return {
    pagination: undefined,
  };
}
export const QueryClientStatesRequest = {
  typeUrl: "/ibc.core.client.v1.QueryClientStatesRequest",
  encode(message: QueryClientStatesRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientStatesRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientStatesRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryClientStatesRequest {
    const obj = createBaseQueryClientStatesRequest();
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryClientStatesRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientStatesRequest>, I>>(
    object: I,
  ): QueryClientStatesRequest {
    const message = createBaseQueryClientStatesRequest();
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryClientStatesResponse(): QueryClientStatesResponse {
  return {
    client_states: [],
    pagination: undefined,
  };
}
export const QueryClientStatesResponse = {
  typeUrl: "/ibc.core.client.v1.QueryClientStatesResponse",
  encode(message: QueryClientStatesResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.client_states) {
      IdentifiedClientState.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientStatesResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientStatesResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_states.push(IdentifiedClientState.decode(reader, reader.uint32()));
          break;
        case 2:
          message.pagination = PageResponse.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryClientStatesResponse {
    const obj = createBaseQueryClientStatesResponse();
    if (Array.isArray(object?.client_states))
      obj.client_states = object.client_states.map((e: any) => IdentifiedClientState.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryClientStatesResponse): unknown {
    const obj: any = {};
    if (message.client_states) {
      obj.client_states = message.client_states.map((e) => (e ? IdentifiedClientState.toJSON(e) : undefined));
    } else {
      obj.client_states = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientStatesResponse>, I>>(
    object: I,
  ): QueryClientStatesResponse {
    const message = createBaseQueryClientStatesResponse();
    message.client_states = object.client_states?.map((e) => IdentifiedClientState.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryConsensusStateRequest(): QueryConsensusStateRequest {
  return {
    client_id: "",
    revision_number: BigInt(0),
    revision_height: BigInt(0),
    latest_height: false,
  };
}
export const QueryConsensusStateRequest = {
  typeUrl: "/ibc.core.client.v1.QueryConsensusStateRequest",
  encode(message: QueryConsensusStateRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.revision_number !== BigInt(0)) {
      writer.uint32(16).uint64(message.revision_number);
    }
    if (message.revision_height !== BigInt(0)) {
      writer.uint32(24).uint64(message.revision_height);
    }
    if (message.latest_height === true) {
      writer.uint32(32).bool(message.latest_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConsensusStateRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConsensusStateRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.revision_number = reader.uint64();
          break;
        case 3:
          message.revision_height = reader.uint64();
          break;
        case 4:
          message.latest_height = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryConsensusStateRequest {
    const obj = createBaseQueryConsensusStateRequest();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.revision_number)) obj.revision_number = BigInt(object.revision_number.toString());
    if (isSet(object.revision_height)) obj.revision_height = BigInt(object.revision_height.toString());
    if (isSet(object.latest_height)) obj.latest_height = Boolean(object.latest_height);
    return obj;
  },
  toJSON(message: QueryConsensusStateRequest): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.revision_number !== undefined &&
      (obj.revision_number = (message.revision_number || BigInt(0)).toString());
    message.revision_height !== undefined &&
      (obj.revision_height = (message.revision_height || BigInt(0)).toString());
    message.latest_height !== undefined && (obj.latest_height = message.latest_height);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConsensusStateRequest>, I>>(
    object: I,
  ): QueryConsensusStateRequest {
    const message = createBaseQueryConsensusStateRequest();
    message.client_id = object.client_id ?? "";
    if (object.revision_number !== undefined && object.revision_number !== null) {
      message.revision_number = BigInt(object.revision_number.toString());
    }
    if (object.revision_height !== undefined && object.revision_height !== null) {
      message.revision_height = BigInt(object.revision_height.toString());
    }
    message.latest_height = object.latest_height ?? false;
    return message;
  },
};
function createBaseQueryConsensusStateResponse(): QueryConsensusStateResponse {
  return {
    consensus_state: undefined,
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryConsensusStateResponse = {
  typeUrl: "/ibc.core.client.v1.QueryConsensusStateResponse",
  encode(message: QueryConsensusStateResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.consensus_state !== undefined) {
      Any.encode(message.consensus_state, writer.uint32(10).fork()).ldelim();
    }
    if (message.proof.length !== 0) {
      writer.uint32(18).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConsensusStateResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConsensusStateResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.consensus_state = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.proof = reader.bytes();
          break;
        case 3:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryConsensusStateResponse {
    const obj = createBaseQueryConsensusStateResponse();
    if (isSet(object.consensus_state)) obj.consensus_state = Any.fromJSON(object.consensus_state);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryConsensusStateResponse): unknown {
    const obj: any = {};
    message.consensus_state !== undefined &&
      (obj.consensus_state = message.consensus_state ? Any.toJSON(message.consensus_state) : undefined);
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConsensusStateResponse>, I>>(
    object: I,
  ): QueryConsensusStateResponse {
    const message = createBaseQueryConsensusStateResponse();
    if (object.consensus_state !== undefined && object.consensus_state !== null) {
      message.consensus_state = Any.fromPartial(object.consensus_state);
    }
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryConsensusStatesRequest(): QueryConsensusStatesRequest {
  return {
    client_id: "",
    pagination: undefined,
  };
}
export const QueryConsensusStatesRequest = {
  typeUrl: "/ibc.core.client.v1.QueryConsensusStatesRequest",
  encode(message: QueryConsensusStatesRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConsensusStatesRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConsensusStatesRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryConsensusStatesRequest {
    const obj = createBaseQueryConsensusStatesRequest();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryConsensusStatesRequest): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConsensusStatesRequest>, I>>(
    object: I,
  ): QueryConsensusStatesRequest {
    const message = createBaseQueryConsensusStatesRequest();
    message.client_id = object.client_id ?? "";
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryConsensusStatesResponse(): QueryConsensusStatesResponse {
  return {
    consensus_states: [],
    pagination: undefined,
  };
}
export const QueryConsensusStatesResponse = {
  typeUrl: "/ibc.core.client.v1.QueryConsensusStatesResponse",
  encode(message: QueryConsensusStatesResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.consensus_states) {
      ConsensusStateWithHeight.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConsensusStatesResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConsensusStatesResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.consensus_states.push(ConsensusStateWithHeight.decode(reader, reader.uint32()));
          break;
        case 2:
          message.pagination = PageResponse.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryConsensusStatesResponse {
    const obj = createBaseQueryConsensusStatesResponse();
    if (Array.isArray(object?.consensus_states))
      obj.consensus_states = object.consensus_states.map((e: any) => ConsensusStateWithHeight.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryConsensusStatesResponse): unknown {
    const obj: any = {};
    if (message.consensus_states) {
      obj.consensus_states = message.consensus_states.map((e) =>
        e ? ConsensusStateWithHeight.toJSON(e) : undefined,
      );
    } else {
      obj.consensus_states = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConsensusStatesResponse>, I>>(
    object: I,
  ): QueryConsensusStatesResponse {
    const message = createBaseQueryConsensusStatesResponse();
    message.consensus_states =
      object.consensus_states?.map((e) => ConsensusStateWithHeight.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryConsensusStateHeightsRequest(): QueryConsensusStateHeightsRequest {
  return {
    client_id: "",
    pagination: undefined,
  };
}
export const QueryConsensusStateHeightsRequest = {
  typeUrl: "/ibc.core.client.v1.QueryConsensusStateHeightsRequest",
  encode(
    message: QueryConsensusStateHeightsRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConsensusStateHeightsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConsensusStateHeightsRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryConsensusStateHeightsRequest {
    const obj = createBaseQueryConsensusStateHeightsRequest();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryConsensusStateHeightsRequest): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConsensusStateHeightsRequest>, I>>(
    object: I,
  ): QueryConsensusStateHeightsRequest {
    const message = createBaseQueryConsensusStateHeightsRequest();
    message.client_id = object.client_id ?? "";
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryConsensusStateHeightsResponse(): QueryConsensusStateHeightsResponse {
  return {
    consensus_state_heights: [],
    pagination: undefined,
  };
}
export const QueryConsensusStateHeightsResponse = {
  typeUrl: "/ibc.core.client.v1.QueryConsensusStateHeightsResponse",
  encode(
    message: QueryConsensusStateHeightsResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    for (const v of message.consensus_state_heights) {
      Height.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConsensusStateHeightsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConsensusStateHeightsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.consensus_state_heights.push(Height.decode(reader, reader.uint32()));
          break;
        case 2:
          message.pagination = PageResponse.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryConsensusStateHeightsResponse {
    const obj = createBaseQueryConsensusStateHeightsResponse();
    if (Array.isArray(object?.consensus_state_heights))
      obj.consensus_state_heights = object.consensus_state_heights.map((e: any) => Height.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryConsensusStateHeightsResponse): unknown {
    const obj: any = {};
    if (message.consensus_state_heights) {
      obj.consensus_state_heights = message.consensus_state_heights.map((e) =>
        e ? Height.toJSON(e) : undefined,
      );
    } else {
      obj.consensus_state_heights = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConsensusStateHeightsResponse>, I>>(
    object: I,
  ): QueryConsensusStateHeightsResponse {
    const message = createBaseQueryConsensusStateHeightsResponse();
    message.consensus_state_heights = object.consensus_state_heights?.map((e) => Height.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryClientStatusRequest(): QueryClientStatusRequest {
  return {
    client_id: "",
  };
}
export const QueryClientStatusRequest = {
  typeUrl: "/ibc.core.client.v1.QueryClientStatusRequest",
  encode(message: QueryClientStatusRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientStatusRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientStatusRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryClientStatusRequest {
    const obj = createBaseQueryClientStatusRequest();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    return obj;
  },
  toJSON(message: QueryClientStatusRequest): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientStatusRequest>, I>>(
    object: I,
  ): QueryClientStatusRequest {
    const message = createBaseQueryClientStatusRequest();
    message.client_id = object.client_id ?? "";
    return message;
  },
};
function createBaseQueryClientStatusResponse(): QueryClientStatusResponse {
  return {
    status: "",
  };
}
export const QueryClientStatusResponse = {
  typeUrl: "/ibc.core.client.v1.QueryClientStatusResponse",
  encode(message: QueryClientStatusResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.status !== "") {
      writer.uint32(10).string(message.status);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientStatusResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientStatusResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.status = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryClientStatusResponse {
    const obj = createBaseQueryClientStatusResponse();
    if (isSet(object.status)) obj.status = String(object.status);
    return obj;
  },
  toJSON(message: QueryClientStatusResponse): unknown {
    const obj: any = {};
    message.status !== undefined && (obj.status = message.status);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientStatusResponse>, I>>(
    object: I,
  ): QueryClientStatusResponse {
    const message = createBaseQueryClientStatusResponse();
    message.status = object.status ?? "";
    return message;
  },
};
function createBaseQueryClientParamsRequest(): QueryClientParamsRequest {
  return {};
}
export const QueryClientParamsRequest = {
  typeUrl: "/ibc.core.client.v1.QueryClientParamsRequest",
  encode(_: QueryClientParamsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientParamsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientParamsRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(_: any): QueryClientParamsRequest {
    const obj = createBaseQueryClientParamsRequest();
    return obj;
  },
  toJSON(_: QueryClientParamsRequest): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientParamsRequest>, I>>(_: I): QueryClientParamsRequest {
    const message = createBaseQueryClientParamsRequest();
    return message;
  },
};
function createBaseQueryClientParamsResponse(): QueryClientParamsResponse {
  return {
    params: undefined,
  };
}
export const QueryClientParamsResponse = {
  typeUrl: "/ibc.core.client.v1.QueryClientParamsResponse",
  encode(message: QueryClientParamsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.params !== undefined) {
      Params.encode(message.params, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryClientParamsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryClientParamsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.params = Params.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryClientParamsResponse {
    const obj = createBaseQueryClientParamsResponse();
    if (isSet(object.params)) obj.params = Params.fromJSON(object.params);
    return obj;
  },
  toJSON(message: QueryClientParamsResponse): unknown {
    const obj: any = {};
    message.params !== undefined && (obj.params = message.params ? Params.toJSON(message.params) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryClientParamsResponse>, I>>(
    object: I,
  ): QueryClientParamsResponse {
    const message = createBaseQueryClientParamsResponse();
    if (object.params !== undefined && object.params !== null) {
      message.params = Params.fromPartial(object.params);
    }
    return message;
  },
};
function createBaseQueryUpgradedClientStateRequest(): QueryUpgradedClientStateRequest {
  return {};
}
export const QueryUpgradedClientStateRequest = {
  typeUrl: "/ibc.core.client.v1.QueryUpgradedClientStateRequest",
  encode(_: QueryUpgradedClientStateRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUpgradedClientStateRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUpgradedClientStateRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(_: any): QueryUpgradedClientStateRequest {
    const obj = createBaseQueryUpgradedClientStateRequest();
    return obj;
  },
  toJSON(_: QueryUpgradedClientStateRequest): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUpgradedClientStateRequest>, I>>(
    _: I,
  ): QueryUpgradedClientStateRequest {
    const message = createBaseQueryUpgradedClientStateRequest();
    return message;
  },
};
function createBaseQueryUpgradedClientStateResponse(): QueryUpgradedClientStateResponse {
  return {
    upgraded_client_state: undefined,
  };
}
export const QueryUpgradedClientStateResponse = {
  typeUrl: "/ibc.core.client.v1.QueryUpgradedClientStateResponse",
  encode(
    message: QueryUpgradedClientStateResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.upgraded_client_state !== undefined) {
      Any.encode(message.upgraded_client_state, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUpgradedClientStateResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUpgradedClientStateResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.upgraded_client_state = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryUpgradedClientStateResponse {
    const obj = createBaseQueryUpgradedClientStateResponse();
    if (isSet(object.upgraded_client_state))
      obj.upgraded_client_state = Any.fromJSON(object.upgraded_client_state);
    return obj;
  },
  toJSON(message: QueryUpgradedClientStateResponse): unknown {
    const obj: any = {};
    message.upgraded_client_state !== undefined &&
      (obj.upgraded_client_state = message.upgraded_client_state
        ? Any.toJSON(message.upgraded_client_state)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUpgradedClientStateResponse>, I>>(
    object: I,
  ): QueryUpgradedClientStateResponse {
    const message = createBaseQueryUpgradedClientStateResponse();
    if (object.upgraded_client_state !== undefined && object.upgraded_client_state !== null) {
      message.upgraded_client_state = Any.fromPartial(object.upgraded_client_state);
    }
    return message;
  },
};
function createBaseQueryUpgradedConsensusStateRequest(): QueryUpgradedConsensusStateRequest {
  return {};
}
export const QueryUpgradedConsensusStateRequest = {
  typeUrl: "/ibc.core.client.v1.QueryUpgradedConsensusStateRequest",
  encode(_: QueryUpgradedConsensusStateRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUpgradedConsensusStateRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUpgradedConsensusStateRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(_: any): QueryUpgradedConsensusStateRequest {
    const obj = createBaseQueryUpgradedConsensusStateRequest();
    return obj;
  },
  toJSON(_: QueryUpgradedConsensusStateRequest): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUpgradedConsensusStateRequest>, I>>(
    _: I,
  ): QueryUpgradedConsensusStateRequest {
    const message = createBaseQueryUpgradedConsensusStateRequest();
    return message;
  },
};
function createBaseQueryUpgradedConsensusStateResponse(): QueryUpgradedConsensusStateResponse {
  return {
    upgraded_consensus_state: undefined,
  };
}
export const QueryUpgradedConsensusStateResponse = {
  typeUrl: "/ibc.core.client.v1.QueryUpgradedConsensusStateResponse",
  encode(
    message: QueryUpgradedConsensusStateResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.upgraded_consensus_state !== undefined) {
      Any.encode(message.upgraded_consensus_state, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUpgradedConsensusStateResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUpgradedConsensusStateResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.upgraded_consensus_state = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryUpgradedConsensusStateResponse {
    const obj = createBaseQueryUpgradedConsensusStateResponse();
    if (isSet(object.upgraded_consensus_state))
      obj.upgraded_consensus_state = Any.fromJSON(object.upgraded_consensus_state);
    return obj;
  },
  toJSON(message: QueryUpgradedConsensusStateResponse): unknown {
    const obj: any = {};
    message.upgraded_consensus_state !== undefined &&
      (obj.upgraded_consensus_state = message.upgraded_consensus_state
        ? Any.toJSON(message.upgraded_consensus_state)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUpgradedConsensusStateResponse>, I>>(
    object: I,
  ): QueryUpgradedConsensusStateResponse {
    const message = createBaseQueryUpgradedConsensusStateResponse();
    if (object.upgraded_consensus_state !== undefined && object.upgraded_consensus_state !== null) {
      message.upgraded_consensus_state = Any.fromPartial(object.upgraded_consensus_state);
    }
    return message;
  },
};
function createBaseQueryNewClientRequest(): QueryNewClientRequest {
  return {
    height: BigInt(0),
  };
}
export const QueryNewClientRequest = {
  typeUrl: "/ibc.core.client.v1.QueryNewClientRequest",
  encode(message: QueryNewClientRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== BigInt(0)) {
      writer.uint32(8).uint64(message.height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryNewClientRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryNewClientRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryNewClientRequest {
    const obj = createBaseQueryNewClientRequest();
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    return obj;
  },
  toJSON(message: QueryNewClientRequest): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryNewClientRequest>, I>>(object: I): QueryNewClientRequest {
    const message = createBaseQueryNewClientRequest();
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    return message;
  },
};
function createBaseQueryNewClientResponse(): QueryNewClientResponse {
  return {
    client_state: undefined,
    consensus_state: undefined,
  };
}
export const QueryNewClientResponse = {
  typeUrl: "/ibc.core.client.v1.QueryNewClientResponse",
  encode(message: QueryNewClientResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_state !== undefined) {
      Any.encode(message.client_state, writer.uint32(10).fork()).ldelim();
    }
    if (message.consensus_state !== undefined) {
      Any.encode(message.consensus_state, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryNewClientResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryNewClientResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_state = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.consensus_state = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryNewClientResponse {
    const obj = createBaseQueryNewClientResponse();
    if (isSet(object.client_state)) obj.client_state = Any.fromJSON(object.client_state);
    if (isSet(object.consensus_state)) obj.consensus_state = Any.fromJSON(object.consensus_state);
    return obj;
  },
  toJSON(message: QueryNewClientResponse): unknown {
    const obj: any = {};
    message.client_state !== undefined &&
      (obj.client_state = message.client_state ? Any.toJSON(message.client_state) : undefined);
    message.consensus_state !== undefined &&
      (obj.consensus_state = message.consensus_state ? Any.toJSON(message.consensus_state) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryNewClientResponse>, I>>(object: I): QueryNewClientResponse {
    const message = createBaseQueryNewClientResponse();
    if (object.client_state !== undefined && object.client_state !== null) {
      message.client_state = Any.fromPartial(object.client_state);
    }
    if (object.consensus_state !== undefined && object.consensus_state !== null) {
      message.consensus_state = Any.fromPartial(object.consensus_state);
    }
    return message;
  },
};
function createBaseQueryBlockDataRequest(): QueryBlockDataRequest {
  return {
    height: BigInt(0),
  };
}
export const QueryBlockDataRequest = {
  typeUrl: "/ibc.core.client.v1.QueryBlockDataRequest",
  encode(message: QueryBlockDataRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== BigInt(0)) {
      writer.uint32(8).uint64(message.height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBlockDataRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBlockDataRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryBlockDataRequest {
    const obj = createBaseQueryBlockDataRequest();
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    return obj;
  },
  toJSON(message: QueryBlockDataRequest): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBlockDataRequest>, I>>(object: I): QueryBlockDataRequest {
    const message = createBaseQueryBlockDataRequest();
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    return message;
  },
};
function createBaseQueryBlockDataResponse(): QueryBlockDataResponse {
  return {
    block_data: undefined,
  };
}
export const QueryBlockDataResponse = {
  typeUrl: "/ibc.core.client.v1.QueryBlockDataResponse",
  encode(message: QueryBlockDataResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.block_data !== undefined) {
      Any.encode(message.block_data, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBlockDataResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBlockDataResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.block_data = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryBlockDataResponse {
    const obj = createBaseQueryBlockDataResponse();
    if (isSet(object.block_data)) obj.block_data = Any.fromJSON(object.block_data);
    return obj;
  },
  toJSON(message: QueryBlockDataResponse): unknown {
    const obj: any = {};
    message.block_data !== undefined &&
      (obj.block_data = message.block_data ? Any.toJSON(message.block_data) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBlockDataResponse>, I>>(object: I): QueryBlockDataResponse {
    const message = createBaseQueryBlockDataResponse();
    if (object.block_data !== undefined && object.block_data !== null) {
      message.block_data = Any.fromPartial(object.block_data);
    }
    return message;
  },
};
/** Query provides defines the gRPC querier service */
export interface Query {
  /** ClientState queries an IBC light client. */
  ClientState(request: QueryClientStateRequest): Promise<QueryClientStateResponse>;
  /** ClientStates queries all the IBC light clients of a chain. */
  ClientStates(request?: QueryClientStatesRequest): Promise<QueryClientStatesResponse>;
  /**
   * ConsensusState queries a consensus state associated with a client state at
   * a given height.
   */
  ConsensusState(request: QueryConsensusStateRequest): Promise<QueryConsensusStateResponse>;
  /**
   * ConsensusStates queries all the consensus state associated with a given
   * client.
   */
  ConsensusStates(request: QueryConsensusStatesRequest): Promise<QueryConsensusStatesResponse>;
  /** ConsensusStateHeights queries the height of every consensus states associated with a given client. */
  ConsensusStateHeights(
    request: QueryConsensusStateHeightsRequest,
  ): Promise<QueryConsensusStateHeightsResponse>;
  /** Status queries the status of an IBC client. */
  ClientStatus(request: QueryClientStatusRequest): Promise<QueryClientStatusResponse>;
  /** ClientParams queries all parameters of the ibc client submodule. */
  ClientParams(request?: QueryClientParamsRequest): Promise<QueryClientParamsResponse>;
  /** UpgradedClientState queries an Upgraded IBC light client. */
  UpgradedClientState(request?: QueryUpgradedClientStateRequest): Promise<QueryUpgradedClientStateResponse>;
  /** UpgradedConsensusState queries an Upgraded IBC consensus state. */
  UpgradedConsensusState(
    request?: QueryUpgradedConsensusStateRequest,
  ): Promise<QueryUpgradedConsensusStateResponse>;
  LatestHeight(request?: QueryLatestHeightRequest): Promise<QueryLatestHeightResponse>;
  NewClient(request: QueryNewClientRequest): Promise<QueryNewClientResponse>;
  BlockData(request: QueryBlockDataRequest): Promise<QueryBlockDataResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.ClientState = this.ClientState.bind(this);
    this.ClientStates = this.ClientStates.bind(this);
    this.ConsensusState = this.ConsensusState.bind(this);
    this.ConsensusStates = this.ConsensusStates.bind(this);
    this.ConsensusStateHeights = this.ConsensusStateHeights.bind(this);
    this.ClientStatus = this.ClientStatus.bind(this);
    this.ClientParams = this.ClientParams.bind(this);
    this.UpgradedClientState = this.UpgradedClientState.bind(this);
    this.UpgradedConsensusState = this.UpgradedConsensusState.bind(this);
    this.LatestHeight = this.LatestHeight.bind(this);
    this.NewClient = this.NewClient.bind(this);
    this.BlockData = this.BlockData.bind(this);
  }
  ClientState(request: QueryClientStateRequest): Promise<QueryClientStateResponse> {
    const data = QueryClientStateRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "ClientState", data);
    return promise.then((data) => QueryClientStateResponse.decode(new BinaryReader(data)));
  }
  ClientStates(
    request: QueryClientStatesRequest = {
      pagination: PageRequest.fromPartial({}),
    },
  ): Promise<QueryClientStatesResponse> {
    const data = QueryClientStatesRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "ClientStates", data);
    return promise.then((data) => QueryClientStatesResponse.decode(new BinaryReader(data)));
  }
  ConsensusState(request: QueryConsensusStateRequest): Promise<QueryConsensusStateResponse> {
    const data = QueryConsensusStateRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "ConsensusState", data);
    return promise.then((data) => QueryConsensusStateResponse.decode(new BinaryReader(data)));
  }
  ConsensusStates(request: QueryConsensusStatesRequest): Promise<QueryConsensusStatesResponse> {
    const data = QueryConsensusStatesRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "ConsensusStates", data);
    return promise.then((data) => QueryConsensusStatesResponse.decode(new BinaryReader(data)));
  }
  ConsensusStateHeights(
    request: QueryConsensusStateHeightsRequest,
  ): Promise<QueryConsensusStateHeightsResponse> {
    const data = QueryConsensusStateHeightsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "ConsensusStateHeights", data);
    return promise.then((data) => QueryConsensusStateHeightsResponse.decode(new BinaryReader(data)));
  }
  ClientStatus(request: QueryClientStatusRequest): Promise<QueryClientStatusResponse> {
    const data = QueryClientStatusRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "ClientStatus", data);
    return promise.then((data) => QueryClientStatusResponse.decode(new BinaryReader(data)));
  }
  ClientParams(request: QueryClientParamsRequest = {}): Promise<QueryClientParamsResponse> {
    const data = QueryClientParamsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "ClientParams", data);
    return promise.then((data) => QueryClientParamsResponse.decode(new BinaryReader(data)));
  }
  UpgradedClientState(
    request: QueryUpgradedClientStateRequest = {},
  ): Promise<QueryUpgradedClientStateResponse> {
    const data = QueryUpgradedClientStateRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "UpgradedClientState", data);
    return promise.then((data) => QueryUpgradedClientStateResponse.decode(new BinaryReader(data)));
  }
  UpgradedConsensusState(
    request: QueryUpgradedConsensusStateRequest = {},
  ): Promise<QueryUpgradedConsensusStateResponse> {
    const data = QueryUpgradedConsensusStateRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "UpgradedConsensusState", data);
    return promise.then((data) => QueryUpgradedConsensusStateResponse.decode(new BinaryReader(data)));
  }
  LatestHeight(request: QueryLatestHeightRequest = {}): Promise<QueryLatestHeightResponse> {
    const data = QueryLatestHeightRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "LatestHeight", data);
    return promise.then((data) => QueryLatestHeightResponse.decode(new BinaryReader(data)));
  }
  NewClient(request: QueryNewClientRequest): Promise<QueryNewClientResponse> {
    const data = QueryNewClientRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "NewClient", data);
    return promise.then((data) => QueryNewClientResponse.decode(new BinaryReader(data)));
  }
  BlockData(request: QueryBlockDataRequest): Promise<QueryBlockDataResponse> {
    const data = QueryBlockDataRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Query", "BlockData", data);
    return promise.then((data) => QueryBlockDataResponse.decode(new BinaryReader(data)));
  }
}
