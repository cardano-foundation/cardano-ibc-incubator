/* eslint-disable */
import { ResultBlockResults, ResultBlockSearch, Event } from "./block";
import { Any } from "../../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.core.types.v1";
/** QueryBlockResultsRequest is the request type for the Query/BlockResults RPC method. */
export interface QueryBlockResultsRequest {
  height: bigint;
}
/** QueryBlockResultsResponse is the response type for the Query/BlockResults RPC method. */
export interface QueryBlockResultsResponse {
  /** params defines the parameters of the module. */
  block_results?: ResultBlockResults;
}
/** QueryBlockSearchRequest is the request type for the Query/BlockSearch RPC method. */
export interface QueryBlockSearchRequest {
  packet_src_channel?: string;
  packet_dst_channel?: string;
  packet_sequence: string;
  limit: bigint;
  page: bigint;
}
/** QueryBlockSearchResponse is the response type for the Query/BlockSearch RPC method. */
export interface QueryBlockSearchResponse {
  /** params defines the parameters of the module. */
  blocks: ResultBlockSearch[];
  total_count: bigint;
}
/** QueryTransactionByHashRequest is the response type for the Query/BlockSearch RPC method. */
export interface QueryTransactionByHashRequest {
  /** Transaction hash in hex format */
  hash: string;
}
export interface QueryTransactionByHashResponse {
  /** Whether the transaction existed on the blockchain */
  hash: string;
  height: bigint;
  gas_fee: bigint;
  tx_size: bigint;
  events: Event[];
}
export interface QueryIBCHeaderRequest {
  height: bigint;
}
export interface QueryIBCHeaderResponse {
  header?: Any;
}
function createBaseQueryBlockResultsRequest(): QueryBlockResultsRequest {
  return {
    height: BigInt(0)
  };
}
export const QueryBlockResultsRequest = {
  typeUrl: "/ibc.core.types.v1.QueryBlockResultsRequest",
  encode(message: QueryBlockResultsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== BigInt(0)) {
      writer.uint32(8).uint64(message.height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBlockResultsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBlockResultsRequest();
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
  fromJSON(object: any): QueryBlockResultsRequest {
    const obj = createBaseQueryBlockResultsRequest();
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    return obj;
  },
  toJSON(message: QueryBlockResultsRequest): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBlockResultsRequest>, I>>(object: I): QueryBlockResultsRequest {
    const message = createBaseQueryBlockResultsRequest();
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    return message;
  }
};
function createBaseQueryBlockResultsResponse(): QueryBlockResultsResponse {
  return {
    block_results: undefined
  };
}
export const QueryBlockResultsResponse = {
  typeUrl: "/ibc.core.types.v1.QueryBlockResultsResponse",
  encode(message: QueryBlockResultsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.block_results !== undefined) {
      ResultBlockResults.encode(message.block_results, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBlockResultsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBlockResultsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.block_results = ResultBlockResults.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryBlockResultsResponse {
    const obj = createBaseQueryBlockResultsResponse();
    if (isSet(object.block_results)) obj.block_results = ResultBlockResults.fromJSON(object.block_results);
    return obj;
  },
  toJSON(message: QueryBlockResultsResponse): unknown {
    const obj: any = {};
    message.block_results !== undefined && (obj.block_results = message.block_results ? ResultBlockResults.toJSON(message.block_results) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBlockResultsResponse>, I>>(object: I): QueryBlockResultsResponse {
    const message = createBaseQueryBlockResultsResponse();
    if (object.block_results !== undefined && object.block_results !== null) {
      message.block_results = ResultBlockResults.fromPartial(object.block_results);
    }
    return message;
  }
};
function createBaseQueryBlockSearchRequest(): QueryBlockSearchRequest {
  return {
    packet_src_channel: undefined,
    packet_dst_channel: undefined,
    packet_sequence: "",
    limit: BigInt(0),
    page: BigInt(0)
  };
}
export const QueryBlockSearchRequest = {
  typeUrl: "/ibc.core.types.v1.QueryBlockSearchRequest",
  encode(message: QueryBlockSearchRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet_src_channel !== undefined) {
      writer.uint32(10).string(message.packet_src_channel);
    }
    if (message.packet_dst_channel !== undefined) {
      writer.uint32(18).string(message.packet_dst_channel);
    }
    if (message.packet_sequence !== "") {
      writer.uint32(26).string(message.packet_sequence);
    }
    if (message.limit !== BigInt(0)) {
      writer.uint32(32).uint64(message.limit);
    }
    if (message.page !== BigInt(0)) {
      writer.uint32(40).uint64(message.page);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBlockSearchRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBlockSearchRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_src_channel = reader.string();
          break;
        case 2:
          message.packet_dst_channel = reader.string();
          break;
        case 3:
          message.packet_sequence = reader.string();
          break;
        case 4:
          message.limit = reader.uint64();
          break;
        case 5:
          message.page = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryBlockSearchRequest {
    const obj = createBaseQueryBlockSearchRequest();
    if (isSet(object.packet_src_channel)) obj.packet_src_channel = String(object.packet_src_channel);
    if (isSet(object.packet_dst_channel)) obj.packet_dst_channel = String(object.packet_dst_channel);
    if (isSet(object.packet_sequence)) obj.packet_sequence = String(object.packet_sequence);
    if (isSet(object.limit)) obj.limit = BigInt(object.limit.toString());
    if (isSet(object.page)) obj.page = BigInt(object.page.toString());
    return obj;
  },
  toJSON(message: QueryBlockSearchRequest): unknown {
    const obj: any = {};
    message.packet_src_channel !== undefined && (obj.packet_src_channel = message.packet_src_channel);
    message.packet_dst_channel !== undefined && (obj.packet_dst_channel = message.packet_dst_channel);
    message.packet_sequence !== undefined && (obj.packet_sequence = message.packet_sequence);
    message.limit !== undefined && (obj.limit = (message.limit || BigInt(0)).toString());
    message.page !== undefined && (obj.page = (message.page || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBlockSearchRequest>, I>>(object: I): QueryBlockSearchRequest {
    const message = createBaseQueryBlockSearchRequest();
    message.packet_src_channel = object.packet_src_channel ?? undefined;
    message.packet_dst_channel = object.packet_dst_channel ?? undefined;
    message.packet_sequence = object.packet_sequence ?? "";
    if (object.limit !== undefined && object.limit !== null) {
      message.limit = BigInt(object.limit.toString());
    }
    if (object.page !== undefined && object.page !== null) {
      message.page = BigInt(object.page.toString());
    }
    return message;
  }
};
function createBaseQueryBlockSearchResponse(): QueryBlockSearchResponse {
  return {
    blocks: [],
    total_count: BigInt(0)
  };
}
export const QueryBlockSearchResponse = {
  typeUrl: "/ibc.core.types.v1.QueryBlockSearchResponse",
  encode(message: QueryBlockSearchResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.blocks) {
      ResultBlockSearch.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.total_count !== BigInt(0)) {
      writer.uint32(16).uint64(message.total_count);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBlockSearchResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBlockSearchResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.blocks.push(ResultBlockSearch.decode(reader, reader.uint32()));
          break;
        case 2:
          message.total_count = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryBlockSearchResponse {
    const obj = createBaseQueryBlockSearchResponse();
    if (Array.isArray(object?.blocks)) obj.blocks = object.blocks.map((e: any) => ResultBlockSearch.fromJSON(e));
    if (isSet(object.total_count)) obj.total_count = BigInt(object.total_count.toString());
    return obj;
  },
  toJSON(message: QueryBlockSearchResponse): unknown {
    const obj: any = {};
    if (message.blocks) {
      obj.blocks = message.blocks.map(e => e ? ResultBlockSearch.toJSON(e) : undefined);
    } else {
      obj.blocks = [];
    }
    message.total_count !== undefined && (obj.total_count = (message.total_count || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBlockSearchResponse>, I>>(object: I): QueryBlockSearchResponse {
    const message = createBaseQueryBlockSearchResponse();
    message.blocks = object.blocks?.map(e => ResultBlockSearch.fromPartial(e)) || [];
    if (object.total_count !== undefined && object.total_count !== null) {
      message.total_count = BigInt(object.total_count.toString());
    }
    return message;
  }
};
function createBaseQueryTransactionByHashRequest(): QueryTransactionByHashRequest {
  return {
    hash: ""
  };
}
export const QueryTransactionByHashRequest = {
  typeUrl: "/ibc.core.types.v1.QueryTransactionByHashRequest",
  encode(message: QueryTransactionByHashRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.hash !== "") {
      writer.uint32(10).string(message.hash);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTransactionByHashRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTransactionByHashRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.hash = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTransactionByHashRequest {
    const obj = createBaseQueryTransactionByHashRequest();
    if (isSet(object.hash)) obj.hash = String(object.hash);
    return obj;
  },
  toJSON(message: QueryTransactionByHashRequest): unknown {
    const obj: any = {};
    message.hash !== undefined && (obj.hash = message.hash);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTransactionByHashRequest>, I>>(object: I): QueryTransactionByHashRequest {
    const message = createBaseQueryTransactionByHashRequest();
    message.hash = object.hash ?? "";
    return message;
  }
};
function createBaseQueryTransactionByHashResponse(): QueryTransactionByHashResponse {
  return {
    hash: "",
    height: BigInt(0),
    gas_fee: BigInt(0),
    tx_size: BigInt(0),
    events: []
  };
}
export const QueryTransactionByHashResponse = {
  typeUrl: "/ibc.core.types.v1.QueryTransactionByHashResponse",
  encode(message: QueryTransactionByHashResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.hash !== "") {
      writer.uint32(10).string(message.hash);
    }
    if (message.height !== BigInt(0)) {
      writer.uint32(16).uint64(message.height);
    }
    if (message.gas_fee !== BigInt(0)) {
      writer.uint32(24).uint64(message.gas_fee);
    }
    if (message.tx_size !== BigInt(0)) {
      writer.uint32(32).uint64(message.tx_size);
    }
    for (const v of message.events) {
      Event.encode(v!, writer.uint32(42).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryTransactionByHashResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryTransactionByHashResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.hash = reader.string();
          break;
        case 2:
          message.height = reader.uint64();
          break;
        case 3:
          message.gas_fee = reader.uint64();
          break;
        case 4:
          message.tx_size = reader.uint64();
          break;
        case 5:
          message.events.push(Event.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryTransactionByHashResponse {
    const obj = createBaseQueryTransactionByHashResponse();
    if (isSet(object.hash)) obj.hash = String(object.hash);
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    if (isSet(object.gas_fee)) obj.gas_fee = BigInt(object.gas_fee.toString());
    if (isSet(object.tx_size)) obj.tx_size = BigInt(object.tx_size.toString());
    if (Array.isArray(object?.events)) obj.events = object.events.map((e: any) => Event.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryTransactionByHashResponse): unknown {
    const obj: any = {};
    message.hash !== undefined && (obj.hash = message.hash);
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    message.gas_fee !== undefined && (obj.gas_fee = (message.gas_fee || BigInt(0)).toString());
    message.tx_size !== undefined && (obj.tx_size = (message.tx_size || BigInt(0)).toString());
    if (message.events) {
      obj.events = message.events.map(e => e ? Event.toJSON(e) : undefined);
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryTransactionByHashResponse>, I>>(object: I): QueryTransactionByHashResponse {
    const message = createBaseQueryTransactionByHashResponse();
    message.hash = object.hash ?? "";
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    if (object.gas_fee !== undefined && object.gas_fee !== null) {
      message.gas_fee = BigInt(object.gas_fee.toString());
    }
    if (object.tx_size !== undefined && object.tx_size !== null) {
      message.tx_size = BigInt(object.tx_size.toString());
    }
    message.events = object.events?.map(e => Event.fromPartial(e)) || [];
    return message;
  }
};
function createBaseQueryIBCHeaderRequest(): QueryIBCHeaderRequest {
  return {
    height: BigInt(0)
  };
}
export const QueryIBCHeaderRequest = {
  typeUrl: "/ibc.core.types.v1.QueryIBCHeaderRequest",
  encode(message: QueryIBCHeaderRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== BigInt(0)) {
      writer.uint32(16).uint64(message.height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIBCHeaderRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIBCHeaderRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 2:
          message.height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIBCHeaderRequest {
    const obj = createBaseQueryIBCHeaderRequest();
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    return obj;
  },
  toJSON(message: QueryIBCHeaderRequest): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIBCHeaderRequest>, I>>(object: I): QueryIBCHeaderRequest {
    const message = createBaseQueryIBCHeaderRequest();
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    return message;
  }
};
function createBaseQueryIBCHeaderResponse(): QueryIBCHeaderResponse {
  return {
    header: undefined
  };
}
export const QueryIBCHeaderResponse = {
  typeUrl: "/ibc.core.types.v1.QueryIBCHeaderResponse",
  encode(message: QueryIBCHeaderResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.header !== undefined) {
      Any.encode(message.header, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryIBCHeaderResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryIBCHeaderResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.header = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryIBCHeaderResponse {
    const obj = createBaseQueryIBCHeaderResponse();
    if (isSet(object.header)) obj.header = Any.fromJSON(object.header);
    return obj;
  },
  toJSON(message: QueryIBCHeaderResponse): unknown {
    const obj: any = {};
    message.header !== undefined && (obj.header = message.header ? Any.toJSON(message.header) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryIBCHeaderResponse>, I>>(object: I): QueryIBCHeaderResponse {
    const message = createBaseQueryIBCHeaderResponse();
    if (object.header !== undefined && object.header !== null) {
      message.header = Any.fromPartial(object.header);
    }
    return message;
  }
};
/** Query provides defines the gRPC querier service */
export interface Query {
  BlockResults(request: QueryBlockResultsRequest): Promise<QueryBlockResultsResponse>;
  BlockSearch(request: QueryBlockSearchRequest): Promise<QueryBlockSearchResponse>;
  TransactionByHash(request: QueryTransactionByHashRequest): Promise<QueryTransactionByHashResponse>;
  IBCHeader(request: QueryIBCHeaderRequest): Promise<QueryIBCHeaderResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.BlockResults = this.BlockResults.bind(this);
    this.BlockSearch = this.BlockSearch.bind(this);
    this.TransactionByHash = this.TransactionByHash.bind(this);
    this.IBCHeader = this.IBCHeader.bind(this);
  }
  BlockResults(request: QueryBlockResultsRequest): Promise<QueryBlockResultsResponse> {
    const data = QueryBlockResultsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.types.v1.Query", "BlockResults", data);
    return promise.then(data => QueryBlockResultsResponse.decode(new BinaryReader(data)));
  }
  BlockSearch(request: QueryBlockSearchRequest): Promise<QueryBlockSearchResponse> {
    const data = QueryBlockSearchRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.types.v1.Query", "BlockSearch", data);
    return promise.then(data => QueryBlockSearchResponse.decode(new BinaryReader(data)));
  }
  TransactionByHash(request: QueryTransactionByHashRequest): Promise<QueryTransactionByHashResponse> {
    const data = QueryTransactionByHashRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.types.v1.Query", "TransactionByHash", data);
    return promise.then(data => QueryTransactionByHashResponse.decode(new BinaryReader(data)));
  }
  IBCHeader(request: QueryIBCHeaderRequest): Promise<QueryIBCHeaderResponse> {
    const data = QueryIBCHeaderRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.types.v1.Query", "IBCHeader", data);
    return promise.then(data => QueryIBCHeaderResponse.decode(new BinaryReader(data)));
  }
}