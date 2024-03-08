/* eslint-disable */
import { ResultBlockResults } from "./block";
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
/** Query provides defines the gRPC querier service */
export interface Query {
  BlockResults(request: QueryBlockResultsRequest): Promise<QueryBlockResultsResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.BlockResults = this.BlockResults.bind(this);
  }
  BlockResults(request: QueryBlockResultsRequest): Promise<QueryBlockResultsResponse> {
    const data = QueryBlockResultsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.core.types.v1.Query", "BlockResults", data);
    return promise.then(data => QueryBlockResultsResponse.decode(new BinaryReader(data)));
  }
}