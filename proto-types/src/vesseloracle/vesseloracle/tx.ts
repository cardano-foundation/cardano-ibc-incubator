/* eslint-disable */
import { Params } from "./params";
import { BinaryReader, BinaryWriter } from "../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../helpers";
export const protobufPackage = "vesseloracle.vesseloracle";
/**
 * MsgUpdateParams is the Msg/UpdateParams request type.
 * @name MsgUpdateParams
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateParams
 */
export interface MsgUpdateParams {
  /**
   * authority is the address that controls the module (defaults to x/gov unless overwritten).
   */
  authority: string;
  /**
   * NOTE: All parameters must be supplied.
   */
  params: Params;
}
/**
 * MsgUpdateParamsResponse defines the response structure for executing a
 * MsgUpdateParams message.
 * @name MsgUpdateParamsResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateParamsResponse
 */
export interface MsgUpdateParamsResponse {}
/**
 * @name MsgCreateVessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateVessel
 */
export interface MsgCreateVessel {
  creator: string;
  imo: string;
  ts: bigint;
  source: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  heading: number;
  adt: bigint;
  eta: bigint;
  name: string;
  destport: string;
  depport: string;
  mmsi: string;
}
/**
 * @name MsgCreateVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateVesselResponse
 */
export interface MsgCreateVesselResponse {}
/**
 * @name MsgUpdateVessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateVessel
 */
export interface MsgUpdateVessel {
  creator: string;
  imo: string;
  ts: bigint;
  source: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  heading: number;
  adt: bigint;
  eta: bigint;
  name: string;
  destport: string;
  depport: string;
  mmsi: string;
}
/**
 * @name MsgUpdateVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateVesselResponse
 */
export interface MsgUpdateVesselResponse {}
/**
 * @name MsgDeleteVessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteVessel
 */
export interface MsgDeleteVessel {
  creator: string;
  imo: string;
  ts: bigint;
  source: string;
}
/**
 * @name MsgDeleteVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteVesselResponse
 */
export interface MsgDeleteVesselResponse {}
/**
 * @name MsgConsolidateReports
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgConsolidateReports
 */
export interface MsgConsolidateReports {
  creator: string;
  imo: string;
}
/**
 * @name MsgConsolidateReportsResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgConsolidateReportsResponse
 */
export interface MsgConsolidateReportsResponse {
  imo: string;
  ts: bigint;
}
/**
 * @name MsgCreateConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateConsolidatedDataReport
 */
export interface MsgCreateConsolidatedDataReport {
  creator: string;
  imo: string;
  ts: bigint;
  totalSamples: number;
  etaOutliers: number;
  etaMeanCleaned: bigint;
  etaMeanAll: bigint;
  etaStdCleaned: bigint;
  etaStdAll: bigint;
  depportScore: number;
  depport: string;
}
/**
 * @name MsgCreateConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateConsolidatedDataReportResponse
 */
export interface MsgCreateConsolidatedDataReportResponse {}
/**
 * @name MsgUpdateConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateConsolidatedDataReport
 */
export interface MsgUpdateConsolidatedDataReport {
  creator: string;
  imo: string;
  ts: bigint;
  totalSamples: number;
  etaOutliers: number;
  etaMeanCleaned: bigint;
  etaMeanAll: bigint;
  etaStdCleaned: bigint;
  etaStdAll: bigint;
  depportScore: number;
  depport: string;
}
/**
 * @name MsgUpdateConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateConsolidatedDataReportResponse
 */
export interface MsgUpdateConsolidatedDataReportResponse {}
/**
 * @name MsgDeleteConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteConsolidatedDataReport
 */
export interface MsgDeleteConsolidatedDataReport {
  creator: string;
  imo: string;
  ts: bigint;
}
/**
 * @name MsgDeleteConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteConsolidatedDataReportResponse
 */
export interface MsgDeleteConsolidatedDataReportResponse {}
function createBaseMsgUpdateParams(): MsgUpdateParams {
  return {
    authority: "",
    params: Params.fromPartial({}),
  };
}
/**
 * MsgUpdateParams is the Msg/UpdateParams request type.
 * @name MsgUpdateParams
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateParams
 */
export const MsgUpdateParams = {
  typeUrl: "/vesseloracle.vesseloracle.MsgUpdateParams",
  encode(message: MsgUpdateParams, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.authority !== "") {
      writer.uint32(10).string(message.authority);
    }
    if (message.params !== undefined) {
      Params.encode(message.params, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateParams {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateParams();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.authority = reader.string();
          break;
        case 2:
          message.params = Params.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgUpdateParams {
    const obj = createBaseMsgUpdateParams();
    if (isSet(object.authority)) obj.authority = String(object.authority);
    if (isSet(object.params)) obj.params = Params.fromJSON(object.params);
    return obj;
  },
  toJSON(message: MsgUpdateParams): unknown {
    const obj: any = {};
    message.authority !== undefined && (obj.authority = message.authority);
    message.params !== undefined && (obj.params = message.params ? Params.toJSON(message.params) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateParams>, I>>(object: I): MsgUpdateParams {
    const message = createBaseMsgUpdateParams();
    message.authority = object.authority ?? "";
    if (object.params !== undefined && object.params !== null) {
      message.params = Params.fromPartial(object.params);
    }
    return message;
  },
};
function createBaseMsgUpdateParamsResponse(): MsgUpdateParamsResponse {
  return {};
}
/**
 * MsgUpdateParamsResponse defines the response structure for executing a
 * MsgUpdateParams message.
 * @name MsgUpdateParamsResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateParamsResponse
 */
export const MsgUpdateParamsResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgUpdateParamsResponse",
  encode(_: MsgUpdateParamsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateParamsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateParamsResponse();
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
  fromJSON(_: any): MsgUpdateParamsResponse {
    const obj = createBaseMsgUpdateParamsResponse();
    return obj;
  },
  toJSON(_: MsgUpdateParamsResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateParamsResponse>, I>>(_: I): MsgUpdateParamsResponse {
    const message = createBaseMsgUpdateParamsResponse();
    return message;
  },
};
function createBaseMsgCreateVessel(): MsgCreateVessel {
  return {
    creator: "",
    imo: "",
    ts: BigInt(0),
    source: "",
    lat: 0,
    lon: 0,
    speed: 0,
    course: 0,
    heading: 0,
    adt: BigInt(0),
    eta: BigInt(0),
    name: "",
    destport: "",
    depport: "",
    mmsi: "",
  };
}
/**
 * @name MsgCreateVessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateVessel
 */
export const MsgCreateVessel = {
  typeUrl: "/vesseloracle.vesseloracle.MsgCreateVessel",
  encode(message: MsgCreateVessel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") {
      writer.uint32(10).string(message.creator);
    }
    if (message.imo !== "") {
      writer.uint32(18).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(24).uint64(message.ts);
    }
    if (message.source !== "") {
      writer.uint32(34).string(message.source);
    }
    if (message.lat !== 0) {
      writer.uint32(40).int32(message.lat);
    }
    if (message.lon !== 0) {
      writer.uint32(48).int32(message.lon);
    }
    if (message.speed !== 0) {
      writer.uint32(56).int32(message.speed);
    }
    if (message.course !== 0) {
      writer.uint32(64).int32(message.course);
    }
    if (message.heading !== 0) {
      writer.uint32(72).int32(message.heading);
    }
    if (message.adt !== BigInt(0)) {
      writer.uint32(80).uint64(message.adt);
    }
    if (message.eta !== BigInt(0)) {
      writer.uint32(88).uint64(message.eta);
    }
    if (message.name !== "") {
      writer.uint32(98).string(message.name);
    }
    if (message.destport !== "") {
      writer.uint32(106).string(message.destport);
    }
    if (message.depport !== "") {
      writer.uint32(114).string(message.depport);
    }
    if (message.mmsi !== "") {
      writer.uint32(122).string(message.mmsi);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateVessel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgCreateVessel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.imo = reader.string();
          break;
        case 3:
          message.ts = reader.uint64();
          break;
        case 4:
          message.source = reader.string();
          break;
        case 5:
          message.lat = reader.int32();
          break;
        case 6:
          message.lon = reader.int32();
          break;
        case 7:
          message.speed = reader.int32();
          break;
        case 8:
          message.course = reader.int32();
          break;
        case 9:
          message.heading = reader.int32();
          break;
        case 10:
          message.adt = reader.uint64();
          break;
        case 11:
          message.eta = reader.uint64();
          break;
        case 12:
          message.name = reader.string();
          break;
        case 13:
          message.destport = reader.string();
          break;
        case 14:
          message.depport = reader.string();
          break;
        case 15:
          message.mmsi = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgCreateVessel {
    const obj = createBaseMsgCreateVessel();
    if (isSet(object.creator)) obj.creator = String(object.creator);
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.source)) obj.source = String(object.source);
    if (isSet(object.lat)) obj.lat = Number(object.lat);
    if (isSet(object.lon)) obj.lon = Number(object.lon);
    if (isSet(object.speed)) obj.speed = Number(object.speed);
    if (isSet(object.course)) obj.course = Number(object.course);
    if (isSet(object.heading)) obj.heading = Number(object.heading);
    if (isSet(object.adt)) obj.adt = BigInt(object.adt.toString());
    if (isSet(object.eta)) obj.eta = BigInt(object.eta.toString());
    if (isSet(object.name)) obj.name = String(object.name);
    if (isSet(object.destport)) obj.destport = String(object.destport);
    if (isSet(object.depport)) obj.depport = String(object.depport);
    if (isSet(object.mmsi)) obj.mmsi = String(object.mmsi);
    return obj;
  },
  toJSON(message: MsgCreateVessel): unknown {
    const obj: any = {};
    message.creator !== undefined && (obj.creator = message.creator);
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.source !== undefined && (obj.source = message.source);
    message.lat !== undefined && (obj.lat = Math.round(message.lat));
    message.lon !== undefined && (obj.lon = Math.round(message.lon));
    message.speed !== undefined && (obj.speed = Math.round(message.speed));
    message.course !== undefined && (obj.course = Math.round(message.course));
    message.heading !== undefined && (obj.heading = Math.round(message.heading));
    message.adt !== undefined && (obj.adt = (message.adt || BigInt(0)).toString());
    message.eta !== undefined && (obj.eta = (message.eta || BigInt(0)).toString());
    message.name !== undefined && (obj.name = message.name);
    message.destport !== undefined && (obj.destport = message.destport);
    message.depport !== undefined && (obj.depport = message.depport);
    message.mmsi !== undefined && (obj.mmsi = message.mmsi);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgCreateVessel>, I>>(object: I): MsgCreateVessel {
    const message = createBaseMsgCreateVessel();
    message.creator = object.creator ?? "";
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.source = object.source ?? "";
    message.lat = object.lat ?? 0;
    message.lon = object.lon ?? 0;
    message.speed = object.speed ?? 0;
    message.course = object.course ?? 0;
    message.heading = object.heading ?? 0;
    if (object.adt !== undefined && object.adt !== null) {
      message.adt = BigInt(object.adt.toString());
    }
    if (object.eta !== undefined && object.eta !== null) {
      message.eta = BigInt(object.eta.toString());
    }
    message.name = object.name ?? "";
    message.destport = object.destport ?? "";
    message.depport = object.depport ?? "";
    message.mmsi = object.mmsi ?? "";
    return message;
  },
};
function createBaseMsgCreateVesselResponse(): MsgCreateVesselResponse {
  return {};
}
/**
 * @name MsgCreateVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateVesselResponse
 */
export const MsgCreateVesselResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgCreateVesselResponse",
  encode(_: MsgCreateVesselResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateVesselResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgCreateVesselResponse();
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
  fromJSON(_: any): MsgCreateVesselResponse {
    const obj = createBaseMsgCreateVesselResponse();
    return obj;
  },
  toJSON(_: MsgCreateVesselResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgCreateVesselResponse>, I>>(_: I): MsgCreateVesselResponse {
    const message = createBaseMsgCreateVesselResponse();
    return message;
  },
};
function createBaseMsgUpdateVessel(): MsgUpdateVessel {
  return {
    creator: "",
    imo: "",
    ts: BigInt(0),
    source: "",
    lat: 0,
    lon: 0,
    speed: 0,
    course: 0,
    heading: 0,
    adt: BigInt(0),
    eta: BigInt(0),
    name: "",
    destport: "",
    depport: "",
    mmsi: "",
  };
}
/**
 * @name MsgUpdateVessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateVessel
 */
export const MsgUpdateVessel = {
  typeUrl: "/vesseloracle.vesseloracle.MsgUpdateVessel",
  encode(message: MsgUpdateVessel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") {
      writer.uint32(10).string(message.creator);
    }
    if (message.imo !== "") {
      writer.uint32(18).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(24).uint64(message.ts);
    }
    if (message.source !== "") {
      writer.uint32(34).string(message.source);
    }
    if (message.lat !== 0) {
      writer.uint32(40).int32(message.lat);
    }
    if (message.lon !== 0) {
      writer.uint32(48).int32(message.lon);
    }
    if (message.speed !== 0) {
      writer.uint32(56).int32(message.speed);
    }
    if (message.course !== 0) {
      writer.uint32(64).int32(message.course);
    }
    if (message.heading !== 0) {
      writer.uint32(72).int32(message.heading);
    }
    if (message.adt !== BigInt(0)) {
      writer.uint32(80).uint64(message.adt);
    }
    if (message.eta !== BigInt(0)) {
      writer.uint32(88).uint64(message.eta);
    }
    if (message.name !== "") {
      writer.uint32(98).string(message.name);
    }
    if (message.destport !== "") {
      writer.uint32(106).string(message.destport);
    }
    if (message.depport !== "") {
      writer.uint32(114).string(message.depport);
    }
    if (message.mmsi !== "") {
      writer.uint32(122).string(message.mmsi);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateVessel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateVessel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.imo = reader.string();
          break;
        case 3:
          message.ts = reader.uint64();
          break;
        case 4:
          message.source = reader.string();
          break;
        case 5:
          message.lat = reader.int32();
          break;
        case 6:
          message.lon = reader.int32();
          break;
        case 7:
          message.speed = reader.int32();
          break;
        case 8:
          message.course = reader.int32();
          break;
        case 9:
          message.heading = reader.int32();
          break;
        case 10:
          message.adt = reader.uint64();
          break;
        case 11:
          message.eta = reader.uint64();
          break;
        case 12:
          message.name = reader.string();
          break;
        case 13:
          message.destport = reader.string();
          break;
        case 14:
          message.depport = reader.string();
          break;
        case 15:
          message.mmsi = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgUpdateVessel {
    const obj = createBaseMsgUpdateVessel();
    if (isSet(object.creator)) obj.creator = String(object.creator);
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.source)) obj.source = String(object.source);
    if (isSet(object.lat)) obj.lat = Number(object.lat);
    if (isSet(object.lon)) obj.lon = Number(object.lon);
    if (isSet(object.speed)) obj.speed = Number(object.speed);
    if (isSet(object.course)) obj.course = Number(object.course);
    if (isSet(object.heading)) obj.heading = Number(object.heading);
    if (isSet(object.adt)) obj.adt = BigInt(object.adt.toString());
    if (isSet(object.eta)) obj.eta = BigInt(object.eta.toString());
    if (isSet(object.name)) obj.name = String(object.name);
    if (isSet(object.destport)) obj.destport = String(object.destport);
    if (isSet(object.depport)) obj.depport = String(object.depport);
    if (isSet(object.mmsi)) obj.mmsi = String(object.mmsi);
    return obj;
  },
  toJSON(message: MsgUpdateVessel): unknown {
    const obj: any = {};
    message.creator !== undefined && (obj.creator = message.creator);
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.source !== undefined && (obj.source = message.source);
    message.lat !== undefined && (obj.lat = Math.round(message.lat));
    message.lon !== undefined && (obj.lon = Math.round(message.lon));
    message.speed !== undefined && (obj.speed = Math.round(message.speed));
    message.course !== undefined && (obj.course = Math.round(message.course));
    message.heading !== undefined && (obj.heading = Math.round(message.heading));
    message.adt !== undefined && (obj.adt = (message.adt || BigInt(0)).toString());
    message.eta !== undefined && (obj.eta = (message.eta || BigInt(0)).toString());
    message.name !== undefined && (obj.name = message.name);
    message.destport !== undefined && (obj.destport = message.destport);
    message.depport !== undefined && (obj.depport = message.depport);
    message.mmsi !== undefined && (obj.mmsi = message.mmsi);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateVessel>, I>>(object: I): MsgUpdateVessel {
    const message = createBaseMsgUpdateVessel();
    message.creator = object.creator ?? "";
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.source = object.source ?? "";
    message.lat = object.lat ?? 0;
    message.lon = object.lon ?? 0;
    message.speed = object.speed ?? 0;
    message.course = object.course ?? 0;
    message.heading = object.heading ?? 0;
    if (object.adt !== undefined && object.adt !== null) {
      message.adt = BigInt(object.adt.toString());
    }
    if (object.eta !== undefined && object.eta !== null) {
      message.eta = BigInt(object.eta.toString());
    }
    message.name = object.name ?? "";
    message.destport = object.destport ?? "";
    message.depport = object.depport ?? "";
    message.mmsi = object.mmsi ?? "";
    return message;
  },
};
function createBaseMsgUpdateVesselResponse(): MsgUpdateVesselResponse {
  return {};
}
/**
 * @name MsgUpdateVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateVesselResponse
 */
export const MsgUpdateVesselResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgUpdateVesselResponse",
  encode(_: MsgUpdateVesselResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateVesselResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateVesselResponse();
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
  fromJSON(_: any): MsgUpdateVesselResponse {
    const obj = createBaseMsgUpdateVesselResponse();
    return obj;
  },
  toJSON(_: MsgUpdateVesselResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateVesselResponse>, I>>(_: I): MsgUpdateVesselResponse {
    const message = createBaseMsgUpdateVesselResponse();
    return message;
  },
};
function createBaseMsgDeleteVessel(): MsgDeleteVessel {
  return {
    creator: "",
    imo: "",
    ts: BigInt(0),
    source: "",
  };
}
/**
 * @name MsgDeleteVessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteVessel
 */
export const MsgDeleteVessel = {
  typeUrl: "/vesseloracle.vesseloracle.MsgDeleteVessel",
  encode(message: MsgDeleteVessel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") {
      writer.uint32(10).string(message.creator);
    }
    if (message.imo !== "") {
      writer.uint32(18).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(24).uint64(message.ts);
    }
    if (message.source !== "") {
      writer.uint32(34).string(message.source);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgDeleteVessel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgDeleteVessel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.imo = reader.string();
          break;
        case 3:
          message.ts = reader.uint64();
          break;
        case 4:
          message.source = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgDeleteVessel {
    const obj = createBaseMsgDeleteVessel();
    if (isSet(object.creator)) obj.creator = String(object.creator);
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.source)) obj.source = String(object.source);
    return obj;
  },
  toJSON(message: MsgDeleteVessel): unknown {
    const obj: any = {};
    message.creator !== undefined && (obj.creator = message.creator);
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.source !== undefined && (obj.source = message.source);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgDeleteVessel>, I>>(object: I): MsgDeleteVessel {
    const message = createBaseMsgDeleteVessel();
    message.creator = object.creator ?? "";
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.source = object.source ?? "";
    return message;
  },
};
function createBaseMsgDeleteVesselResponse(): MsgDeleteVesselResponse {
  return {};
}
/**
 * @name MsgDeleteVesselResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteVesselResponse
 */
export const MsgDeleteVesselResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgDeleteVesselResponse",
  encode(_: MsgDeleteVesselResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgDeleteVesselResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgDeleteVesselResponse();
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
  fromJSON(_: any): MsgDeleteVesselResponse {
    const obj = createBaseMsgDeleteVesselResponse();
    return obj;
  },
  toJSON(_: MsgDeleteVesselResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgDeleteVesselResponse>, I>>(_: I): MsgDeleteVesselResponse {
    const message = createBaseMsgDeleteVesselResponse();
    return message;
  },
};
function createBaseMsgConsolidateReports(): MsgConsolidateReports {
  return {
    creator: "",
    imo: "",
  };
}
/**
 * @name MsgConsolidateReports
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgConsolidateReports
 */
export const MsgConsolidateReports = {
  typeUrl: "/vesseloracle.vesseloracle.MsgConsolidateReports",
  encode(message: MsgConsolidateReports, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") {
      writer.uint32(10).string(message.creator);
    }
    if (message.imo !== "") {
      writer.uint32(18).string(message.imo);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConsolidateReports {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConsolidateReports();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.imo = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgConsolidateReports {
    const obj = createBaseMsgConsolidateReports();
    if (isSet(object.creator)) obj.creator = String(object.creator);
    if (isSet(object.imo)) obj.imo = String(object.imo);
    return obj;
  },
  toJSON(message: MsgConsolidateReports): unknown {
    const obj: any = {};
    message.creator !== undefined && (obj.creator = message.creator);
    message.imo !== undefined && (obj.imo = message.imo);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConsolidateReports>, I>>(object: I): MsgConsolidateReports {
    const message = createBaseMsgConsolidateReports();
    message.creator = object.creator ?? "";
    message.imo = object.imo ?? "";
    return message;
  },
};
function createBaseMsgConsolidateReportsResponse(): MsgConsolidateReportsResponse {
  return {
    imo: "",
    ts: BigInt(0),
  };
}
/**
 * @name MsgConsolidateReportsResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgConsolidateReportsResponse
 */
export const MsgConsolidateReportsResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgConsolidateReportsResponse",
  encode(message: MsgConsolidateReportsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.imo !== "") {
      writer.uint32(10).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(16).uint64(message.ts);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConsolidateReportsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgConsolidateReportsResponse();
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
  fromJSON(object: any): MsgConsolidateReportsResponse {
    const obj = createBaseMsgConsolidateReportsResponse();
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    return obj;
  },
  toJSON(message: MsgConsolidateReportsResponse): unknown {
    const obj: any = {};
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgConsolidateReportsResponse>, I>>(
    object: I,
  ): MsgConsolidateReportsResponse {
    const message = createBaseMsgConsolidateReportsResponse();
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    return message;
  },
};
function createBaseMsgCreateConsolidatedDataReport(): MsgCreateConsolidatedDataReport {
  return {
    creator: "",
    imo: "",
    ts: BigInt(0),
    totalSamples: 0,
    etaOutliers: 0,
    etaMeanCleaned: BigInt(0),
    etaMeanAll: BigInt(0),
    etaStdCleaned: BigInt(0),
    etaStdAll: BigInt(0),
    depportScore: 0,
    depport: "",
  };
}
/**
 * @name MsgCreateConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateConsolidatedDataReport
 */
export const MsgCreateConsolidatedDataReport = {
  typeUrl: "/vesseloracle.vesseloracle.MsgCreateConsolidatedDataReport",
  encode(
    message: MsgCreateConsolidatedDataReport,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.creator !== "") {
      writer.uint32(10).string(message.creator);
    }
    if (message.imo !== "") {
      writer.uint32(18).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(24).uint64(message.ts);
    }
    if (message.totalSamples !== 0) {
      writer.uint32(32).int32(message.totalSamples);
    }
    if (message.etaOutliers !== 0) {
      writer.uint32(40).int32(message.etaOutliers);
    }
    if (message.etaMeanCleaned !== BigInt(0)) {
      writer.uint32(48).uint64(message.etaMeanCleaned);
    }
    if (message.etaMeanAll !== BigInt(0)) {
      writer.uint32(56).uint64(message.etaMeanAll);
    }
    if (message.etaStdCleaned !== BigInt(0)) {
      writer.uint32(64).uint64(message.etaStdCleaned);
    }
    if (message.etaStdAll !== BigInt(0)) {
      writer.uint32(72).uint64(message.etaStdAll);
    }
    if (message.depportScore !== 0) {
      writer.uint32(80).int32(message.depportScore);
    }
    if (message.depport !== "") {
      writer.uint32(90).string(message.depport);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateConsolidatedDataReport {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgCreateConsolidatedDataReport();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.imo = reader.string();
          break;
        case 3:
          message.ts = reader.uint64();
          break;
        case 4:
          message.totalSamples = reader.int32();
          break;
        case 5:
          message.etaOutliers = reader.int32();
          break;
        case 6:
          message.etaMeanCleaned = reader.uint64();
          break;
        case 7:
          message.etaMeanAll = reader.uint64();
          break;
        case 8:
          message.etaStdCleaned = reader.uint64();
          break;
        case 9:
          message.etaStdAll = reader.uint64();
          break;
        case 10:
          message.depportScore = reader.int32();
          break;
        case 11:
          message.depport = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgCreateConsolidatedDataReport {
    const obj = createBaseMsgCreateConsolidatedDataReport();
    if (isSet(object.creator)) obj.creator = String(object.creator);
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.totalSamples)) obj.totalSamples = Number(object.totalSamples);
    if (isSet(object.etaOutliers)) obj.etaOutliers = Number(object.etaOutliers);
    if (isSet(object.etaMeanCleaned)) obj.etaMeanCleaned = BigInt(object.etaMeanCleaned.toString());
    if (isSet(object.etaMeanAll)) obj.etaMeanAll = BigInt(object.etaMeanAll.toString());
    if (isSet(object.etaStdCleaned)) obj.etaStdCleaned = BigInt(object.etaStdCleaned.toString());
    if (isSet(object.etaStdAll)) obj.etaStdAll = BigInt(object.etaStdAll.toString());
    if (isSet(object.depportScore)) obj.depportScore = Number(object.depportScore);
    if (isSet(object.depport)) obj.depport = String(object.depport);
    return obj;
  },
  toJSON(message: MsgCreateConsolidatedDataReport): unknown {
    const obj: any = {};
    message.creator !== undefined && (obj.creator = message.creator);
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.totalSamples !== undefined && (obj.totalSamples = Math.round(message.totalSamples));
    message.etaOutliers !== undefined && (obj.etaOutliers = Math.round(message.etaOutliers));
    message.etaMeanCleaned !== undefined &&
      (obj.etaMeanCleaned = (message.etaMeanCleaned || BigInt(0)).toString());
    message.etaMeanAll !== undefined && (obj.etaMeanAll = (message.etaMeanAll || BigInt(0)).toString());
    message.etaStdCleaned !== undefined &&
      (obj.etaStdCleaned = (message.etaStdCleaned || BigInt(0)).toString());
    message.etaStdAll !== undefined && (obj.etaStdAll = (message.etaStdAll || BigInt(0)).toString());
    message.depportScore !== undefined && (obj.depportScore = Math.round(message.depportScore));
    message.depport !== undefined && (obj.depport = message.depport);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgCreateConsolidatedDataReport>, I>>(
    object: I,
  ): MsgCreateConsolidatedDataReport {
    const message = createBaseMsgCreateConsolidatedDataReport();
    message.creator = object.creator ?? "";
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.totalSamples = object.totalSamples ?? 0;
    message.etaOutliers = object.etaOutliers ?? 0;
    if (object.etaMeanCleaned !== undefined && object.etaMeanCleaned !== null) {
      message.etaMeanCleaned = BigInt(object.etaMeanCleaned.toString());
    }
    if (object.etaMeanAll !== undefined && object.etaMeanAll !== null) {
      message.etaMeanAll = BigInt(object.etaMeanAll.toString());
    }
    if (object.etaStdCleaned !== undefined && object.etaStdCleaned !== null) {
      message.etaStdCleaned = BigInt(object.etaStdCleaned.toString());
    }
    if (object.etaStdAll !== undefined && object.etaStdAll !== null) {
      message.etaStdAll = BigInt(object.etaStdAll.toString());
    }
    message.depportScore = object.depportScore ?? 0;
    message.depport = object.depport ?? "";
    return message;
  },
};
function createBaseMsgCreateConsolidatedDataReportResponse(): MsgCreateConsolidatedDataReportResponse {
  return {};
}
/**
 * @name MsgCreateConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgCreateConsolidatedDataReportResponse
 */
export const MsgCreateConsolidatedDataReportResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgCreateConsolidatedDataReportResponse",
  encode(
    _: MsgCreateConsolidatedDataReportResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateConsolidatedDataReportResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgCreateConsolidatedDataReportResponse();
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
  fromJSON(_: any): MsgCreateConsolidatedDataReportResponse {
    const obj = createBaseMsgCreateConsolidatedDataReportResponse();
    return obj;
  },
  toJSON(_: MsgCreateConsolidatedDataReportResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgCreateConsolidatedDataReportResponse>, I>>(
    _: I,
  ): MsgCreateConsolidatedDataReportResponse {
    const message = createBaseMsgCreateConsolidatedDataReportResponse();
    return message;
  },
};
function createBaseMsgUpdateConsolidatedDataReport(): MsgUpdateConsolidatedDataReport {
  return {
    creator: "",
    imo: "",
    ts: BigInt(0),
    totalSamples: 0,
    etaOutliers: 0,
    etaMeanCleaned: BigInt(0),
    etaMeanAll: BigInt(0),
    etaStdCleaned: BigInt(0),
    etaStdAll: BigInt(0),
    depportScore: 0,
    depport: "",
  };
}
/**
 * @name MsgUpdateConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateConsolidatedDataReport
 */
export const MsgUpdateConsolidatedDataReport = {
  typeUrl: "/vesseloracle.vesseloracle.MsgUpdateConsolidatedDataReport",
  encode(
    message: MsgUpdateConsolidatedDataReport,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.creator !== "") {
      writer.uint32(10).string(message.creator);
    }
    if (message.imo !== "") {
      writer.uint32(18).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(24).uint64(message.ts);
    }
    if (message.totalSamples !== 0) {
      writer.uint32(32).int32(message.totalSamples);
    }
    if (message.etaOutliers !== 0) {
      writer.uint32(40).int32(message.etaOutliers);
    }
    if (message.etaMeanCleaned !== BigInt(0)) {
      writer.uint32(48).uint64(message.etaMeanCleaned);
    }
    if (message.etaMeanAll !== BigInt(0)) {
      writer.uint32(56).uint64(message.etaMeanAll);
    }
    if (message.etaStdCleaned !== BigInt(0)) {
      writer.uint32(64).uint64(message.etaStdCleaned);
    }
    if (message.etaStdAll !== BigInt(0)) {
      writer.uint32(72).uint64(message.etaStdAll);
    }
    if (message.depportScore !== 0) {
      writer.uint32(80).int32(message.depportScore);
    }
    if (message.depport !== "") {
      writer.uint32(90).string(message.depport);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateConsolidatedDataReport {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateConsolidatedDataReport();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.imo = reader.string();
          break;
        case 3:
          message.ts = reader.uint64();
          break;
        case 4:
          message.totalSamples = reader.int32();
          break;
        case 5:
          message.etaOutliers = reader.int32();
          break;
        case 6:
          message.etaMeanCleaned = reader.uint64();
          break;
        case 7:
          message.etaMeanAll = reader.uint64();
          break;
        case 8:
          message.etaStdCleaned = reader.uint64();
          break;
        case 9:
          message.etaStdAll = reader.uint64();
          break;
        case 10:
          message.depportScore = reader.int32();
          break;
        case 11:
          message.depport = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgUpdateConsolidatedDataReport {
    const obj = createBaseMsgUpdateConsolidatedDataReport();
    if (isSet(object.creator)) obj.creator = String(object.creator);
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.totalSamples)) obj.totalSamples = Number(object.totalSamples);
    if (isSet(object.etaOutliers)) obj.etaOutliers = Number(object.etaOutliers);
    if (isSet(object.etaMeanCleaned)) obj.etaMeanCleaned = BigInt(object.etaMeanCleaned.toString());
    if (isSet(object.etaMeanAll)) obj.etaMeanAll = BigInt(object.etaMeanAll.toString());
    if (isSet(object.etaStdCleaned)) obj.etaStdCleaned = BigInt(object.etaStdCleaned.toString());
    if (isSet(object.etaStdAll)) obj.etaStdAll = BigInt(object.etaStdAll.toString());
    if (isSet(object.depportScore)) obj.depportScore = Number(object.depportScore);
    if (isSet(object.depport)) obj.depport = String(object.depport);
    return obj;
  },
  toJSON(message: MsgUpdateConsolidatedDataReport): unknown {
    const obj: any = {};
    message.creator !== undefined && (obj.creator = message.creator);
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.totalSamples !== undefined && (obj.totalSamples = Math.round(message.totalSamples));
    message.etaOutliers !== undefined && (obj.etaOutliers = Math.round(message.etaOutliers));
    message.etaMeanCleaned !== undefined &&
      (obj.etaMeanCleaned = (message.etaMeanCleaned || BigInt(0)).toString());
    message.etaMeanAll !== undefined && (obj.etaMeanAll = (message.etaMeanAll || BigInt(0)).toString());
    message.etaStdCleaned !== undefined &&
      (obj.etaStdCleaned = (message.etaStdCleaned || BigInt(0)).toString());
    message.etaStdAll !== undefined && (obj.etaStdAll = (message.etaStdAll || BigInt(0)).toString());
    message.depportScore !== undefined && (obj.depportScore = Math.round(message.depportScore));
    message.depport !== undefined && (obj.depport = message.depport);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateConsolidatedDataReport>, I>>(
    object: I,
  ): MsgUpdateConsolidatedDataReport {
    const message = createBaseMsgUpdateConsolidatedDataReport();
    message.creator = object.creator ?? "";
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.totalSamples = object.totalSamples ?? 0;
    message.etaOutliers = object.etaOutliers ?? 0;
    if (object.etaMeanCleaned !== undefined && object.etaMeanCleaned !== null) {
      message.etaMeanCleaned = BigInt(object.etaMeanCleaned.toString());
    }
    if (object.etaMeanAll !== undefined && object.etaMeanAll !== null) {
      message.etaMeanAll = BigInt(object.etaMeanAll.toString());
    }
    if (object.etaStdCleaned !== undefined && object.etaStdCleaned !== null) {
      message.etaStdCleaned = BigInt(object.etaStdCleaned.toString());
    }
    if (object.etaStdAll !== undefined && object.etaStdAll !== null) {
      message.etaStdAll = BigInt(object.etaStdAll.toString());
    }
    message.depportScore = object.depportScore ?? 0;
    message.depport = object.depport ?? "";
    return message;
  },
};
function createBaseMsgUpdateConsolidatedDataReportResponse(): MsgUpdateConsolidatedDataReportResponse {
  return {};
}
/**
 * @name MsgUpdateConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgUpdateConsolidatedDataReportResponse
 */
export const MsgUpdateConsolidatedDataReportResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgUpdateConsolidatedDataReportResponse",
  encode(
    _: MsgUpdateConsolidatedDataReportResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateConsolidatedDataReportResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateConsolidatedDataReportResponse();
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
  fromJSON(_: any): MsgUpdateConsolidatedDataReportResponse {
    const obj = createBaseMsgUpdateConsolidatedDataReportResponse();
    return obj;
  },
  toJSON(_: MsgUpdateConsolidatedDataReportResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateConsolidatedDataReportResponse>, I>>(
    _: I,
  ): MsgUpdateConsolidatedDataReportResponse {
    const message = createBaseMsgUpdateConsolidatedDataReportResponse();
    return message;
  },
};
function createBaseMsgDeleteConsolidatedDataReport(): MsgDeleteConsolidatedDataReport {
  return {
    creator: "",
    imo: "",
    ts: BigInt(0),
  };
}
/**
 * @name MsgDeleteConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteConsolidatedDataReport
 */
export const MsgDeleteConsolidatedDataReport = {
  typeUrl: "/vesseloracle.vesseloracle.MsgDeleteConsolidatedDataReport",
  encode(
    message: MsgDeleteConsolidatedDataReport,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.creator !== "") {
      writer.uint32(10).string(message.creator);
    }
    if (message.imo !== "") {
      writer.uint32(18).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(24).uint64(message.ts);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgDeleteConsolidatedDataReport {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgDeleteConsolidatedDataReport();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.imo = reader.string();
          break;
        case 3:
          message.ts = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgDeleteConsolidatedDataReport {
    const obj = createBaseMsgDeleteConsolidatedDataReport();
    if (isSet(object.creator)) obj.creator = String(object.creator);
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    return obj;
  },
  toJSON(message: MsgDeleteConsolidatedDataReport): unknown {
    const obj: any = {};
    message.creator !== undefined && (obj.creator = message.creator);
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgDeleteConsolidatedDataReport>, I>>(
    object: I,
  ): MsgDeleteConsolidatedDataReport {
    const message = createBaseMsgDeleteConsolidatedDataReport();
    message.creator = object.creator ?? "";
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    return message;
  },
};
function createBaseMsgDeleteConsolidatedDataReportResponse(): MsgDeleteConsolidatedDataReportResponse {
  return {};
}
/**
 * @name MsgDeleteConsolidatedDataReportResponse
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.MsgDeleteConsolidatedDataReportResponse
 */
export const MsgDeleteConsolidatedDataReportResponse = {
  typeUrl: "/vesseloracle.vesseloracle.MsgDeleteConsolidatedDataReportResponse",
  encode(
    _: MsgDeleteConsolidatedDataReportResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgDeleteConsolidatedDataReportResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgDeleteConsolidatedDataReportResponse();
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
  fromJSON(_: any): MsgDeleteConsolidatedDataReportResponse {
    const obj = createBaseMsgDeleteConsolidatedDataReportResponse();
    return obj;
  },
  toJSON(_: MsgDeleteConsolidatedDataReportResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgDeleteConsolidatedDataReportResponse>, I>>(
    _: I,
  ): MsgDeleteConsolidatedDataReportResponse {
    const message = createBaseMsgDeleteConsolidatedDataReportResponse();
    return message;
  },
};
/** Msg defines the Msg service. */
export interface Msg {
  /**
   * UpdateParams defines a (governance) operation for updating the module
   * parameters. The authority defaults to the x/gov module account.
   */
  UpdateParams(request: MsgUpdateParams): Promise<MsgUpdateParamsResponse>;
  CreateVessel(request: MsgCreateVessel): Promise<MsgCreateVesselResponse>;
  UpdateVessel(request: MsgUpdateVessel): Promise<MsgUpdateVesselResponse>;
  DeleteVessel(request: MsgDeleteVessel): Promise<MsgDeleteVesselResponse>;
  ConsolidateReports(request: MsgConsolidateReports): Promise<MsgConsolidateReportsResponse>;
  CreateConsolidatedDataReport(
    request: MsgCreateConsolidatedDataReport,
  ): Promise<MsgCreateConsolidatedDataReportResponse>;
  UpdateConsolidatedDataReport(
    request: MsgUpdateConsolidatedDataReport,
  ): Promise<MsgUpdateConsolidatedDataReportResponse>;
  DeleteConsolidatedDataReport(
    request: MsgDeleteConsolidatedDataReport,
  ): Promise<MsgDeleteConsolidatedDataReportResponse>;
}
export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.UpdateParams = this.UpdateParams.bind(this);
    this.CreateVessel = this.CreateVessel.bind(this);
    this.UpdateVessel = this.UpdateVessel.bind(this);
    this.DeleteVessel = this.DeleteVessel.bind(this);
    this.ConsolidateReports = this.ConsolidateReports.bind(this);
    this.CreateConsolidatedDataReport = this.CreateConsolidatedDataReport.bind(this);
    this.UpdateConsolidatedDataReport = this.UpdateConsolidatedDataReport.bind(this);
    this.DeleteConsolidatedDataReport = this.DeleteConsolidatedDataReport.bind(this);
  }
  UpdateParams(request: MsgUpdateParams): Promise<MsgUpdateParamsResponse> {
    const data = MsgUpdateParams.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "UpdateParams", data);
    return promise.then((data) => MsgUpdateParamsResponse.decode(new BinaryReader(data)));
  }
  CreateVessel(request: MsgCreateVessel): Promise<MsgCreateVesselResponse> {
    const data = MsgCreateVessel.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "CreateVessel", data);
    return promise.then((data) => MsgCreateVesselResponse.decode(new BinaryReader(data)));
  }
  UpdateVessel(request: MsgUpdateVessel): Promise<MsgUpdateVesselResponse> {
    const data = MsgUpdateVessel.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "UpdateVessel", data);
    return promise.then((data) => MsgUpdateVesselResponse.decode(new BinaryReader(data)));
  }
  DeleteVessel(request: MsgDeleteVessel): Promise<MsgDeleteVesselResponse> {
    const data = MsgDeleteVessel.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "DeleteVessel", data);
    return promise.then((data) => MsgDeleteVesselResponse.decode(new BinaryReader(data)));
  }
  ConsolidateReports(request: MsgConsolidateReports): Promise<MsgConsolidateReportsResponse> {
    const data = MsgConsolidateReports.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "ConsolidateReports", data);
    return promise.then((data) => MsgConsolidateReportsResponse.decode(new BinaryReader(data)));
  }
  CreateConsolidatedDataReport(
    request: MsgCreateConsolidatedDataReport,
  ): Promise<MsgCreateConsolidatedDataReportResponse> {
    const data = MsgCreateConsolidatedDataReport.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "CreateConsolidatedDataReport", data);
    return promise.then((data) => MsgCreateConsolidatedDataReportResponse.decode(new BinaryReader(data)));
  }
  UpdateConsolidatedDataReport(
    request: MsgUpdateConsolidatedDataReport,
  ): Promise<MsgUpdateConsolidatedDataReportResponse> {
    const data = MsgUpdateConsolidatedDataReport.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "UpdateConsolidatedDataReport", data);
    return promise.then((data) => MsgUpdateConsolidatedDataReportResponse.decode(new BinaryReader(data)));
  }
  DeleteConsolidatedDataReport(
    request: MsgDeleteConsolidatedDataReport,
  ): Promise<MsgDeleteConsolidatedDataReportResponse> {
    const data = MsgDeleteConsolidatedDataReport.encode(request).finish();
    const promise = this.rpc.request("vesseloracle.vesseloracle.Msg", "DeleteConsolidatedDataReport", data);
    return promise.then((data) => MsgDeleteConsolidatedDataReportResponse.decode(new BinaryReader(data)));
  }
}
export const createClientImpl = (rpc: Rpc) => {
  return new MsgClientImpl(rpc);
};
