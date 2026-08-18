/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../binary";
import { isSet, DeepPartial, Exact } from "../../helpers";
export const protobufPackage = "vesseloracle.vesseloracle";
/**
 * @name Vessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.Vessel
 */
export interface Vessel {
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
  creator: string;
}
function createBaseVessel(): Vessel {
  return {
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
    creator: "",
  };
}
/**
 * @name Vessel
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.Vessel
 */
export const Vessel = {
  typeUrl: "/vesseloracle.vesseloracle.Vessel",
  encode(message: Vessel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.imo !== "") {
      writer.uint32(10).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(16).uint64(message.ts);
    }
    if (message.source !== "") {
      writer.uint32(26).string(message.source);
    }
    if (message.lat !== 0) {
      writer.uint32(32).int32(message.lat);
    }
    if (message.lon !== 0) {
      writer.uint32(40).int32(message.lon);
    }
    if (message.speed !== 0) {
      writer.uint32(48).int32(message.speed);
    }
    if (message.course !== 0) {
      writer.uint32(56).int32(message.course);
    }
    if (message.heading !== 0) {
      writer.uint32(64).int32(message.heading);
    }
    if (message.adt !== BigInt(0)) {
      writer.uint32(72).uint64(message.adt);
    }
    if (message.eta !== BigInt(0)) {
      writer.uint32(80).uint64(message.eta);
    }
    if (message.name !== "") {
      writer.uint32(90).string(message.name);
    }
    if (message.destport !== "") {
      writer.uint32(98).string(message.destport);
    }
    if (message.depport !== "") {
      writer.uint32(106).string(message.depport);
    }
    if (message.mmsi !== "") {
      writer.uint32(114).string(message.mmsi);
    }
    if (message.creator !== "") {
      writer.uint32(122).string(message.creator);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Vessel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseVessel();
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
        case 4:
          message.lat = reader.int32();
          break;
        case 5:
          message.lon = reader.int32();
          break;
        case 6:
          message.speed = reader.int32();
          break;
        case 7:
          message.course = reader.int32();
          break;
        case 8:
          message.heading = reader.int32();
          break;
        case 9:
          message.adt = reader.uint64();
          break;
        case 10:
          message.eta = reader.uint64();
          break;
        case 11:
          message.name = reader.string();
          break;
        case 12:
          message.destport = reader.string();
          break;
        case 13:
          message.depport = reader.string();
          break;
        case 14:
          message.mmsi = reader.string();
          break;
        case 15:
          message.creator = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Vessel {
    const obj = createBaseVessel();
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
    if (isSet(object.creator)) obj.creator = String(object.creator);
    return obj;
  },
  toJSON(message: Vessel): unknown {
    const obj: any = {};
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
    message.creator !== undefined && (obj.creator = message.creator);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Vessel>, I>>(object: I): Vessel {
    const message = createBaseVessel();
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
    message.creator = object.creator ?? "";
    return message;
  },
};
