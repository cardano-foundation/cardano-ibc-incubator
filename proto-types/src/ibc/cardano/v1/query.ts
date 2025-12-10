/* eslint-disable */
import { ResponseDeliverTx } from "../../core/types/v1/block";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../../helpers";
export const protobufPackage = "ibc.cardano.v1";
/** QueryEventsRequest is the request type for the Query/Events RPC method. */
export interface QueryEventsRequest {
  /** Height from which to query events (exclusive - returns events after this height) */
  since_height: bigint;
}
/** QueryEventsResponse is the response type for the Query/Events RPC method. */
export interface QueryEventsResponse {
  /** Current chain height at the time of the query */
  current_height: bigint;
  /** Events grouped by block height */
  events: BlockEvents[];
}
/** BlockEvents contains all IBC events for a specific block */
export interface BlockEvents {
  /** Block height */
  height: bigint;
  /** IBC events that occurred in this block */
  events: ResponseDeliverTx[];
}
function createBaseQueryEventsRequest(): QueryEventsRequest {
  return {
    since_height: BigInt(0),
  };
}
export const QueryEventsRequest = {
  typeUrl: "/ibc.cardano.v1.QueryEventsRequest",
  encode(message: QueryEventsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.since_height !== BigInt(0)) {
      writer.uint32(8).uint64(message.since_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryEventsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryEventsRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.since_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryEventsRequest {
    const obj = createBaseQueryEventsRequest();
    if (isSet(object.since_height)) obj.since_height = BigInt(object.since_height.toString());
    return obj;
  },
  toJSON(message: QueryEventsRequest): unknown {
    const obj: any = {};
    message.since_height !== undefined && (obj.since_height = (message.since_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryEventsRequest>, I>>(object: I): QueryEventsRequest {
    const message = createBaseQueryEventsRequest();
    if (object.since_height !== undefined && object.since_height !== null) {
      message.since_height = BigInt(object.since_height.toString());
    }
    return message;
  },
};
function createBaseQueryEventsResponse(): QueryEventsResponse {
  return {
    current_height: BigInt(0),
    events: [],
  };
}
export const QueryEventsResponse = {
  typeUrl: "/ibc.cardano.v1.QueryEventsResponse",
  encode(message: QueryEventsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.current_height !== BigInt(0)) {
      writer.uint32(8).uint64(message.current_height);
    }
    for (const v of message.events) {
      BlockEvents.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryEventsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryEventsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.current_height = reader.uint64();
          break;
        case 2:
          message.events.push(BlockEvents.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryEventsResponse {
    const obj = createBaseQueryEventsResponse();
    if (isSet(object.current_height)) obj.current_height = BigInt(object.current_height.toString());
    if (Array.isArray(object?.events)) obj.events = object.events.map((e: any) => BlockEvents.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryEventsResponse): unknown {
    const obj: any = {};
    message.current_height !== undefined &&
      (obj.current_height = (message.current_height || BigInt(0)).toString());
    if (message.events) {
      obj.events = message.events.map((e) => (e ? BlockEvents.toJSON(e) : undefined));
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryEventsResponse>, I>>(object: I): QueryEventsResponse {
    const message = createBaseQueryEventsResponse();
    if (object.current_height !== undefined && object.current_height !== null) {
      message.current_height = BigInt(object.current_height.toString());
    }
    message.events = object.events?.map((e) => BlockEvents.fromPartial(e)) || [];
    return message;
  },
};
function createBaseBlockEvents(): BlockEvents {
  return {
    height: BigInt(0),
    events: [],
  };
}
export const BlockEvents = {
  typeUrl: "/ibc.cardano.v1.BlockEvents",
  encode(message: BlockEvents, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== BigInt(0)) {
      writer.uint32(8).uint64(message.height);
    }
    for (const v of message.events) {
      ResponseDeliverTx.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BlockEvents {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBlockEvents();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = reader.uint64();
          break;
        case 2:
          message.events.push(ResponseDeliverTx.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BlockEvents {
    const obj = createBaseBlockEvents();
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    if (Array.isArray(object?.events))
      obj.events = object.events.map((e: any) => ResponseDeliverTx.fromJSON(e));
    return obj;
  },
  toJSON(message: BlockEvents): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    if (message.events) {
      obj.events = message.events.map((e) => (e ? ResponseDeliverTx.toJSON(e) : undefined));
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BlockEvents>, I>>(object: I): BlockEvents {
    const message = createBaseBlockEvents();
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    message.events = object.events?.map((e) => ResponseDeliverTx.fromPartial(e)) || [];
    return message;
  },
};
/** Query provides defines the gRPC querier service for Cardano-specific queries */
export interface Query {
  /** Events queries IBC events from Cardano blocks since a given height */
  Events(request: QueryEventsRequest): Promise<QueryEventsResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.Events = this.Events.bind(this);
  }
  Events(request: QueryEventsRequest): Promise<QueryEventsResponse> {
    const data = QueryEventsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.cardano.v1.Query", "Events", data);
    return promise.then((data) => QueryEventsResponse.decode(new BinaryReader(data)));
  }
}
