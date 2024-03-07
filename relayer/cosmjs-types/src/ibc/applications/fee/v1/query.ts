/* eslint-disable */
import { PageRequest } from "../../../../cosmos/base/query/v1beta1/pagination";
import { PacketId } from "../../../core/channel/v1/channel";
import { IdentifiedPacketFees } from "./fee";
import { Coin } from "../../../../cosmos/base/v1beta1/coin";
import { FeeEnabledChannel } from "./genesis";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.applications.fee.v1";
/** QueryIncentivizedPacketsRequest defines the request type for the IncentivizedPackets rpc */
export interface QueryIncentivizedPacketsRequest {
  /** pagination defines an optional pagination for the request. */
  pagination?: PageRequest;
  /** block height at which to query */
  query_height: bigint;
}
/** QueryIncentivizedPacketsResponse defines the response type for the IncentivizedPackets rpc */
export interface QueryIncentivizedPacketsResponse {
  /** list of identified fees for incentivized packets */
  incentivized_packets: IdentifiedPacketFees[];
}
/** QueryIncentivizedPacketRequest defines the request type for the IncentivizedPacket rpc */
export interface QueryIncentivizedPacketRequest {
  /** unique packet identifier comprised of channel ID, port ID and sequence */
  packet_id: PacketId;
  /** block height at which to query */
  query_height: bigint;
}
/** QueryIncentivizedPacketsResponse defines the response type for the IncentivizedPacket rpc */
export interface QueryIncentivizedPacketResponse {
  /** the identified fees for the incentivized packet */
  incentivized_packet: IdentifiedPacketFees;
}
/**
 * QueryIncentivizedPacketsForChannelRequest defines the request type for querying for all incentivized packets
 * for a specific channel
 */
export interface QueryIncentivizedPacketsForChannelRequest {
  /** pagination defines an optional pagination for the request. */
  pagination?: PageRequest;
  port_id: string;
  channel_id: string;
  /** Height to query at */
  query_height: bigint;
}
/** QueryIncentivizedPacketsResponse defines the response type for the incentivized packets RPC */
export interface QueryIncentivizedPacketsForChannelResponse {
  /** Map of all incentivized_packets */
  incentivized_packets: IdentifiedPacketFees[];
}
/** QueryTotalRecvFeesRequest defines the request type for the TotalRecvFees rpc */
export interface QueryTotalRecvFeesRequest {
  /** the packet identifier for the associated fees */
  packet_id: PacketId;
}
/** QueryTotalRecvFeesResponse defines the response type for the TotalRecvFees rpc */
export interface QueryTotalRecvFeesResponse {
  /** the total packet receive fees */
  recv_fees: Coin[];
}
/** QueryTotalAckFeesRequest defines the request type for the TotalAckFees rpc */
export interface QueryTotalAckFeesRequest {
  /** the packet identifier for the associated fees */
  packet_id: PacketId;
}
/** QueryTotalAckFeesResponse defines the response type for the TotalAckFees rpc */
export interface QueryTotalAckFeesResponse {
  /** the total packet acknowledgement fees */
  ack_fees: Coin[];
}
/** QueryTotalTimeoutFeesRequest defines the request type for the TotalTimeoutFees rpc */
export interface QueryTotalTimeoutFeesRequest {
  /** the packet identifier for the associated fees */
  packet_id: PacketId;
}
/** QueryTotalTimeoutFeesResponse defines the response type for the TotalTimeoutFees rpc */
export interface QueryTotalTimeoutFeesResponse {
  /** the total packet timeout fees */
  timeout_fees: Coin[];
}
/** QueryPayeeRequest defines the request type for the Payee rpc */
export interface QueryPayeeRequest {
  /** unique channel identifier */
  channel_id: string;
  /** the relayer address to which the distribution address is registered */
  relayer: string;
}
/** QueryPayeeResponse defines the response type for the Payee rpc */
export interface QueryPayeeResponse {
  /** the payee address to which packet fees are paid out */
  payee_address: string;
}
/** QueryCounterpartyPayeeRequest defines the request type for the CounterpartyPayee rpc */
export interface QueryCounterpartyPayeeRequest {
  /** unique channel identifier */
  channel_id: string;
  /** the relayer address to which the counterparty is registered */
  relayer: string;
}
/** QueryCounterpartyPayeeResponse defines the response type for the CounterpartyPayee rpc */
export interface QueryCounterpartyPayeeResponse {
  /** the counterparty payee address used to compensate forward relaying */
  counterparty_payee: string;
}
/** QueryFeeEnabledChannelsRequest defines the request type for the FeeEnabledChannels rpc */
export interface QueryFeeEnabledChannelsRequest {
  /** pagination defines an optional pagination for the request. */
  pagination?: PageRequest;
  /** block height at which to query */
  query_height: bigint;
}
/** QueryFeeEnabledChannelsResponse defines the response type for the FeeEnabledChannels rpc */
export interface QueryFeeEnabledChannelsResponse {
  /** list of fee enabled channels */
  fee_enabled_channels: FeeEnabledChannel[];
}
/** QueryFeeEnabledChannelRequest defines the request type for the FeeEnabledChannel rpc */
export interface QueryFeeEnabledChannelRequest {
  /** unique port identifier */
  port_id: string;
  /** unique channel identifier */
  channel_id: string;
}
/** QueryFeeEnabledChannelResponse defines the response type for the FeeEnabledChannel rpc */
export interface QueryFeeEnabledChannelResponse {
  /** boolean flag representing the fee enabled channel status */
  fee_enabled: boolean;
}
function createBaseQueryIncentivizedPacketsRequest(): QueryIncentivizedPacketsRequest {
  return {
    pagination: undefined,
    query_height: BigInt(0)
  };
}
export const QueryIncentivizedPacketsRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryIncentivizedPacketsRequest",
  encode(message: QueryIncentivizedPacketsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    if (message.query_height !== BigInt(0)) {
      writer.uint32(16).uint64(message.query_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIncentivizedPacketsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIncentivizedPacketsRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        case 2:
          message.query_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIncentivizedPacketsRequest {
    const obj = createBaseQueryIncentivizedPacketsRequest();
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    if (isSet(object.query_height)) obj.query_height = BigInt(object.query_height.toString());
    return obj;
  },
  toJSON(message: QueryIncentivizedPacketsRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined && (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    message.query_height !== undefined && (obj.query_height = (message.query_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIncentivizedPacketsRequest>, I>>(object: I): QueryIncentivizedPacketsRequest {
    const message = createBaseQueryIncentivizedPacketsRequest();
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    if (object.query_height !== undefined && object.query_height !== null) {
      message.query_height = BigInt(object.query_height.toString());
    }
    return message;
  }
};
function createBaseQueryIncentivizedPacketsResponse(): QueryIncentivizedPacketsResponse {
  return {
    incentivized_packets: []
  };
}
export const QueryIncentivizedPacketsResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryIncentivizedPacketsResponse",
  encode(message: QueryIncentivizedPacketsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.incentivized_packets) {
      IdentifiedPacketFees.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIncentivizedPacketsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIncentivizedPacketsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.incentivized_packets.push(IdentifiedPacketFees.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIncentivizedPacketsResponse {
    const obj = createBaseQueryIncentivizedPacketsResponse();
    if (Array.isArray(object?.incentivized_packets)) obj.incentivized_packets = object.incentivized_packets.map((e: any) => IdentifiedPacketFees.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryIncentivizedPacketsResponse): unknown {
    const obj: any = {};
    if (message.incentivized_packets) {
      obj.incentivized_packets = message.incentivized_packets.map(e => e ? IdentifiedPacketFees.toJSON(e) : undefined);
    } else {
      obj.incentivized_packets = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIncentivizedPacketsResponse>, I>>(object: I): QueryIncentivizedPacketsResponse {
    const message = createBaseQueryIncentivizedPacketsResponse();
    message.incentivized_packets = object.incentivized_packets?.map(e => IdentifiedPacketFees.fromPartial(e)) || [];
    return message;
  }
};
function createBaseQueryIncentivizedPacketRequest(): QueryIncentivizedPacketRequest {
  return {
    packet_id: PacketId.fromPartial({}),
    query_height: BigInt(0)
  };
}
export const QueryIncentivizedPacketRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryIncentivizedPacketRequest",
  encode(message: QueryIncentivizedPacketRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet_id !== undefined) {
      PacketId.encode(message.packet_id, writer.uint32(10).fork()).ldelim();
    }
    if (message.query_height !== BigInt(0)) {
      writer.uint32(16).uint64(message.query_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIncentivizedPacketRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIncentivizedPacketRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_id = PacketId.decode(reader, reader.uint32());
          break;
        case 2:
          message.query_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIncentivizedPacketRequest {
    const obj = createBaseQueryIncentivizedPacketRequest();
    if (isSet(object.packet_id)) obj.packet_id = PacketId.fromJSON(object.packet_id);
    if (isSet(object.query_height)) obj.query_height = BigInt(object.query_height.toString());
    return obj;
  },
  toJSON(message: QueryIncentivizedPacketRequest): unknown {
    const obj: any = {};
    message.packet_id !== undefined && (obj.packet_id = message.packet_id ? PacketId.toJSON(message.packet_id) : undefined);
    message.query_height !== undefined && (obj.query_height = (message.query_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIncentivizedPacketRequest>, I>>(object: I): QueryIncentivizedPacketRequest {
    const message = createBaseQueryIncentivizedPacketRequest();
    if (object.packet_id !== undefined && object.packet_id !== null) {
      message.packet_id = PacketId.fromPartial(object.packet_id);
    }
    if (object.query_height !== undefined && object.query_height !== null) {
      message.query_height = BigInt(object.query_height.toString());
    }
    return message;
  }
};
function createBaseQueryIncentivizedPacketResponse(): QueryIncentivizedPacketResponse {
  return {
    incentivized_packet: IdentifiedPacketFees.fromPartial({})
  };
}
export const QueryIncentivizedPacketResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryIncentivizedPacketResponse",
  encode(message: QueryIncentivizedPacketResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.incentivized_packet !== undefined) {
      IdentifiedPacketFees.encode(message.incentivized_packet, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIncentivizedPacketResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIncentivizedPacketResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.incentivized_packet = IdentifiedPacketFees.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIncentivizedPacketResponse {
    const obj = createBaseQueryIncentivizedPacketResponse();
    if (isSet(object.incentivized_packet)) obj.incentivized_packet = IdentifiedPacketFees.fromJSON(object.incentivized_packet);
    return obj;
  },
  toJSON(message: QueryIncentivizedPacketResponse): unknown {
    const obj: any = {};
    message.incentivized_packet !== undefined && (obj.incentivized_packet = message.incentivized_packet ? IdentifiedPacketFees.toJSON(message.incentivized_packet) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIncentivizedPacketResponse>, I>>(object: I): QueryIncentivizedPacketResponse {
    const message = createBaseQueryIncentivizedPacketResponse();
    if (object.incentivized_packet !== undefined && object.incentivized_packet !== null) {
      message.incentivized_packet = IdentifiedPacketFees.fromPartial(object.incentivized_packet);
    }
    return message;
  }
};
function createBaseQueryIncentivizedPacketsForChannelRequest(): QueryIncentivizedPacketsForChannelRequest {
  return {
    pagination: undefined,
    port_id: "",
    channel_id: "",
    query_height: BigInt(0)
  };
}
export const QueryIncentivizedPacketsForChannelRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryIncentivizedPacketsForChannelRequest",
  encode(message: QueryIncentivizedPacketsForChannelRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    if (message.port_id !== "") {
      writer.uint32(18).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(26).string(message.channel_id);
    }
    if (message.query_height !== BigInt(0)) {
      writer.uint32(32).uint64(message.query_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIncentivizedPacketsForChannelRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIncentivizedPacketsForChannelRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        case 2:
          message.port_id = reader.string();
          break;
        case 3:
          message.channel_id = reader.string();
          break;
        case 4:
          message.query_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIncentivizedPacketsForChannelRequest {
    const obj = createBaseQueryIncentivizedPacketsForChannelRequest();
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.query_height)) obj.query_height = BigInt(object.query_height.toString());
    return obj;
  },
  toJSON(message: QueryIncentivizedPacketsForChannelRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined && (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.query_height !== undefined && (obj.query_height = (message.query_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIncentivizedPacketsForChannelRequest>, I>>(object: I): QueryIncentivizedPacketsForChannelRequest {
    const message = createBaseQueryIncentivizedPacketsForChannelRequest();
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.query_height !== undefined && object.query_height !== null) {
      message.query_height = BigInt(object.query_height.toString());
    }
    return message;
  }
};
function createBaseQueryIncentivizedPacketsForChannelResponse(): QueryIncentivizedPacketsForChannelResponse {
  return {
    incentivized_packets: []
  };
}
export const QueryIncentivizedPacketsForChannelResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryIncentivizedPacketsForChannelResponse",
  encode(message: QueryIncentivizedPacketsForChannelResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.incentivized_packets) {
      IdentifiedPacketFees.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIncentivizedPacketsForChannelResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIncentivizedPacketsForChannelResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.incentivized_packets.push(IdentifiedPacketFees.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIncentivizedPacketsForChannelResponse {
    const obj = createBaseQueryIncentivizedPacketsForChannelResponse();
    if (Array.isArray(object?.incentivized_packets)) obj.incentivized_packets = object.incentivized_packets.map((e: any) => IdentifiedPacketFees.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryIncentivizedPacketsForChannelResponse): unknown {
    const obj: any = {};
    if (message.incentivized_packets) {
      obj.incentivized_packets = message.incentivized_packets.map(e => e ? IdentifiedPacketFees.toJSON(e) : undefined);
    } else {
      obj.incentivized_packets = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIncentivizedPacketsForChannelResponse>, I>>(object: I): QueryIncentivizedPacketsForChannelResponse {
    const message = createBaseQueryIncentivizedPacketsForChannelResponse();
    message.incentivized_packets = object.incentivized_packets?.map(e => IdentifiedPacketFees.fromPartial(e)) || [];
    return message;
  }
};
function createBaseQueryTotalRecvFeesRequest(): QueryTotalRecvFeesRequest {
  return {
    packet_id: PacketId.fromPartial({})
  };
}
export const QueryTotalRecvFeesRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryTotalRecvFeesRequest",
  encode(message: QueryTotalRecvFeesRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet_id !== undefined) {
      PacketId.encode(message.packet_id, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTotalRecvFeesRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTotalRecvFeesRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_id = PacketId.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTotalRecvFeesRequest {
    const obj = createBaseQueryTotalRecvFeesRequest();
    if (isSet(object.packet_id)) obj.packet_id = PacketId.fromJSON(object.packet_id);
    return obj;
  },
  toJSON(message: QueryTotalRecvFeesRequest): unknown {
    const obj: any = {};
    message.packet_id !== undefined && (obj.packet_id = message.packet_id ? PacketId.toJSON(message.packet_id) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTotalRecvFeesRequest>, I>>(object: I): QueryTotalRecvFeesRequest {
    const message = createBaseQueryTotalRecvFeesRequest();
    if (object.packet_id !== undefined && object.packet_id !== null) {
      message.packet_id = PacketId.fromPartial(object.packet_id);
    }
    return message;
  }
};
function createBaseQueryTotalRecvFeesResponse(): QueryTotalRecvFeesResponse {
  return {
    recv_fees: []
  };
}
export const QueryTotalRecvFeesResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryTotalRecvFeesResponse",
  encode(message: QueryTotalRecvFeesResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.recv_fees) {
      Coin.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTotalRecvFeesResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTotalRecvFeesResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.recv_fees.push(Coin.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTotalRecvFeesResponse {
    const obj = createBaseQueryTotalRecvFeesResponse();
    if (Array.isArray(object?.recv_fees)) obj.recv_fees = object.recv_fees.map((e: any) => Coin.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryTotalRecvFeesResponse): unknown {
    const obj: any = {};
    if (message.recv_fees) {
      obj.recv_fees = message.recv_fees.map(e => e ? Coin.toJSON(e) : undefined);
    } else {
      obj.recv_fees = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTotalRecvFeesResponse>, I>>(object: I): QueryTotalRecvFeesResponse {
    const message = createBaseQueryTotalRecvFeesResponse();
    message.recv_fees = object.recv_fees?.map(e => Coin.fromPartial(e)) || [];
    return message;
  }
};
function createBaseQueryTotalAckFeesRequest(): QueryTotalAckFeesRequest {
  return {
    packet_id: PacketId.fromPartial({})
  };
}
export const QueryTotalAckFeesRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryTotalAckFeesRequest",
  encode(message: QueryTotalAckFeesRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet_id !== undefined) {
      PacketId.encode(message.packet_id, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTotalAckFeesRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTotalAckFeesRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_id = PacketId.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTotalAckFeesRequest {
    const obj = createBaseQueryTotalAckFeesRequest();
    if (isSet(object.packet_id)) obj.packet_id = PacketId.fromJSON(object.packet_id);
    return obj;
  },
  toJSON(message: QueryTotalAckFeesRequest): unknown {
    const obj: any = {};
    message.packet_id !== undefined && (obj.packet_id = message.packet_id ? PacketId.toJSON(message.packet_id) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTotalAckFeesRequest>, I>>(object: I): QueryTotalAckFeesRequest {
    const message = createBaseQueryTotalAckFeesRequest();
    if (object.packet_id !== undefined && object.packet_id !== null) {
      message.packet_id = PacketId.fromPartial(object.packet_id);
    }
    return message;
  }
};
function createBaseQueryTotalAckFeesResponse(): QueryTotalAckFeesResponse {
  return {
    ack_fees: []
  };
}
export const QueryTotalAckFeesResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryTotalAckFeesResponse",
  encode(message: QueryTotalAckFeesResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.ack_fees) {
      Coin.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTotalAckFeesResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTotalAckFeesResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.ack_fees.push(Coin.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTotalAckFeesResponse {
    const obj = createBaseQueryTotalAckFeesResponse();
    if (Array.isArray(object?.ack_fees)) obj.ack_fees = object.ack_fees.map((e: any) => Coin.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryTotalAckFeesResponse): unknown {
    const obj: any = {};
    if (message.ack_fees) {
      obj.ack_fees = message.ack_fees.map(e => e ? Coin.toJSON(e) : undefined);
    } else {
      obj.ack_fees = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTotalAckFeesResponse>, I>>(object: I): QueryTotalAckFeesResponse {
    const message = createBaseQueryTotalAckFeesResponse();
    message.ack_fees = object.ack_fees?.map(e => Coin.fromPartial(e)) || [];
    return message;
  }
};
function createBaseQueryTotalTimeoutFeesRequest(): QueryTotalTimeoutFeesRequest {
  return {
    packet_id: PacketId.fromPartial({})
  };
}
export const QueryTotalTimeoutFeesRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryTotalTimeoutFeesRequest",
  encode(message: QueryTotalTimeoutFeesRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet_id !== undefined) {
      PacketId.encode(message.packet_id, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTotalTimeoutFeesRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTotalTimeoutFeesRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_id = PacketId.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTotalTimeoutFeesRequest {
    const obj = createBaseQueryTotalTimeoutFeesRequest();
    if (isSet(object.packet_id)) obj.packet_id = PacketId.fromJSON(object.packet_id);
    return obj;
  },
  toJSON(message: QueryTotalTimeoutFeesRequest): unknown {
    const obj: any = {};
    message.packet_id !== undefined && (obj.packet_id = message.packet_id ? PacketId.toJSON(message.packet_id) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTotalTimeoutFeesRequest>, I>>(object: I): QueryTotalTimeoutFeesRequest {
    const message = createBaseQueryTotalTimeoutFeesRequest();
    if (object.packet_id !== undefined && object.packet_id !== null) {
      message.packet_id = PacketId.fromPartial(object.packet_id);
    }
    return message;
  }
};
function createBaseQueryTotalTimeoutFeesResponse(): QueryTotalTimeoutFeesResponse {
  return {
    timeout_fees: []
  };
}
export const QueryTotalTimeoutFeesResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryTotalTimeoutFeesResponse",
  encode(message: QueryTotalTimeoutFeesResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.timeout_fees) {
      Coin.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTotalTimeoutFeesResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTotalTimeoutFeesResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.timeout_fees.push(Coin.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTotalTimeoutFeesResponse {
    const obj = createBaseQueryTotalTimeoutFeesResponse();
    if (Array.isArray(object?.timeout_fees)) obj.timeout_fees = object.timeout_fees.map((e: any) => Coin.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryTotalTimeoutFeesResponse): unknown {
    const obj: any = {};
    if (message.timeout_fees) {
      obj.timeout_fees = message.timeout_fees.map(e => e ? Coin.toJSON(e) : undefined);
    } else {
      obj.timeout_fees = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTotalTimeoutFeesResponse>, I>>(object: I): QueryTotalTimeoutFeesResponse {
    const message = createBaseQueryTotalTimeoutFeesResponse();
    message.timeout_fees = object.timeout_fees?.map(e => Coin.fromPartial(e)) || [];
    return message;
  }
};
function createBaseQueryPayeeRequest(): QueryPayeeRequest {
  return {
    channel_id: "",
    relayer: ""
  };
}
export const QueryPayeeRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryPayeeRequest",
  encode(message: QueryPayeeRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.channel_id !== "") {
      writer.uint32(10).string(message.channel_id);
    }
    if (message.relayer !== "") {
      writer.uint32(18).string(message.relayer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPayeeRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPayeeRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channel_id = reader.string();
          break;
        case 2:
          message.relayer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryPayeeRequest {
    const obj = createBaseQueryPayeeRequest();
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.relayer)) obj.relayer = String(object.relayer);
    return obj;
  },
  toJSON(message: QueryPayeeRequest): unknown {
    const obj: any = {};
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.relayer !== undefined && (obj.relayer = message.relayer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPayeeRequest>, I>>(object: I): QueryPayeeRequest {
    const message = createBaseQueryPayeeRequest();
    message.channel_id = object.channel_id ?? "";
    message.relayer = object.relayer ?? "";
    return message;
  }
};
function createBaseQueryPayeeResponse(): QueryPayeeResponse {
  return {
    payee_address: ""
  };
}
export const QueryPayeeResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryPayeeResponse",
  encode(message: QueryPayeeResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.payee_address !== "") {
      writer.uint32(10).string(message.payee_address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryPayeeResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryPayeeResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.payee_address = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryPayeeResponse {
    const obj = createBaseQueryPayeeResponse();
    if (isSet(object.payee_address)) obj.payee_address = String(object.payee_address);
    return obj;
  },
  toJSON(message: QueryPayeeResponse): unknown {
    const obj: any = {};
    message.payee_address !== undefined && (obj.payee_address = message.payee_address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryPayeeResponse>, I>>(object: I): QueryPayeeResponse {
    const message = createBaseQueryPayeeResponse();
    message.payee_address = object.payee_address ?? "";
    return message;
  }
};
function createBaseQueryCounterpartyPayeeRequest(): QueryCounterpartyPayeeRequest {
  return {
    channel_id: "",
    relayer: ""
  };
}
export const QueryCounterpartyPayeeRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryCounterpartyPayeeRequest",
  encode(message: QueryCounterpartyPayeeRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.channel_id !== "") {
      writer.uint32(10).string(message.channel_id);
    }
    if (message.relayer !== "") {
      writer.uint32(18).string(message.relayer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryCounterpartyPayeeRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryCounterpartyPayeeRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channel_id = reader.string();
          break;
        case 2:
          message.relayer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryCounterpartyPayeeRequest {
    const obj = createBaseQueryCounterpartyPayeeRequest();
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.relayer)) obj.relayer = String(object.relayer);
    return obj;
  },
  toJSON(message: QueryCounterpartyPayeeRequest): unknown {
    const obj: any = {};
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.relayer !== undefined && (obj.relayer = message.relayer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryCounterpartyPayeeRequest>, I>>(object: I): QueryCounterpartyPayeeRequest {
    const message = createBaseQueryCounterpartyPayeeRequest();
    message.channel_id = object.channel_id ?? "";
    message.relayer = object.relayer ?? "";
    return message;
  }
};
function createBaseQueryCounterpartyPayeeResponse(): QueryCounterpartyPayeeResponse {
  return {
    counterparty_payee: ""
  };
}
export const QueryCounterpartyPayeeResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryCounterpartyPayeeResponse",
  encode(message: QueryCounterpartyPayeeResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.counterparty_payee !== "") {
      writer.uint32(10).string(message.counterparty_payee);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryCounterpartyPayeeResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryCounterpartyPayeeResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.counterparty_payee = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryCounterpartyPayeeResponse {
    const obj = createBaseQueryCounterpartyPayeeResponse();
    if (isSet(object.counterparty_payee)) obj.counterparty_payee = String(object.counterparty_payee);
    return obj;
  },
  toJSON(message: QueryCounterpartyPayeeResponse): unknown {
    const obj: any = {};
    message.counterparty_payee !== undefined && (obj.counterparty_payee = message.counterparty_payee);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryCounterpartyPayeeResponse>, I>>(object: I): QueryCounterpartyPayeeResponse {
    const message = createBaseQueryCounterpartyPayeeResponse();
    message.counterparty_payee = object.counterparty_payee ?? "";
    return message;
  }
};
function createBaseQueryFeeEnabledChannelsRequest(): QueryFeeEnabledChannelsRequest {
  return {
    pagination: undefined,
    query_height: BigInt(0)
  };
}
export const QueryFeeEnabledChannelsRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryFeeEnabledChannelsRequest",
  encode(message: QueryFeeEnabledChannelsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    if (message.query_height !== BigInt(0)) {
      writer.uint32(16).uint64(message.query_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryFeeEnabledChannelsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryFeeEnabledChannelsRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pagination = PageRequest.decode(reader, reader.uint32());
          break;
        case 2:
          message.query_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryFeeEnabledChannelsRequest {
    const obj = createBaseQueryFeeEnabledChannelsRequest();
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    if (isSet(object.query_height)) obj.query_height = BigInt(object.query_height.toString());
    return obj;
  },
  toJSON(message: QueryFeeEnabledChannelsRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined && (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    message.query_height !== undefined && (obj.query_height = (message.query_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryFeeEnabledChannelsRequest>, I>>(object: I): QueryFeeEnabledChannelsRequest {
    const message = createBaseQueryFeeEnabledChannelsRequest();
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    if (object.query_height !== undefined && object.query_height !== null) {
      message.query_height = BigInt(object.query_height.toString());
    }
    return message;
  }
};
function createBaseQueryFeeEnabledChannelsResponse(): QueryFeeEnabledChannelsResponse {
  return {
    fee_enabled_channels: []
  };
}
export const QueryFeeEnabledChannelsResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryFeeEnabledChannelsResponse",
  encode(message: QueryFeeEnabledChannelsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.fee_enabled_channels) {
      FeeEnabledChannel.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryFeeEnabledChannelsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryFeeEnabledChannelsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.fee_enabled_channels.push(FeeEnabledChannel.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryFeeEnabledChannelsResponse {
    const obj = createBaseQueryFeeEnabledChannelsResponse();
    if (Array.isArray(object?.fee_enabled_channels)) obj.fee_enabled_channels = object.fee_enabled_channels.map((e: any) => FeeEnabledChannel.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryFeeEnabledChannelsResponse): unknown {
    const obj: any = {};
    if (message.fee_enabled_channels) {
      obj.fee_enabled_channels = message.fee_enabled_channels.map(e => e ? FeeEnabledChannel.toJSON(e) : undefined);
    } else {
      obj.fee_enabled_channels = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryFeeEnabledChannelsResponse>, I>>(object: I): QueryFeeEnabledChannelsResponse {
    const message = createBaseQueryFeeEnabledChannelsResponse();
    message.fee_enabled_channels = object.fee_enabled_channels?.map(e => FeeEnabledChannel.fromPartial(e)) || [];
    return message;
  }
};
function createBaseQueryFeeEnabledChannelRequest(): QueryFeeEnabledChannelRequest {
  return {
    port_id: "",
    channel_id: ""
  };
}
export const QueryFeeEnabledChannelRequest = {
  typeUrl: "/ibc.applications.fee.v1.QueryFeeEnabledChannelRequest",
  encode(message: QueryFeeEnabledChannelRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryFeeEnabledChannelRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryFeeEnabledChannelRequest();
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
  fromJSON(object: any): QueryFeeEnabledChannelRequest {
    const obj = createBaseQueryFeeEnabledChannelRequest();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: QueryFeeEnabledChannelRequest): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryFeeEnabledChannelRequest>, I>>(object: I): QueryFeeEnabledChannelRequest {
    const message = createBaseQueryFeeEnabledChannelRequest();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  }
};
function createBaseQueryFeeEnabledChannelResponse(): QueryFeeEnabledChannelResponse {
  return {
    fee_enabled: false
  };
}
export const QueryFeeEnabledChannelResponse = {
  typeUrl: "/ibc.applications.fee.v1.QueryFeeEnabledChannelResponse",
  encode(message: QueryFeeEnabledChannelResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.fee_enabled === true) {
      writer.uint32(8).bool(message.fee_enabled);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryFeeEnabledChannelResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryFeeEnabledChannelResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.fee_enabled = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryFeeEnabledChannelResponse {
    const obj = createBaseQueryFeeEnabledChannelResponse();
    if (isSet(object.fee_enabled)) obj.fee_enabled = Boolean(object.fee_enabled);
    return obj;
  },
  toJSON(message: QueryFeeEnabledChannelResponse): unknown {
    const obj: any = {};
    message.fee_enabled !== undefined && (obj.fee_enabled = message.fee_enabled);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryFeeEnabledChannelResponse>, I>>(object: I): QueryFeeEnabledChannelResponse {
    const message = createBaseQueryFeeEnabledChannelResponse();
    message.fee_enabled = object.fee_enabled ?? false;
    return message;
  }
};
/** Query defines the ICS29 gRPC querier service. */
export interface Query {
  /** IncentivizedPackets returns all incentivized packets and their associated fees */
  IncentivizedPackets(request: QueryIncentivizedPacketsRequest): Promise<QueryIncentivizedPacketsResponse>;
  /** IncentivizedPacket returns all packet fees for a packet given its identifier */
  IncentivizedPacket(request: QueryIncentivizedPacketRequest): Promise<QueryIncentivizedPacketResponse>;
  /** Gets all incentivized packets for a specific channel */
  IncentivizedPacketsForChannel(request: QueryIncentivizedPacketsForChannelRequest): Promise<QueryIncentivizedPacketsForChannelResponse>;
  /** TotalRecvFees returns the total receive fees for a packet given its identifier */
  TotalRecvFees(request: QueryTotalRecvFeesRequest): Promise<QueryTotalRecvFeesResponse>;
  /** TotalAckFees returns the total acknowledgement fees for a packet given its identifier */
  TotalAckFees(request: QueryTotalAckFeesRequest): Promise<QueryTotalAckFeesResponse>;
  /** TotalTimeoutFees returns the total timeout fees for a packet given its identifier */
  TotalTimeoutFees(request: QueryTotalTimeoutFeesRequest): Promise<QueryTotalTimeoutFeesResponse>;
  /** Payee returns the registered payee address for a specific channel given the relayer address */
  Payee(request: QueryPayeeRequest): Promise<QueryPayeeResponse>;
  /** CounterpartyPayee returns the registered counterparty payee for forward relaying */
  CounterpartyPayee(request: QueryCounterpartyPayeeRequest): Promise<QueryCounterpartyPayeeResponse>;
  /** FeeEnabledChannels returns a list of all fee enabled channels */
  FeeEnabledChannels(request: QueryFeeEnabledChannelsRequest): Promise<QueryFeeEnabledChannelsResponse>;
  /** FeeEnabledChannel returns true if the provided port and channel identifiers belong to a fee enabled channel */
  FeeEnabledChannel(request: QueryFeeEnabledChannelRequest): Promise<QueryFeeEnabledChannelResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.IncentivizedPackets = this.IncentivizedPackets.bind(this);
    this.IncentivizedPacket = this.IncentivizedPacket.bind(this);
    this.IncentivizedPacketsForChannel = this.IncentivizedPacketsForChannel.bind(this);
    this.TotalRecvFees = this.TotalRecvFees.bind(this);
    this.TotalAckFees = this.TotalAckFees.bind(this);
    this.TotalTimeoutFees = this.TotalTimeoutFees.bind(this);
    this.Payee = this.Payee.bind(this);
    this.CounterpartyPayee = this.CounterpartyPayee.bind(this);
    this.FeeEnabledChannels = this.FeeEnabledChannels.bind(this);
    this.FeeEnabledChannel = this.FeeEnabledChannel.bind(this);
  }
  IncentivizedPackets(request: QueryIncentivizedPacketsRequest): Promise<QueryIncentivizedPacketsResponse> {
    const data = QueryIncentivizedPacketsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "IncentivizedPackets", data);
    return promise.then(data => QueryIncentivizedPacketsResponse.decode(new BinaryReader(data)));
  }
  IncentivizedPacket(request: QueryIncentivizedPacketRequest): Promise<QueryIncentivizedPacketResponse> {
    const data = QueryIncentivizedPacketRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "IncentivizedPacket", data);
    return promise.then(data => QueryIncentivizedPacketResponse.decode(new BinaryReader(data)));
  }
  IncentivizedPacketsForChannel(request: QueryIncentivizedPacketsForChannelRequest): Promise<QueryIncentivizedPacketsForChannelResponse> {
    const data = QueryIncentivizedPacketsForChannelRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "IncentivizedPacketsForChannel", data);
    return promise.then(data => QueryIncentivizedPacketsForChannelResponse.decode(new BinaryReader(data)));
  }
  TotalRecvFees(request: QueryTotalRecvFeesRequest): Promise<QueryTotalRecvFeesResponse> {
    const data = QueryTotalRecvFeesRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "TotalRecvFees", data);
    return promise.then(data => QueryTotalRecvFeesResponse.decode(new BinaryReader(data)));
  }
  TotalAckFees(request: QueryTotalAckFeesRequest): Promise<QueryTotalAckFeesResponse> {
    const data = QueryTotalAckFeesRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "TotalAckFees", data);
    return promise.then(data => QueryTotalAckFeesResponse.decode(new BinaryReader(data)));
  }
  TotalTimeoutFees(request: QueryTotalTimeoutFeesRequest): Promise<QueryTotalTimeoutFeesResponse> {
    const data = QueryTotalTimeoutFeesRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "TotalTimeoutFees", data);
    return promise.then(data => QueryTotalTimeoutFeesResponse.decode(new BinaryReader(data)));
  }
  Payee(request: QueryPayeeRequest): Promise<QueryPayeeResponse> {
    const data = QueryPayeeRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "Payee", data);
    return promise.then(data => QueryPayeeResponse.decode(new BinaryReader(data)));
  }
  CounterpartyPayee(request: QueryCounterpartyPayeeRequest): Promise<QueryCounterpartyPayeeResponse> {
    const data = QueryCounterpartyPayeeRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "CounterpartyPayee", data);
    return promise.then(data => QueryCounterpartyPayeeResponse.decode(new BinaryReader(data)));
  }
  FeeEnabledChannels(request: QueryFeeEnabledChannelsRequest): Promise<QueryFeeEnabledChannelsResponse> {
    const data = QueryFeeEnabledChannelsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "FeeEnabledChannels", data);
    return promise.then(data => QueryFeeEnabledChannelsResponse.decode(new BinaryReader(data)));
  }
  FeeEnabledChannel(request: QueryFeeEnabledChannelRequest): Promise<QueryFeeEnabledChannelResponse> {
    const data = QueryFeeEnabledChannelRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Query", "FeeEnabledChannel", data);
    return promise.then(data => QueryFeeEnabledChannelResponse.decode(new BinaryReader(data)));
  }
}