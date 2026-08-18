/* eslint-disable */
import { PageRequest, PageResponse } from "../../cosmos/base/query/v1beta1/pagination";
import { Params } from "./params";
import { Vessel } from "./vessel";
import { ConsolidatedDataReport } from "./consolidated_data_report";
import { BinaryReader, BinaryWriter } from "../../binary";
import { DeepPartial, Exact, isSet, Rpc } from "../../helpers";
export const protobufPackage = "vesseloracle.vesseloracle";
/**
 * QueryParamsRequest is request type for the Query/Params RPC method.
 * @name QueryParamsRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryParamsRequest
 */
export interface QueryParamsRequest {}
/**
 * QueryParamsResponse is response type for the Query/Params RPC method.
 * @name QueryParamsResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryParamsResponse
 */
export interface QueryParamsResponse {
  /**
   * params holds all the parameters of this module.
   */
  params: Params;
}
/**
 * @name QueryGetVesselRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetVesselRequest
 */
export interface QueryGetVesselRequest {
  imo: string;
  ts: bigint;
  source: string;
}
/**
 * @name QueryGetVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetVesselResponse
 */
export interface QueryGetVesselResponse {
  vessel: Vessel;
}
/**
 * @name QueryAllVesselRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllVesselRequest
 */
export interface QueryAllVesselRequest {
  pagination?: PageRequest;
}
/**
 * @name QueryAllVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllVesselResponse
 */
export interface QueryAllVesselResponse {
  vessel: Vessel[];
  pagination?: PageResponse;
}
/**
 * @name QueryGetConsolidatedDataReportRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetConsolidatedDataReportRequest
 */
export interface QueryGetConsolidatedDataReportRequest {
  imo: string;
  ts: bigint;
}
/**
 * @name QueryGetConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetConsolidatedDataReportResponse
 */
export interface QueryGetConsolidatedDataReportResponse {
  consolidatedDataReport: ConsolidatedDataReport;
}
/**
 * @name QueryLatestConsolidatedDataReportRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportRequest
 */
export interface QueryLatestConsolidatedDataReportRequest {
  imo: string;
}
/**
 * @name QueryLatestConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportResponse
 */
export interface QueryLatestConsolidatedDataReportResponse {
  consolidatedDataReport: ConsolidatedDataReport;
}
/**
 * @name QueryAllConsolidatedDataReportRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllConsolidatedDataReportRequest
 */
export interface QueryAllConsolidatedDataReportRequest {
  pagination?: PageRequest;
}
/**
 * @name QueryAllConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllConsolidatedDataReportResponse
 */
export interface QueryAllConsolidatedDataReportResponse {
  consolidatedDataReport: ConsolidatedDataReport[];
  pagination?: PageResponse;
}
function createBaseQueryParamsRequest(): QueryParamsRequest {
  return {};
}
/**
 * QueryParamsRequest is request type for the Query/Params RPC method.
 * @name QueryParamsRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryParamsRequest
 */
export const QueryParamsRequest = {
  typeUrl: "/vesseloracle.vesseloracle.QueryParamsRequest",
  encode(_: QueryParamsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryParamsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryParamsRequest();
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
  fromJSON(_: any): QueryParamsRequest {
    const obj = createBaseQueryParamsRequest();
    return obj;
  },
  toJSON(_: QueryParamsRequest): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryParamsRequest>, I>>(_: I): QueryParamsRequest {
    const message = createBaseQueryParamsRequest();
    return message;
  },
};
function createBaseQueryParamsResponse(): QueryParamsResponse {
  return {
    params: Params.fromPartial({}),
  };
}
/**
 * QueryParamsResponse is response type for the Query/Params RPC method.
 * @name QueryParamsResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryParamsResponse
 */
export const QueryParamsResponse = {
  typeUrl: "/vesseloracle.vesseloracle.QueryParamsResponse",
  encode(message: QueryParamsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.params !== undefined) {
      Params.encode(message.params, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryParamsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryParamsResponse();
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
  fromJSON(object: any): QueryParamsResponse {
    const obj = createBaseQueryParamsResponse();
    if (isSet(object.params)) obj.params = Params.fromJSON(object.params);
    return obj;
  },
  toJSON(message: QueryParamsResponse): unknown {
    const obj: any = {};
    message.params !== undefined && (obj.params = message.params ? Params.toJSON(message.params) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryParamsResponse>, I>>(object: I): QueryParamsResponse {
    const message = createBaseQueryParamsResponse();
    if (object.params !== undefined && object.params !== null) {
      message.params = Params.fromPartial(object.params);
    }
    return message;
  },
};
function createBaseQueryGetVesselRequest(): QueryGetVesselRequest {
  return {
    imo: "",
    ts: BigInt(0),
    source: "",
  };
}
/**
 * @name QueryGetVesselRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetVesselRequest
 */
export const QueryGetVesselRequest = {
  typeUrl: "/vesseloracle.vesseloracle.QueryGetVesselRequest",
  encode(message: QueryGetVesselRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.imo !== "") {
      writer.uint32(10).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(16).uint64(message.ts);
    }
    if (message.source !== "") {
      writer.uint32(26).string(message.source);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryGetVesselRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetVesselRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.imo = reader.string();
          break;
        case 2:
          message.ts = reader.uint64();
          break;
        case 3:
          message.source = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryGetVesselRequest {
    const obj = createBaseQueryGetVesselRequest();
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.source)) obj.source = String(object.source);
    return obj;
  },
  toJSON(message: QueryGetVesselRequest): unknown {
    const obj: any = {};
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.source !== undefined && (obj.source = message.source);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryGetVesselRequest>, I>>(object: I): QueryGetVesselRequest {
    const message = createBaseQueryGetVesselRequest();
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.source = object.source ?? "";
    return message;
  },
};
function createBaseQueryGetVesselResponse(): QueryGetVesselResponse {
  return {
    vessel: Vessel.fromPartial({}),
  };
}
/**
 * @name QueryGetVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetVesselResponse
 */
export const QueryGetVesselResponse = {
  typeUrl: "/vesseloracle.vesseloracle.QueryGetVesselResponse",
  encode(message: QueryGetVesselResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.vessel !== undefined) {
      Vessel.encode(message.vessel, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryGetVesselResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetVesselResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.vessel = Vessel.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryGetVesselResponse {
    const obj = createBaseQueryGetVesselResponse();
    if (isSet(object.vessel)) obj.vessel = Vessel.fromJSON(object.vessel);
    return obj;
  },
  toJSON(message: QueryGetVesselResponse): unknown {
    const obj: any = {};
    message.vessel !== undefined && (obj.vessel = message.vessel ? Vessel.toJSON(message.vessel) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryGetVesselResponse>, I>>(object: I): QueryGetVesselResponse {
    const message = createBaseQueryGetVesselResponse();
    if (object.vessel !== undefined && object.vessel !== null) {
      message.vessel = Vessel.fromPartial(object.vessel);
    }
    return message;
  },
};
function createBaseQueryAllVesselRequest(): QueryAllVesselRequest {
  return {
    pagination: undefined,
  };
}
/**
 * @name QueryAllVesselRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllVesselRequest
 */
export const QueryAllVesselRequest = {
  typeUrl: "/vesseloracle.vesseloracle.QueryAllVesselRequest",
  encode(message: QueryAllVesselRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryAllVesselRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryAllVesselRequest();
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
  fromJSON(object: any): QueryAllVesselRequest {
    const obj = createBaseQueryAllVesselRequest();
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryAllVesselRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryAllVesselRequest>, I>>(object: I): QueryAllVesselRequest {
    const message = createBaseQueryAllVesselRequest();
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryAllVesselResponse(): QueryAllVesselResponse {
  return {
    vessel: [],
    pagination: undefined,
  };
}
/**
 * @name QueryAllVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllVesselResponse
 */
export const QueryAllVesselResponse = {
  typeUrl: "/vesseloracle.vesseloracle.QueryAllVesselResponse",
  encode(message: QueryAllVesselResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.vessel) {
      Vessel.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryAllVesselResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryAllVesselResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.vessel.push(Vessel.decode(reader, reader.uint32()));
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
  fromJSON(object: any): QueryAllVesselResponse {
    const obj = createBaseQueryAllVesselResponse();
    if (Array.isArray(object?.vessel)) obj.vessel = object.vessel.map((e: any) => Vessel.fromJSON(e));
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryAllVesselResponse): unknown {
    const obj: any = {};
    if (message.vessel) {
      obj.vessel = message.vessel.map((e) => (e ? Vessel.toJSON(e) : undefined));
    } else {
      obj.vessel = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryAllVesselResponse>, I>>(object: I): QueryAllVesselResponse {
    const message = createBaseQueryAllVesselResponse();
    message.vessel = object.vessel?.map((e) => Vessel.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryGetConsolidatedDataReportRequest(): QueryGetConsolidatedDataReportRequest {
  return {
    imo: "",
    ts: BigInt(0),
  };
}
/**
 * @name QueryGetConsolidatedDataReportRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetConsolidatedDataReportRequest
 */
export const QueryGetConsolidatedDataReportRequest = {
  typeUrl: "/vesseloracle.vesseloracle.QueryGetConsolidatedDataReportRequest",
  encode(
    message: QueryGetConsolidatedDataReportRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.imo !== "") {
      writer.uint32(10).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(16).uint64(message.ts);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryGetConsolidatedDataReportRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetConsolidatedDataReportRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.imo = reader.string();
          break;
        case 2:
          message.ts = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryGetConsolidatedDataReportRequest {
    const obj = createBaseQueryGetConsolidatedDataReportRequest();
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    return obj;
  },
  toJSON(message: QueryGetConsolidatedDataReportRequest): unknown {
    const obj: any = {};
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryGetConsolidatedDataReportRequest>, I>>(
    object: I,
  ): QueryGetConsolidatedDataReportRequest {
    const message = createBaseQueryGetConsolidatedDataReportRequest();
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    return message;
  },
};
function createBaseQueryGetConsolidatedDataReportResponse(): QueryGetConsolidatedDataReportResponse {
  return {
    consolidatedDataReport: ConsolidatedDataReport.fromPartial({}),
  };
}
/**
 * @name QueryGetConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryGetConsolidatedDataReportResponse
 */
export const QueryGetConsolidatedDataReportResponse = {
  typeUrl: "/vesseloracle.vesseloracle.QueryGetConsolidatedDataReportResponse",
  encode(
    message: QueryGetConsolidatedDataReportResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.consolidatedDataReport !== undefined) {
      ConsolidatedDataReport.encode(message.consolidatedDataReport, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryGetConsolidatedDataReportResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetConsolidatedDataReportResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.consolidatedDataReport = ConsolidatedDataReport.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryGetConsolidatedDataReportResponse {
    const obj = createBaseQueryGetConsolidatedDataReportResponse();
    if (isSet(object.consolidatedDataReport))
      obj.consolidatedDataReport = ConsolidatedDataReport.fromJSON(object.consolidatedDataReport);
    return obj;
  },
  toJSON(message: QueryGetConsolidatedDataReportResponse): unknown {
    const obj: any = {};
    message.consolidatedDataReport !== undefined &&
      (obj.consolidatedDataReport = message.consolidatedDataReport
        ? ConsolidatedDataReport.toJSON(message.consolidatedDataReport)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryGetConsolidatedDataReportResponse>, I>>(
    object: I,
  ): QueryGetConsolidatedDataReportResponse {
    const message = createBaseQueryGetConsolidatedDataReportResponse();
    if (object.consolidatedDataReport !== undefined && object.consolidatedDataReport !== null) {
      message.consolidatedDataReport = ConsolidatedDataReport.fromPartial(object.consolidatedDataReport);
    }
    return message;
  },
};
function createBaseQueryLatestConsolidatedDataReportRequest(): QueryLatestConsolidatedDataReportRequest {
  return {
    imo: "",
  };
}
/**
 * @name QueryLatestConsolidatedDataReportRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportRequest
 */
export const QueryLatestConsolidatedDataReportRequest = {
  typeUrl: "/vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportRequest",
  encode(
    message: QueryLatestConsolidatedDataReportRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.imo !== "") {
      writer.uint32(10).string(message.imo);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryLatestConsolidatedDataReportRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryLatestConsolidatedDataReportRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.imo = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryLatestConsolidatedDataReportRequest {
    const obj = createBaseQueryLatestConsolidatedDataReportRequest();
    if (isSet(object.imo)) obj.imo = String(object.imo);
    return obj;
  },
  toJSON(message: QueryLatestConsolidatedDataReportRequest): unknown {
    const obj: any = {};
    message.imo !== undefined && (obj.imo = message.imo);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryLatestConsolidatedDataReportRequest>, I>>(
    object: I,
  ): QueryLatestConsolidatedDataReportRequest {
    const message = createBaseQueryLatestConsolidatedDataReportRequest();
    message.imo = object.imo ?? "";
    return message;
  },
};
function createBaseQueryLatestConsolidatedDataReportResponse(): QueryLatestConsolidatedDataReportResponse {
  return {
    consolidatedDataReport: ConsolidatedDataReport.fromPartial({}),
  };
}
/**
 * @name QueryLatestConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportResponse
 */
export const QueryLatestConsolidatedDataReportResponse = {
  typeUrl: "/vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportResponse",
  encode(
    message: QueryLatestConsolidatedDataReportResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.consolidatedDataReport !== undefined) {
      ConsolidatedDataReport.encode(message.consolidatedDataReport, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryLatestConsolidatedDataReportResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryLatestConsolidatedDataReportResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.consolidatedDataReport = ConsolidatedDataReport.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryLatestConsolidatedDataReportResponse {
    const obj = createBaseQueryLatestConsolidatedDataReportResponse();
    if (isSet(object.consolidatedDataReport))
      obj.consolidatedDataReport = ConsolidatedDataReport.fromJSON(object.consolidatedDataReport);
    return obj;
  },
  toJSON(message: QueryLatestConsolidatedDataReportResponse): unknown {
    const obj: any = {};
    message.consolidatedDataReport !== undefined &&
      (obj.consolidatedDataReport = message.consolidatedDataReport
        ? ConsolidatedDataReport.toJSON(message.consolidatedDataReport)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryLatestConsolidatedDataReportResponse>, I>>(
    object: I,
  ): QueryLatestConsolidatedDataReportResponse {
    const message = createBaseQueryLatestConsolidatedDataReportResponse();
    if (object.consolidatedDataReport !== undefined && object.consolidatedDataReport !== null) {
      message.consolidatedDataReport = ConsolidatedDataReport.fromPartial(object.consolidatedDataReport);
    }
    return message;
  },
};
function createBaseQueryAllConsolidatedDataReportRequest(): QueryAllConsolidatedDataReportRequest {
  return {
    pagination: undefined,
  };
}
/**
 * @name QueryAllConsolidatedDataReportRequest
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllConsolidatedDataReportRequest
 */
export const QueryAllConsolidatedDataReportRequest = {
  typeUrl: "/vesseloracle.vesseloracle.QueryAllConsolidatedDataReportRequest",
  encode(
    message: QueryAllConsolidatedDataReportRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.pagination !== undefined) {
      PageRequest.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryAllConsolidatedDataReportRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryAllConsolidatedDataReportRequest();
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
  fromJSON(object: any): QueryAllConsolidatedDataReportRequest {
    const obj = createBaseQueryAllConsolidatedDataReportRequest();
    if (isSet(object.pagination)) obj.pagination = PageRequest.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryAllConsolidatedDataReportRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageRequest.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryAllConsolidatedDataReportRequest>, I>>(
    object: I,
  ): QueryAllConsolidatedDataReportRequest {
    const message = createBaseQueryAllConsolidatedDataReportRequest();
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageRequest.fromPartial(object.pagination);
    }
    return message;
  },
};
function createBaseQueryAllConsolidatedDataReportResponse(): QueryAllConsolidatedDataReportResponse {
  return {
    consolidatedDataReport: [],
    pagination: undefined,
  };
}
/**
 * @name QueryAllConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.QueryAllConsolidatedDataReportResponse
 */
export const QueryAllConsolidatedDataReportResponse = {
  typeUrl: "/vesseloracle.vesseloracle.QueryAllConsolidatedDataReportResponse",
  encode(
    message: QueryAllConsolidatedDataReportResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    for (const v of message.consolidatedDataReport) {
      ConsolidatedDataReport.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.pagination !== undefined) {
      PageResponse.encode(message.pagination, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryAllConsolidatedDataReportResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryAllConsolidatedDataReportResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.consolidatedDataReport.push(ConsolidatedDataReport.decode(reader, reader.uint32()));
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
  fromJSON(object: any): QueryAllConsolidatedDataReportResponse {
    const obj = createBaseQueryAllConsolidatedDataReportResponse();
    if (Array.isArray(object?.consolidatedDataReport))
      obj.consolidatedDataReport = object.consolidatedDataReport.map((e: any) =>
        ConsolidatedDataReport.fromJSON(e),
      );
    if (isSet(object.pagination)) obj.pagination = PageResponse.fromJSON(object.pagination);
    return obj;
  },
  toJSON(message: QueryAllConsolidatedDataReportResponse): unknown {
    const obj: any = {};
    if (message.consolidatedDataReport) {
      obj.consolidatedDataReport = message.consolidatedDataReport.map((e) =>
        e ? ConsolidatedDataReport.toJSON(e) : undefined,
      );
    } else {
      obj.consolidatedDataReport = [];
    }
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? PageResponse.toJSON(message.pagination) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryAllConsolidatedDataReportResponse>, I>>(
    object: I,
  ): QueryAllConsolidatedDataReportResponse {
    const message = createBaseQueryAllConsolidatedDataReportResponse();
    message.consolidatedDataReport =
      object.consolidatedDataReport?.map((e) => ConsolidatedDataReport.fromPartial(e)) || [];
    if (object.pagination !== undefined && object.pagination !== null) {
      message.pagination = PageResponse.fromPartial(object.pagination);
    }
    return message;
  },
};
/** Query defines the gRPC querier service. */
export interface Query {
  /** Parameters queries the parameters of the module. */
  Params(request?: QueryParamsRequest): Promise<QueryParamsResponse>;
  /** Queries a list of Vessel items. */
  Vessel(request: QueryGetVesselRequest): Promise<QueryGetVesselResponse>;
  VesselAll(request?: QueryAllVesselRequest): Promise<QueryAllVesselResponse>;
  /** Queries a list of ConsolidatedDataReport items. */
  ConsolidatedDataReport(
    request: QueryGetConsolidatedDataReportRequest,
  ): Promise<QueryGetConsolidatedDataReportResponse>;
  LatestConsolidatedDataReport(
    request: QueryLatestConsolidatedDataReportRequest,
  ): Promise<QueryLatestConsolidatedDataReportResponse>;
  ConsolidatedDataReportAll(
    request?: QueryAllConsolidatedDataReportRequest,
  ): Promise<QueryAllConsolidatedDataReportResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.Params = this.Params.bind(this);
    this.Vessel = this.Vessel.bind(this);
    this.VesselAll = this.VesselAll.bind(this);
    this.ConsolidatedDataReport = this.ConsolidatedDataReport.bind(this);
    this.LatestConsolidatedDataReport = this.LatestConsolidatedDataReport.bind(this);
    this.ConsolidatedDataReportAll = this.ConsolidatedDataReportAll.bind(this);
  }
  Params(request: QueryParamsRequest = {}): Promise<QueryParamsResponse> {
    const data = QueryParamsRequest.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Query", "Params", data);
    return promise.then((data) => QueryParamsResponse.decode(new BinaryReader(data)));
  }
  Vessel(request: QueryGetVesselRequest): Promise<QueryGetVesselResponse> {
    const data = QueryGetVesselRequest.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Query", "Vessel", data);
    return promise.then((data) => QueryGetVesselResponse.decode(new BinaryReader(data)));
  }
  VesselAll(
    request: QueryAllVesselRequest = {
      pagination: PageRequest.fromPartial({}),
    },
  ): Promise<QueryAllVesselResponse> {
    const data = QueryAllVesselRequest.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Query", "VesselAll", data);
    return promise.then((data) => QueryAllVesselResponse.decode(new BinaryReader(data)));
  }
  ConsolidatedDataReport(
    request: QueryGetConsolidatedDataReportRequest,
  ): Promise<QueryGetConsolidatedDataReportResponse> {
    const data = QueryGetConsolidatedDataReportRequest.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Query", "ConsolidatedDataReport", data);
    return promise.then((data) => QueryGetConsolidatedDataReportResponse.decode(new BinaryReader(data)));
  }
  LatestConsolidatedDataReport(
    request: QueryLatestConsolidatedDataReportRequest,
  ): Promise<QueryLatestConsolidatedDataReportResponse> {
    const data = QueryLatestConsolidatedDataReportRequest.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Query", "LatestConsolidatedDataReport", data);
    return promise.then((data) => QueryLatestConsolidatedDataReportResponse.decode(new BinaryReader(data)));
  }
  ConsolidatedDataReportAll(
    request: QueryAllConsolidatedDataReportRequest = {
      pagination: PageRequest.fromPartial({}),
    },
  ): Promise<QueryAllConsolidatedDataReportResponse> {
    const data = QueryAllConsolidatedDataReportRequest.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Query", "ConsolidatedDataReportAll", data);
    return promise.then((data) => QueryAllConsolidatedDataReportResponse.decode(new BinaryReader(data)));
  }
}
export const createClientImpl = (rpc: Rpc) => {
  return new QueryClientImpl(rpc);
};
