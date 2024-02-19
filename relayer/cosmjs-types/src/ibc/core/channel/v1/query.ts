/* eslint-disable */
import { PageRequest, PageResponse } from "../../../../cosmos/base/query/v1beta1/pagination";
import { Channel, IdentifiedChannel, PacketState } from "./channel";
import { Height, IdentifiedClientState } from "../../client/v1/client";
import { Any } from "../../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.core.channel.v1";
/** QueryChannelRequest is the request type for the Query/Channel RPC method */
export interface QueryChannelRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
}
/**
 * QueryChannelResponse is the response type for the Query/Channel RPC method.
 * Besides the Channel end, it includes a proof and the height from which the
 * proof was retrieved.
 */
export interface QueryChannelResponse {
  /** channel associated with the request identifiers */
  channel?: Channel;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/** QueryChannelsRequest is the request type for the Query/Channels RPC method */
export interface QueryChannelsRequest {
  /** pagination request */
  pagination?: PageRequest;
}
/** QueryChannelsResponse is the response type for the Query/Channels RPC method. */
export interface QueryChannelsResponse {
  /** list of stored channels of the chain. */
  channels: IdentifiedChannel[];
  /** pagination response */
  pagination?: PageResponse;
  /** query block height */
  height: Height;
}
/**
 * QueryConnectionChannelsRequest is the request type for the
 * Query/QueryConnectionChannels RPC method
 */
export interface QueryConnectionChannelsRequest {
  /** connection unique identifier */
  connection: string;
  /** pagination request */
  pagination?: PageRequest;
}
/**
 * QueryConnectionChannelsResponse is the Response type for the
 * Query/QueryConnectionChannels RPC method
 */
export interface QueryConnectionChannelsResponse {
  /** list of channels associated with a connection. */
  channels: IdentifiedChannel[];
  /** pagination response */
  pagination?: PageResponse;
  /** query block height */
  height: Height;
}
/**
 * QueryChannelClientStateRequest is the request type for the Query/ClientState
 * RPC method
 */
export interface QueryChannelClientStateRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
}
/**
 * QueryChannelClientStateResponse is the Response type for the
 * Query/QueryChannelClientState RPC method
 */
export interface QueryChannelClientStateResponse {
  /** client state associated with the channel */
  identified_client_state?: IdentifiedClientState;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/**
 * QueryChannelConsensusStateRequest is the request type for the
 * Query/ConsensusState RPC method
 */
export interface QueryChannelConsensusStateRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** revision number of the consensus state */
  revision_number: bigint;
  /** revision height of the consensus state */
  revision_height: bigint;
}
/**
 * QueryChannelClientStateResponse is the Response type for the
 * Query/QueryChannelClientState RPC method
 */
export interface QueryChannelConsensusStateResponse {
  /** consensus state associated with the channel */
  consensus_state?: Any;
  /** client ID associated with the consensus state */
  client_id: string;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/**
 * QueryPacketCommitmentRequest is the request type for the
 * Query/PacketCommitment RPC method
 */
export interface QueryPacketCommitmentRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** packet sequence */
  sequence: bigint;
}
/**
 * QueryPacketCommitmentResponse defines the client query response for a packet
 * which also includes a proof and the height from which the proof was
 * retrieved
 */
export interface QueryPacketCommitmentResponse {
  /** packet associated with the request fields */
  commitment: Uint8Array;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/**
 * QueryPacketCommitmentsRequest is the request type for the
 * Query/QueryPacketCommitments RPC method
 */
export interface QueryPacketCommitmentsRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** pagination request */
  pagination?: PageRequest;
}
/**
 * QueryPacketCommitmentsResponse is the request type for the
 * Query/QueryPacketCommitments RPC method
 */
export interface QueryPacketCommitmentsResponse {
  commitments: PacketState[];
  /** pagination response */
  pagination?: PageResponse;
  /** query block height */
  height: Height;
}
/**
 * QueryPacketReceiptRequest is the request type for the
 * Query/PacketReceipt RPC method
 */
export interface QueryPacketReceiptRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** packet sequence */
  sequence: bigint;
}
/**
 * QueryPacketReceiptResponse defines the client query response for a packet
 * receipt which also includes a proof, and the height from which the proof was
 * retrieved
 */
export interface QueryPacketReceiptResponse {
  /** success flag for if receipt exists */
  received: boolean;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/**
 * QueryPacketAcknowledgementRequest is the request type for the
 * Query/PacketAcknowledgement RPC method
 */
export interface QueryPacketAcknowledgementRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** packet sequence */
  sequence: bigint;
}
/**
 * QueryPacketAcknowledgementResponse defines the client query response for a
 * packet which also includes a proof and the height from which the
 * proof was retrieved
 */
export interface QueryPacketAcknowledgementResponse {
  /** packet associated with the request fields */
  acknowledgement: Uint8Array;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
/**
 * QueryPacketAcknowledgementsRequest is the request type for the
 * Query/QueryPacketCommitments RPC method
 */
export interface QueryPacketAcknowledgementsRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** pagination request */
  pagination?: PageRequest;
  /** list of packet sequences */
  packet_commitment_sequences: bigint[];
}
/**
 * QueryPacketAcknowledgemetsResponse is the request type for the
 * Query/QueryPacketAcknowledgements RPC method
 */
export interface QueryPacketAcknowledgementsResponse {
  acknowledgements: PacketState[];
  /** pagination response */
  pagination?: PageResponse;
  /** query block height */
  height: Height;
}
/**
 * QueryUnreceivedPacketsRequest is the request type for the
 * Query/UnreceivedPackets RPC method
 */
export interface QueryUnreceivedPacketsRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** list of packet sequences */
  packet_commitment_sequences: bigint[];
}
/**
 * QueryUnreceivedPacketsResponse is the response type for the
 * Query/UnreceivedPacketCommitments RPC method
 */
export interface QueryUnreceivedPacketsResponse {
  /** list of unreceived packet sequences */
  sequences: bigint[];
  /** query block height */
  height: Height;
}
/**
 * QueryUnreceivedAcks is the request type for the
 * Query/UnreceivedAcks RPC method
 */
export interface QueryUnreceivedAcksRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
  /** list of acknowledgement sequences */
  packet_ack_sequences: bigint[];
}
/**
 * QueryUnreceivedAcksResponse is the response type for the
 * Query/UnreceivedAcks RPC method
 */
export interface QueryUnreceivedAcksResponse {
  /** list of unreceived acknowledgement sequences */
  sequences: bigint[];
  /** query block height */
  height: Height;
}
/**
 * QueryNextSequenceReceiveRequest is the request type for the
 * Query/QueryNextSequenceReceiveRequest RPC method
 */
export interface QueryNextSequenceReceiveRequest {
  /** port unique identifier */
  port_id: string;
  /** channel unique identifier */
  channel_id: string;
}
/**
 * QuerySequenceResponse is the request type for the
 * Query/QueryNextSequenceReceiveResponse RPC method
 */
export interface QueryNextSequenceReceiveResponse {
  /** next sequence receive number */
  next_sequence_receive: bigint;
  /** merkle proof of existence */
  proof: Uint8Array;
  /** height at which the proof was retrieved */
  proof_height: Height;
}
function createBaseQueryChannelRequest(): QueryChannelRequest {
  return {
    port_id: "",
    channel_id: "",
  };
}
export const QueryChannelRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelRequest",
  encode(message: QueryChannelRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelRequest();
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
  fromJSON(object: any): QueryChannelRequest {
    const obj = createBaseQueryChannelRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: QueryChannelRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelRequest>, I>>(object: I): QueryChannelRequest {
    const message = createBaseQueryChannelRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  },
};
function createBaseQueryChannelResponse(): QueryChannelResponse {
  return {
    channel: undefined,
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryChannelResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelResponse",
  encode(message: QueryChannelResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.channel !== undefined) {
      Channel.encode(message.channel, writer.uint32(10).fork()).ldelim();
    }
    if (message.proof.length !== 0) {
      writer.uint32(18).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channel = Channel.decode(reader, reader.uint32());
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
  fromJSON(object: any): QueryChannelResponse {
    const obj = createBaseQueryChannelResponse();
    if (isSet(object.channel)) obj.channel = Channel.fromJSON(object.channel);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryChannelResponse): unknown {
    const obj: any = {};
    message.channel !== undefined &&
      (obj.channel = message.channel ? Channel.toJSON(message.channel) : undefined);
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelResponse>, I>>(object: I): QueryChannelResponse {
    const message = createBaseQueryChannelResponse();
    if (object.channel !== undefined && object.channel !== null) {
      message.channel = Channel.fromPartial(object.channel);
    }
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryChannelsRequest(): QueryChannelsRequest {
  return {
    pagination: undefined,
  };
}
export const QueryChannelsRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelsRequest",
  encode(message: QueryChannelsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelsRequest();
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
  fromJSON(object: any): QueryChannelsRequest {
    const obj = createBaseQueryChannelsRequest();
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryChannelsRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelsRequest>, I>>(object: I): QueryChannelsRequest {
    const message = createBaseQueryChannelsRequest();
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryChannelsResponse(): QueryChannelsResponse {
  return {
    channels: [],
    pagination: undefined,
    height: Height.fromPartial({}),
  };
}
export const QueryChannelsResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelsResponse",
  encode(message: QueryChannelsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.channels) {
      IdentifiedChannel.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channels.push(IdentifiedChannel.decode(reader, reader.uint32()));
          break;
        case 2:
          message.pagination = PageResponse.decode(reader, reader.uint32());
          break;
        case 3:
          message.height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryChannelsResponse {
    const obj = createBaseQueryChannelsResponse();
    if (Array.isArray(object?.channels))
      obj.channels = object.channels.map((e: any) => IdentifiedChannel.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    return obj;
  },
  toJSON(message: QueryChannelsResponse): unknown {
    const obj: any = {};
    if (message.channels) {
      obj.channels = message.channels.map((e) => (e ? IdentifiedChannel.toJSON(e) : undefined));
    } else {
      obj.channels = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelsResponse>, I>>(object: I): QueryChannelsResponse {
    const message = createBaseQueryChannelsResponse();
    message.channels = object.channels?.map((e) => IdentifiedChannel.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    return message;
  },
};
function createBaseQueryConnectionChannelsRequest(): QueryConnectionChannelsRequest {
  return {
    connection: "",
    pagination: undefined,
  };
}
export const QueryConnectionChannelsRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryConnectionChannelsRequest",
  encode(
    message: QueryConnectionChannelsRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.connection !== "") {
      writer.uint32(10).string(message.connection);
    }
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConnectionChannelsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConnectionChannelsRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.connection = reader.string();
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
  fromJSON(object: any): QueryConnectionChannelsRequest {
    const obj = createBaseQueryConnectionChannelsRequest();
    if (isSet(object.connection)) obj.connection = String(object.connection);
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryConnectionChannelsRequest): unknown {
    const obj: any = {};
    message.connection !== undefined && (obj.connection = message.connection);
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConnectionChannelsRequest>, I>>(
    object: I,
  ): QueryConnectionChannelsRequest {
    const message = createBaseQueryConnectionChannelsRequest();
    message.connection = object.connection ?? "";
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryConnectionChannelsResponse(): QueryConnectionChannelsResponse {
  return {
    channels: [],
    pagination: undefined,
    height: Height.fromPartial({}),
  };
}
export const QueryConnectionChannelsResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryConnectionChannelsResponse",
  encode(
    message: QueryConnectionChannelsResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    for (const v of message.channels) {
      IdentifiedChannel.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryConnectionChannelsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryConnectionChannelsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channels.push(IdentifiedChannel.decode(reader, reader.uint32()));
          break;
        case 2:
          message.pagination = PageResponse.decode(reader, reader.uint32());
          break;
        case 3:
          message.height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryConnectionChannelsResponse {
    const obj = createBaseQueryConnectionChannelsResponse();
    if (Array.isArray(object?.channels))
      obj.channels = object.channels.map((e: any) => IdentifiedChannel.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    return obj;
  },
  toJSON(message: QueryConnectionChannelsResponse): unknown {
    const obj: any = {};
    if (message.channels) {
      obj.channels = message.channels.map((e) => (e ? IdentifiedChannel.toJSON(e) : undefined));
    } else {
      obj.channels = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryConnectionChannelsResponse>, I>>(
    object: I,
  ): QueryConnectionChannelsResponse {
    const message = createBaseQueryConnectionChannelsResponse();
    message.channels = object.channels?.map((e) => IdentifiedChannel.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    return message;
  },
};
function createBaseQueryChannelClientStateRequest(): QueryChannelClientStateRequest {
  return {
    port_id: "",
    channel_id: "",
  };
}
export const QueryChannelClientStateRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelClientStateRequest",
  encode(
    message: QueryChannelClientStateRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelClientStateRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelClientStateRequest();
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
  fromJSON(object: any): QueryChannelClientStateRequest {
    const obj = createBaseQueryChannelClientStateRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: QueryChannelClientStateRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelClientStateRequest>, I>>(
    object: I,
  ): QueryChannelClientStateRequest {
    const message = createBaseQueryChannelClientStateRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  },
};
function createBaseQueryChannelClientStateResponse(): QueryChannelClientStateResponse {
  return {
    identified_client_state: undefined,
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryChannelClientStateResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelClientStateResponse",
  encode(
    message: QueryChannelClientStateResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.identified_client_state !== undefined) {
      IdentifiedClientState.encode(message.identified_client_state, writer.uint32(10).fork()).ldelim();
    }
    if (message.proof.length !== 0) {
      writer.uint32(18).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelClientStateResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelClientStateResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.identified_client_state = IdentifiedClientState.decode(reader, reader.uint32());
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
  fromJSON(object: any): QueryChannelClientStateResponse {
    const obj = createBaseQueryChannelClientStateResponse();
    if (isSet(object.identified_client_state))
      obj.identified_client_state = IdentifiedClientState.fromJSON(object.identified_client_state);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryChannelClientStateResponse): unknown {
    const obj: any = {};
    message.identified_client_state !== undefined &&
      (obj.identified_client_state = message.identified_client_state
        ? IdentifiedClientState.toJSON(message.identified_client_state)
        : undefined);
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelClientStateResponse>, I>>(
    object: I,
  ): QueryChannelClientStateResponse {
    const message = createBaseQueryChannelClientStateResponse();
    if (object.identified_client_state !== undefined && object.identified_client_state !== null) {
      message.identified_client_state = IdentifiedClientState.fromPartial(object.identified_client_state);
    }
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryChannelConsensusStateRequest(): QueryChannelConsensusStateRequest {
  return {
    port_id: "",
    channel_id: "",
    revision_number: BigInt(0),
    revision_height: BigInt(0),
  };
}
export const QueryChannelConsensusStateRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelConsensusStateRequest",
  encode(
    message: QueryChannelConsensusStateRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.revision_number !== BigInt(0)) {
      writer.uint32(24).uint64(message.revision_number);
    }
    if (message.revision_height !== BigInt(0)) {
      writer.uint32(32).uint64(message.revision_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelConsensusStateRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelConsensusStateRequest();
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
          message.revision_number = reader.uint64();
          break;
        case 4:
          message.revision_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryChannelConsensusStateRequest {
    const obj = createBaseQueryChannelConsensusStateRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.revision_number)) obj.revision_number = BigInt(object.revision_number.toString());
    if (isSet(object.revision_height)) obj.revision_height = BigInt(object.revision_height.toString());
    return obj;
  },
  toJSON(message: QueryChannelConsensusStateRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.revision_number !== undefined &&
      (obj.revision_number = (message.revision_number || BigInt(0)).toString());
    message.revision_height !== undefined &&
      (obj.revision_height = (message.revision_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelConsensusStateRequest>, I>>(
    object: I,
  ): QueryChannelConsensusStateRequest {
    const message = createBaseQueryChannelConsensusStateRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.revision_number !== undefined && object.revision_number !== null) {
      message.revision_number = BigInt(object.revision_number.toString());
    }
    if (object.revision_height !== undefined && object.revision_height !== null) {
      message.revision_height = BigInt(object.revision_height.toString());
    }
    return message;
  },
};
function createBaseQueryChannelConsensusStateResponse(): QueryChannelConsensusStateResponse {
  return {
    consensus_state: undefined,
    client_id: "",
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryChannelConsensusStateResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryChannelConsensusStateResponse",
  encode(
    message: QueryChannelConsensusStateResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.consensus_state !== undefined) {
      Any.encode(message.consensus_state, writer.uint32(10).fork()).ldelim();
    }
    if (message.client_id !== "") {
      writer.uint32(18).string(message.client_id);
    }
    if (message.proof.length !== 0) {
      writer.uint32(26).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryChannelConsensusStateResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryChannelConsensusStateResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.consensus_state = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.client_id = reader.string();
          break;
        case 3:
          message.proof = reader.bytes();
          break;
        case 4:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryChannelConsensusStateResponse {
    const obj = createBaseQueryChannelConsensusStateResponse();
    if (isSet(object.consensus_state)) obj.consensus_state = Any.fromJSON(object.consensus_state);
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryChannelConsensusStateResponse): unknown {
    const obj: any = {};
    message.consensus_state !== undefined &&
      (obj.consensus_state = message.consensus_state ? Any.toJSON(message.consensus_state) : undefined);
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryChannelConsensusStateResponse>, I>>(
    object: I,
  ): QueryChannelConsensusStateResponse {
    const message = createBaseQueryChannelConsensusStateResponse();
    if (object.consensus_state !== undefined && object.consensus_state !== null) {
      message.consensus_state = Any.fromPartial(object.consensus_state);
    }
    message.client_id = object.client_id ?? "";
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryPacketCommitmentRequest(): QueryPacketCommitmentRequest {
  return {
    port_id: "",
    channel_id: "",
    sequence: BigInt(0),
  };
}
export const QueryPacketCommitmentRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketCommitmentRequest",
  encode(message: QueryPacketCommitmentRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
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
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketCommitmentRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketCommitmentRequest();
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
  fromJSON(object: any): QueryPacketCommitmentRequest {
    const obj = createBaseQueryPacketCommitmentRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    return obj;
  },
  toJSON(message: QueryPacketCommitmentRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketCommitmentRequest>, I>>(
    object: I,
  ): QueryPacketCommitmentRequest {
    const message = createBaseQueryPacketCommitmentRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    return message;
  },
};
function createBaseQueryPacketCommitmentResponse(): QueryPacketCommitmentResponse {
  return {
    commitment: new Uint8Array(),
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryPacketCommitmentResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketCommitmentResponse",
  encode(message: QueryPacketCommitmentResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.commitment.length !== 0) {
      writer.uint32(10).bytes(message.commitment);
    }
    if (message.proof.length !== 0) {
      writer.uint32(18).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketCommitmentResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketCommitmentResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.commitment = reader.bytes();
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
  fromJSON(object: any): QueryPacketCommitmentResponse {
    const obj = createBaseQueryPacketCommitmentResponse();
    if (isSet(object.commitment)) obj.commitment = bytesFromBase64(object.commitment);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryPacketCommitmentResponse): unknown {
    const obj: any = {};
    message.commitment !== undefined &&
      (obj.commitment = base64FromBytes(
        message.commitment !== undefined ? message.commitment : new Uint8Array(),
      ));
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketCommitmentResponse>, I>>(
    object: I,
  ): QueryPacketCommitmentResponse {
    const message = createBaseQueryPacketCommitmentResponse();
    message.commitment = object.commitment ?? new Uint8Array();
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryPacketCommitmentsRequest(): QueryPacketCommitmentsRequest {
  return {
    port_id: "",
    channel_id: "",
    pagination: undefined,
  };
}
export const QueryPacketCommitmentsRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketCommitmentsRequest",
  encode(message: QueryPacketCommitmentsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketCommitmentsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketCommitmentsRequest();
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
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryPacketCommitmentsRequest {
    const obj = createBaseQueryPacketCommitmentsRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryPacketCommitmentsRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketCommitmentsRequest>, I>>(
    object: I,
  ): QueryPacketCommitmentsRequest {
    const message = createBaseQueryPacketCommitmentsRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryPacketCommitmentsResponse(): QueryPacketCommitmentsResponse {
  return {
    commitments: [],
    pagination: undefined,
    height: Height.fromPartial({}),
  };
}
export const QueryPacketCommitmentsResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketCommitmentsResponse",
  encode(
    message: QueryPacketCommitmentsResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    for (const v of message.commitments) {
      PacketState.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketCommitmentsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketCommitmentsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.commitments.push(PacketState.decode(reader, reader.uint32()));
          break;
        case 2:
          message.pagination = PageResponse.decode(reader, reader.uint32());
          break;
        case 3:
          message.height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryPacketCommitmentsResponse {
    const obj = createBaseQueryPacketCommitmentsResponse();
    if (Array.isArray(object?.commitments))
      obj.commitments = object.commitments.map((e: any) => PacketState.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    return obj;
  },
  toJSON(message: QueryPacketCommitmentsResponse): unknown {
    const obj: any = {};
    if (message.commitments) {
      obj.commitments = message.commitments.map((e) => (e ? PacketState.toJSON(e) : undefined));
    } else {
      obj.commitments = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketCommitmentsResponse>, I>>(
    object: I,
  ): QueryPacketCommitmentsResponse {
    const message = createBaseQueryPacketCommitmentsResponse();
    message.commitments = object.commitments?.map((e) => PacketState.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    return message;
  },
};
function createBaseQueryPacketReceiptRequest(): QueryPacketReceiptRequest {
  return {
    port_id: "",
    channel_id: "",
    sequence: BigInt(0),
  };
}
export const QueryPacketReceiptRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketReceiptRequest",
  encode(message: QueryPacketReceiptRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
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
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketReceiptRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketReceiptRequest();
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
  fromJSON(object: any): QueryPacketReceiptRequest {
    const obj = createBaseQueryPacketReceiptRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    return obj;
  },
  toJSON(message: QueryPacketReceiptRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketReceiptRequest>, I>>(
    object: I,
  ): QueryPacketReceiptRequest {
    const message = createBaseQueryPacketReceiptRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    return message;
  },
};
function createBaseQueryPacketReceiptResponse(): QueryPacketReceiptResponse {
  return {
    received: false,
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryPacketReceiptResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketReceiptResponse",
  encode(message: QueryPacketReceiptResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.received === true) {
      writer.uint32(16).bool(message.received);
    }
    if (message.proof.length !== 0) {
      writer.uint32(26).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketReceiptResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketReceiptResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 2:
          message.received = reader.bool();
          break;
        case 3:
          message.proof = reader.bytes();
          break;
        case 4:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryPacketReceiptResponse {
    const obj = createBaseQueryPacketReceiptResponse();
    if (isSet(object.received)) obj.received = Boolean(object.received);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryPacketReceiptResponse): unknown {
    const obj: any = {};
    message.received !== undefined && (obj.received = message.received);
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketReceiptResponse>, I>>(
    object: I,
  ): QueryPacketReceiptResponse {
    const message = createBaseQueryPacketReceiptResponse();
    message.received = object.received ?? false;
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryPacketAcknowledgementRequest(): QueryPacketAcknowledgementRequest {
  return {
    port_id: "",
    channel_id: "",
    sequence: BigInt(0),
  };
}
export const QueryPacketAcknowledgementRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketAcknowledgementRequest",
  encode(
    message: QueryPacketAcknowledgementRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
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
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketAcknowledgementRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketAcknowledgementRequest();
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
  fromJSON(object: any): QueryPacketAcknowledgementRequest {
    const obj = createBaseQueryPacketAcknowledgementRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    return obj;
  },
  toJSON(message: QueryPacketAcknowledgementRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketAcknowledgementRequest>, I>>(
    object: I,
  ): QueryPacketAcknowledgementRequest {
    const message = createBaseQueryPacketAcknowledgementRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    return message;
  },
};
function createBaseQueryPacketAcknowledgementResponse(): QueryPacketAcknowledgementResponse {
  return {
    acknowledgement: new Uint8Array(),
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryPacketAcknowledgementResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketAcknowledgementResponse",
  encode(
    message: QueryPacketAcknowledgementResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.acknowledgement.length !== 0) {
      writer.uint32(10).bytes(message.acknowledgement);
    }
    if (message.proof.length !== 0) {
      writer.uint32(18).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketAcknowledgementResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketAcknowledgementResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.acknowledgement = reader.bytes();
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
  fromJSON(object: any): QueryPacketAcknowledgementResponse {
    const obj = createBaseQueryPacketAcknowledgementResponse();
    if (isSet(object.acknowledgement)) obj.acknowledgement = bytesFromBase64(object.acknowledgement);
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryPacketAcknowledgementResponse): unknown {
    const obj: any = {};
    message.acknowledgement !== undefined &&
      (obj.acknowledgement = base64FromBytes(
        message.acknowledgement !== undefined ? message.acknowledgement : new Uint8Array(),
      ));
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketAcknowledgementResponse>, I>>(
    object: I,
  ): QueryPacketAcknowledgementResponse {
    const message = createBaseQueryPacketAcknowledgementResponse();
    message.acknowledgement = object.acknowledgement ?? new Uint8Array();
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseQueryPacketAcknowledgementsRequest(): QueryPacketAcknowledgementsRequest {
  return {
    port_id: "",
    channel_id: "",
    pagination: undefined,
    packet_commitment_sequences: [],
  };
}
export const QueryPacketAcknowledgementsRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketAcknowledgementsRequest",
  encode(
    message: QueryPacketAcknowledgementsRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(26).fork()).ldelim();
    }
    writer.uint32(34).fork();
    for (const v of message.packet_commitment_sequences) {
      writer.uint64(v);
    }
    writer.ldelim();
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketAcknowledgementsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketAcknowledgementsRequest();
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
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        case 4:
          if ((tag & 7) === 2) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.packet_commitment_sequences.push(reader.uint64());
            }
          } else {
            message.packet_commitment_sequences.push(reader.uint64());
          }
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryPacketAcknowledgementsRequest {
    const obj = createBaseQueryPacketAcknowledgementsRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    if (Array.isArray(object?.packet_commitment_sequences))
      obj.packet_commitment_sequences = object.packet_commitment_sequences.map((e: any) =>
        BigInt(e.toString()),
      );
    return obj;
  },
  toJSON(message: QueryPacketAcknowledgementsRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    if (message.packet_commitment_sequences) {
      obj.packet_commitment_sequences = message.packet_commitment_sequences.map((e) =>
        (e || BigInt(0)).toString(),
      );
    } else {
      obj.packet_commitment_sequences = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketAcknowledgementsRequest>, I>>(
    object: I,
  ): QueryPacketAcknowledgementsRequest {
    const message = createBaseQueryPacketAcknowledgementsRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    message.packet_commitment_sequences =
      object.packet_commitment_sequences?.map((e) => BigInt(e.toString())) || [];
    return message;
  },
};
function createBaseQueryPacketAcknowledgementsResponse(): QueryPacketAcknowledgementsResponse {
  return {
    acknowledgements: [],
    pagination: undefined,
    height: Height.fromPartial({}),
  };
}
export const QueryPacketAcknowledgementsResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryPacketAcknowledgementsResponse",
  encode(
    message: QueryPacketAcknowledgementsResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    for (const v of message.acknowledgements) {
      PacketState.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPacketAcknowledgementsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPacketAcknowledgementsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.acknowledgements.push(PacketState.decode(reader, reader.uint32()));
          break;
        case 2:
          message.pagination = PageResponse.decode(reader, reader.uint32());
          break;
        case 3:
          message.height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryPacketAcknowledgementsResponse {
    const obj = createBaseQueryPacketAcknowledgementsResponse();
    if (Array.isArray(object?.acknowledgements))
      obj.acknowledgements = object.acknowledgements.map((e: any) => PacketState.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    return obj;
  },
  toJSON(message: QueryPacketAcknowledgementsResponse): unknown {
    const obj: any = {};
    if (message.acknowledgements) {
      obj.acknowledgements = message.acknowledgements.map((e) => (e ? PacketState.toJSON(e) : undefined));
    } else {
      obj.acknowledgements = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPacketAcknowledgementsResponse>, I>>(
    object: I,
  ): QueryPacketAcknowledgementsResponse {
    const message = createBaseQueryPacketAcknowledgementsResponse();
    message.acknowledgements = object.acknowledgements?.map((e) => PacketState.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    return message;
  },
};
function createBaseQueryUnreceivedPacketsRequest(): QueryUnreceivedPacketsRequest {
  return {
    port_id: "",
    channel_id: "",
    packet_commitment_sequences: [],
  };
}
export const QueryUnreceivedPacketsRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryUnreceivedPacketsRequest",
  encode(message: QueryUnreceivedPacketsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    writer.uint32(26).fork();
    for (const v of message.packet_commitment_sequences) {
      writer.uint64(v);
    }
    writer.ldelim();
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUnreceivedPacketsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUnreceivedPacketsRequest();
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
          if ((tag & 7) === 2) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.packet_commitment_sequences.push(reader.uint64());
            }
          } else {
            message.packet_commitment_sequences.push(reader.uint64());
          }
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryUnreceivedPacketsRequest {
    const obj = createBaseQueryUnreceivedPacketsRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (Array.isArray(object?.packet_commitment_sequences))
      obj.packet_commitment_sequences = object.packet_commitment_sequences.map((e: any) =>
        BigInt(e.toString()),
      );
    return obj;
  },
  toJSON(message: QueryUnreceivedPacketsRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    if (message.packet_commitment_sequences) {
      obj.packet_commitment_sequences = message.packet_commitment_sequences.map((e) =>
        (e || BigInt(0)).toString(),
      );
    } else {
      obj.packet_commitment_sequences = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUnreceivedPacketsRequest>, I>>(
    object: I,
  ): QueryUnreceivedPacketsRequest {
    const message = createBaseQueryUnreceivedPacketsRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.packet_commitment_sequences =
      object.packet_commitment_sequences?.map((e) => BigInt(e.toString())) || [];
    return message;
  },
};
function createBaseQueryUnreceivedPacketsResponse(): QueryUnreceivedPacketsResponse {
  return {
    sequences: [],
    height: Height.fromPartial({}),
  };
}
export const QueryUnreceivedPacketsResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryUnreceivedPacketsResponse",
  encode(
    message: QueryUnreceivedPacketsResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    writer.uint32(10).fork();
    for (const v of message.sequences) {
      writer.uint64(v);
    }
    writer.ldelim();
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUnreceivedPacketsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUnreceivedPacketsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if ((tag & 7) === 2) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.sequences.push(reader.uint64());
            }
          } else {
            message.sequences.push(reader.uint64());
          }
          break;
        case 2:
          message.height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryUnreceivedPacketsResponse {
    const obj = createBaseQueryUnreceivedPacketsResponse();
    if (Array.isArray(object?.sequences))
      obj.sequences = object.sequences.map((e: any) => BigInt(e.toString()));
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    return obj;
  },
  toJSON(message: QueryUnreceivedPacketsResponse): unknown {
    const obj: any = {};
    if (message.sequences) {
      obj.sequences = message.sequences.map((e) => (e || BigInt(0)).toString());
    } else {
      obj.sequences = [];
    }
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUnreceivedPacketsResponse>, I>>(
    object: I,
  ): QueryUnreceivedPacketsResponse {
    const message = createBaseQueryUnreceivedPacketsResponse();
    message.sequences = object.sequences?.map((e) => BigInt(e.toString())) || [];
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    return message;
  },
};
function createBaseQueryUnreceivedAcksRequest(): QueryUnreceivedAcksRequest {
  return {
    port_id: "",
    channel_id: "",
    packet_ack_sequences: [],
  };
}
export const QueryUnreceivedAcksRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryUnreceivedAcksRequest",
  encode(message: QueryUnreceivedAcksRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    writer.uint32(26).fork();
    for (const v of message.packet_ack_sequences) {
      writer.uint64(v);
    }
    writer.ldelim();
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUnreceivedAcksRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUnreceivedAcksRequest();
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
          if ((tag & 7) === 2) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.packet_ack_sequences.push(reader.uint64());
            }
          } else {
            message.packet_ack_sequences.push(reader.uint64());
          }
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryUnreceivedAcksRequest {
    const obj = createBaseQueryUnreceivedAcksRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (Array.isArray(object?.packet_ack_sequences))
      obj.packet_ack_sequences = object.packet_ack_sequences.map((e: any) => BigInt(e.toString()));
    return obj;
  },
  toJSON(message: QueryUnreceivedAcksRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    if (message.packet_ack_sequences) {
      obj.packet_ack_sequences = message.packet_ack_sequences.map((e) => (e || BigInt(0)).toString());
    } else {
      obj.packet_ack_sequences = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUnreceivedAcksRequest>, I>>(
    object: I,
  ): QueryUnreceivedAcksRequest {
    const message = createBaseQueryUnreceivedAcksRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.packet_ack_sequences = object.packet_ack_sequences?.map((e) => BigInt(e.toString())) || [];
    return message;
  },
};
function createBaseQueryUnreceivedAcksResponse(): QueryUnreceivedAcksResponse {
  return {
    sequences: [],
    height: Height.fromPartial({}),
  };
}
export const QueryUnreceivedAcksResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryUnreceivedAcksResponse",
  encode(message: QueryUnreceivedAcksResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    writer.uint32(10).fork();
    for (const v of message.sequences) {
      writer.uint64(v);
    }
    writer.ldelim();
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUnreceivedAcksResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryUnreceivedAcksResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if ((tag & 7) === 2) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.sequences.push(reader.uint64());
            }
          } else {
            message.sequences.push(reader.uint64());
          }
          break;
        case 2:
          message.height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryUnreceivedAcksResponse {
    const obj = createBaseQueryUnreceivedAcksResponse();
    if (Array.isArray(object?.sequences))
      obj.sequences = object.sequences.map((e: any) => BigInt(e.toString()));
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    return obj;
  },
  toJSON(message: QueryUnreceivedAcksResponse): unknown {
    const obj: any = {};
    if (message.sequences) {
      obj.sequences = message.sequences.map((e) => (e || BigInt(0)).toString());
    } else {
      obj.sequences = [];
    }
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryUnreceivedAcksResponse>, I>>(
    object: I,
  ): QueryUnreceivedAcksResponse {
    const message = createBaseQueryUnreceivedAcksResponse();
    message.sequences = object.sequences?.map((e) => BigInt(e.toString())) || [];
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    return message;
  },
};
function createBaseQueryNextSequenceReceiveRequest(): QueryNextSequenceReceiveRequest {
  return {
    port_id: "",
    channel_id: "",
  };
}
export const QueryNextSequenceReceiveRequest = {
  typeUrl: "/ibc.core.channel.v1.QueryNextSequenceReceiveRequest",
  encode(
    message: QueryNextSequenceReceiveRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryNextSequenceReceiveRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryNextSequenceReceiveRequest();
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
  fromJSON(object: any): QueryNextSequenceReceiveRequest {
    const obj = createBaseQueryNextSequenceReceiveRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: QueryNextSequenceReceiveRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryNextSequenceReceiveRequest>, I>>(
    object: I,
  ): QueryNextSequenceReceiveRequest {
    const message = createBaseQueryNextSequenceReceiveRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  },
};
function createBaseQueryNextSequenceReceiveResponse(): QueryNextSequenceReceiveResponse {
  return {
    next_sequence_receive: BigInt(0),
    proof: new Uint8Array(),
    proof_height: Height.fromPartial({}),
  };
}
export const QueryNextSequenceReceiveResponse = {
  typeUrl: "/ibc.core.channel.v1.QueryNextSequenceReceiveResponse",
  encode(
    message: QueryNextSequenceReceiveResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.next_sequence_receive !== BigInt(0)) {
      writer.uint32(8).uint64(message.next_sequence_receive);
    }
    if (message.proof.length !== 0) {
      writer.uint32(18).bytes(message.proof);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryNextSequenceReceiveResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryNextSequenceReceiveResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.next_sequence_receive = reader.uint64();
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
  fromJSON(object: any): QueryNextSequenceReceiveResponse {
    const obj = createBaseQueryNextSequenceReceiveResponse();
    if (isSet(object.next_sequence_receive))
      obj.next_sequence_receive = BigInt(object.next_sequence_receive.toString());
    if (isSet(object.proof)) obj.proof = bytesFromBase64(object.proof);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: QueryNextSequenceReceiveResponse): unknown {
    const obj: any = {};
    message.next_sequence_receive !== undefined &&
      (obj.next_sequence_receive = (message.next_sequence_receive || BigInt(0)).toString());
    message.proof !== undefined &&
      (obj.proof = base64FromBytes(message.proof !== undefined ? message.proof : new Uint8Array()));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryNextSequenceReceiveResponse>, I>>(
    object: I,
  ): QueryNextSequenceReceiveResponse {
    const message = createBaseQueryNextSequenceReceiveResponse();
    if (object.next_sequence_receive !== undefined && object.next_sequence_receive !== null) {
      message.next_sequence_receive = BigInt(object.next_sequence_receive.toString());
    }
    message.proof = object.proof ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
/** Query provides defines the gRPC querier service */
export interface Query {
  /** Channel queries an IBC Channel. */
  Channel(request: QueryChannelRequest): Promise<QueryChannelResponse>;
  /** Channels queries all the IBC channels of a chain. */
  Channels(request?: QueryChannelsRequest): Promise<QueryChannelsResponse>;
  /**
   * ConnectionChannels queries all the channels associated with a connection
   * end.
   */
  ConnectionChannels(request: QueryConnectionChannelsRequest): Promise<QueryConnectionChannelsResponse>;
  /**
   * ChannelClientState queries for the client state for the channel associated
   * with the provided channel identifiers.
   */
  ChannelClientState(request: QueryChannelClientStateRequest): Promise<QueryChannelClientStateResponse>;
  /**
   * ChannelConsensusState queries for the consensus state for the channel
   * associated with the provided channel identifiers.
   */
  ChannelConsensusState(
    request: QueryChannelConsensusStateRequest,
  ): Promise<QueryChannelConsensusStateResponse>;
  /** PacketCommitment queries a stored packet commitment hash. */
  PacketCommitment(request: QueryPacketCommitmentRequest): Promise<QueryPacketCommitmentResponse>;
  /**
   * PacketCommitments returns all the packet commitments hashes associated
   * with a channel.
   */
  PacketCommitments(request: QueryPacketCommitmentsRequest): Promise<QueryPacketCommitmentsResponse>;
  /**
   * PacketReceipt queries if a given packet sequence has been received on the
   * queried chain
   */
  PacketReceipt(request: QueryPacketReceiptRequest): Promise<QueryPacketReceiptResponse>;
  /** PacketAcknowledgement queries a stored packet acknowledgement hash. */
  PacketAcknowledgement(
    request: QueryPacketAcknowledgementRequest,
  ): Promise<QueryPacketAcknowledgementResponse>;
  /**
   * PacketAcknowledgements returns all the packet acknowledgements associated
   * with a channel.
   */
  PacketAcknowledgements(
    request: QueryPacketAcknowledgementsRequest,
  ): Promise<QueryPacketAcknowledgementsResponse>;
  /**
   * UnreceivedPackets returns all the unreceived IBC packets associated with a
   * channel and sequences.
   */
  UnreceivedPackets(request: QueryUnreceivedPacketsRequest): Promise<QueryUnreceivedPacketsResponse>;
  /**
   * UnreceivedAcks returns all the unreceived IBC acknowledgements associated
   * with a channel and sequences.
   */
  UnreceivedAcks(request: QueryUnreceivedAcksRequest): Promise<QueryUnreceivedAcksResponse>;
  /** NextSequenceReceive returns the next receive sequence for a given channel. */
  NextSequenceReceive(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.Channel = this.Channel.bind(this);
    this.Channels = this.Channels.bind(this);
    this.ConnectionChannels = this.ConnectionChannels.bind(this);
    this.ChannelClientState = this.ChannelClientState.bind(this);
    this.ChannelConsensusState = this.ChannelConsensusState.bind(this);
    this.PacketCommitment = this.PacketCommitment.bind(this);
    this.PacketCommitments = this.PacketCommitments.bind(this);
    this.PacketReceipt = this.PacketReceipt.bind(this);
    this.PacketAcknowledgement = this.PacketAcknowledgement.bind(this);
    this.PacketAcknowledgements = this.PacketAcknowledgements.bind(this);
    this.UnreceivedPackets = this.UnreceivedPackets.bind(this);
    this.UnreceivedAcks = this.UnreceivedAcks.bind(this);
    this.NextSequenceReceive = this.NextSequenceReceive.bind(this);
  }
  Channel(request: QueryChannelRequest): Promise<QueryChannelResponse> {
    const data = QueryChannelRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "Channel", data);
    return promise.then((data) => QueryChannelResponse.decode(new BinaryReader(data)));
  }
  Channels(
    request: QueryChannelsRequest = {
      pagination: PageRequest.fromPartial({}),
    },
  ): Promise<QueryChannelsResponse> {
    const data = QueryChannelsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "Channels", data);
    return promise.then((data) => QueryChannelsResponse.decode(new BinaryReader(data)));
  }
  ConnectionChannels(request: QueryConnectionChannelsRequest): Promise<QueryConnectionChannelsResponse> {
    const data = QueryConnectionChannelsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "ConnectionChannels", data);
    return promise.then((data) => QueryConnectionChannelsResponse.decode(new BinaryReader(data)));
  }
  ChannelClientState(request: QueryChannelClientStateRequest): Promise<QueryChannelClientStateResponse> {
    const data = QueryChannelClientStateRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "ChannelClientState", data);
    return promise.then((data) => QueryChannelClientStateResponse.decode(new BinaryReader(data)));
  }
  ChannelConsensusState(
    request: QueryChannelConsensusStateRequest,
  ): Promise<QueryChannelConsensusStateResponse> {
    const data = QueryChannelConsensusStateRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "ChannelConsensusState", data);
    return promise.then((data) => QueryChannelConsensusStateResponse.decode(new BinaryReader(data)));
  }
  PacketCommitment(request: QueryPacketCommitmentRequest): Promise<QueryPacketCommitmentResponse> {
    const data = QueryPacketCommitmentRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "PacketCommitment", data);
    return promise.then((data) => QueryPacketCommitmentResponse.decode(new BinaryReader(data)));
  }
  PacketCommitments(request: QueryPacketCommitmentsRequest): Promise<QueryPacketCommitmentsResponse> {
    const data = QueryPacketCommitmentsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "PacketCommitments", data);
    return promise.then((data) => QueryPacketCommitmentsResponse.decode(new BinaryReader(data)));
  }
  PacketReceipt(request: QueryPacketReceiptRequest): Promise<QueryPacketReceiptResponse> {
    const data = QueryPacketReceiptRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "PacketReceipt", data);
    return promise.then((data) => QueryPacketReceiptResponse.decode(new BinaryReader(data)));
  }
  PacketAcknowledgement(
    request: QueryPacketAcknowledgementRequest,
  ): Promise<QueryPacketAcknowledgementResponse> {
    const data = QueryPacketAcknowledgementRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "PacketAcknowledgement", data);
    return promise.then((data) => QueryPacketAcknowledgementResponse.decode(new BinaryReader(data)));
  }
  PacketAcknowledgements(
    request: QueryPacketAcknowledgementsRequest,
  ): Promise<QueryPacketAcknowledgementsResponse> {
    const data = QueryPacketAcknowledgementsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "PacketAcknowledgements", data);
    return promise.then((data) => QueryPacketAcknowledgementsResponse.decode(new BinaryReader(data)));
  }
  UnreceivedPackets(request: QueryUnreceivedPacketsRequest): Promise<QueryUnreceivedPacketsResponse> {
    const data = QueryUnreceivedPacketsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "UnreceivedPackets", data);
    return promise.then((data) => QueryUnreceivedPacketsResponse.decode(new BinaryReader(data)));
  }
  UnreceivedAcks(request: QueryUnreceivedAcksRequest): Promise<QueryUnreceivedAcksResponse> {
    const data = QueryUnreceivedAcksRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "UnreceivedAcks", data);
    return promise.then((data) => QueryUnreceivedAcksResponse.decode(new BinaryReader(data)));
  }
  NextSequenceReceive(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse> {
    const data = QueryNextSequenceReceiveRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Query", "NextSequenceReceive", data);
    return promise.then((data) => QueryNextSequenceReceiveResponse.decode(new BinaryReader(data)));
  }
}
