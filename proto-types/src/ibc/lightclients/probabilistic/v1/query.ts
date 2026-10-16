/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, bytesFromBase64, base64FromBytes, DeepPartial, Exact, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.lightclients.probabilistic.v1";
/**
 * @name QueryVerificationRequest
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.QueryVerificationRequest
 */
export interface QueryVerificationRequest {
  namespace: Uint8Array;
  generation: bigint;
  checkpoint_reference: Uint8Array;
  kind: number;
  after: Uint8Array;
  limit: number;
  session_id: Uint8Array;
  receipt_id: Uint8Array;
}
/**
 * @name QueryVerificationResponse
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.QueryVerificationResponse
 */
export interface QueryVerificationResponse {
  /**
   * Versioned JSON metadata or records. Values use canonical binary encoding.
   */
  data: Uint8Array;
}
function createBaseQueryVerificationRequest(): QueryVerificationRequest {
  return {
    namespace: new Uint8Array(),
    generation: BigInt(0),
    checkpoint_reference: new Uint8Array(),
    kind: 0,
    after: new Uint8Array(),
    limit: 0,
    session_id: new Uint8Array(),
    receipt_id: new Uint8Array(),
  };
}
/**
 * @name QueryVerificationRequest
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.QueryVerificationRequest
 */
export const QueryVerificationRequest = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.QueryVerificationRequest",
  encode(message: QueryVerificationRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.namespace.length !== 0) {
      writer.uint32(10).bytes(message.namespace);
    }
    if (message.generation !== BigInt(0)) {
      writer.uint32(16).uint64(message.generation);
    }
    if (message.checkpoint_reference.length !== 0) {
      writer.uint32(26).bytes(message.checkpoint_reference);
    }
    if (message.kind !== 0) {
      writer.uint32(32).uint32(message.kind);
    }
    if (message.after.length !== 0) {
      writer.uint32(42).bytes(message.after);
    }
    if (message.limit !== 0) {
      writer.uint32(48).uint32(message.limit);
    }
    if (message.session_id.length !== 0) {
      writer.uint32(58).bytes(message.session_id);
    }
    if (message.receipt_id.length !== 0) {
      writer.uint32(66).bytes(message.receipt_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryVerificationRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryVerificationRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.namespace = reader.bytes();
          break;
        case 2:
          message.generation = reader.uint64();
          break;
        case 3:
          message.checkpoint_reference = reader.bytes();
          break;
        case 4:
          message.kind = reader.uint32();
          break;
        case 5:
          message.after = reader.bytes();
          break;
        case 6:
          message.limit = reader.uint32();
          break;
        case 7:
          message.session_id = reader.bytes();
          break;
        case 8:
          message.receipt_id = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryVerificationRequest {
    const obj = createBaseQueryVerificationRequest();
    if (isSet(object.namespace)) obj.namespace = bytesFromBase64(object.namespace);
    if (isSet(object.generation)) obj.generation = BigInt(object.generation.toString());
    if (isSet(object.checkpoint_reference))
      obj.checkpoint_reference = bytesFromBase64(object.checkpoint_reference);
    if (isSet(object.kind)) obj.kind = Number(object.kind);
    if (isSet(object.after)) obj.after = bytesFromBase64(object.after);
    if (isSet(object.limit)) obj.limit = Number(object.limit);
    if (isSet(object.session_id)) obj.session_id = bytesFromBase64(object.session_id);
    if (isSet(object.receipt_id)) obj.receipt_id = bytesFromBase64(object.receipt_id);
    return obj;
  },
  toJSON(message: QueryVerificationRequest): unknown {
    const obj: any = {};
    message.namespace !== undefined &&
      (obj.namespace = base64FromBytes(
        message.namespace !== undefined ? message.namespace : new Uint8Array(),
      ));
    message.generation !== undefined && (obj.generation = (message.generation || BigInt(0)).toString());
    message.checkpoint_reference !== undefined &&
      (obj.checkpoint_reference = base64FromBytes(
        message.checkpoint_reference !== undefined ? message.checkpoint_reference : new Uint8Array(),
      ));
    message.kind !== undefined && (obj.kind = Math.round(message.kind));
    message.after !== undefined &&
      (obj.after = base64FromBytes(message.after !== undefined ? message.after : new Uint8Array()));
    message.limit !== undefined && (obj.limit = Math.round(message.limit));
    message.session_id !== undefined &&
      (obj.session_id = base64FromBytes(
        message.session_id !== undefined ? message.session_id : new Uint8Array(),
      ));
    message.receipt_id !== undefined &&
      (obj.receipt_id = base64FromBytes(
        message.receipt_id !== undefined ? message.receipt_id : new Uint8Array(),
      ));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryVerificationRequest>, I>>(
    object: I,
  ): QueryVerificationRequest {
    const message = createBaseQueryVerificationRequest();
    message.namespace = object.namespace ?? new Uint8Array();
    if (object.generation !== undefined && object.generation !== null) {
      message.generation = BigInt(object.generation.toString());
    }
    message.checkpoint_reference = object.checkpoint_reference ?? new Uint8Array();
    message.kind = object.kind ?? 0;
    message.after = object.after ?? new Uint8Array();
    message.limit = object.limit ?? 0;
    message.session_id = object.session_id ?? new Uint8Array();
    message.receipt_id = object.receipt_id ?? new Uint8Array();
    return message;
  },
};
function createBaseQueryVerificationResponse(): QueryVerificationResponse {
  return {
    data: new Uint8Array(),
  };
}
/**
 * @name QueryVerificationResponse
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.QueryVerificationResponse
 */
export const QueryVerificationResponse = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.QueryVerificationResponse",
  encode(message: QueryVerificationResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.data.length !== 0) {
      writer.uint32(10).bytes(message.data);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryVerificationResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryVerificationResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.data = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryVerificationResponse {
    const obj = createBaseQueryVerificationResponse();
    if (isSet(object.data)) obj.data = bytesFromBase64(object.data);
    return obj;
  },
  toJSON(message: QueryVerificationResponse): unknown {
    const obj: any = {};
    message.data !== undefined &&
      (obj.data = base64FromBytes(message.data !== undefined ? message.data : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryVerificationResponse>, I>>(
    object: I,
  ): QueryVerificationResponse {
    const message = createBaseQueryVerificationResponse();
    message.data = object.data ?? new Uint8Array();
    return message;
  },
};
export interface Query {
  Verification(request: QueryVerificationRequest): Promise<QueryVerificationResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.Verification = this.Verification.bind(this);
  }
  Verification(request: QueryVerificationRequest): Promise<QueryVerificationResponse> {
    const data = QueryVerificationRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.lightclients.probabilistic.v1.Query", "Verification", data);
    return promise.then((data) => QueryVerificationResponse.decode(new BinaryReader(data)));
  }
}
export const createClientImpl = (rpc: Rpc) => {
  return new QueryClientImpl(rpc);
};
