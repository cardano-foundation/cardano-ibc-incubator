/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../binary";
import { DeepPartial, Exact, isSet } from "../../helpers";
export const protobufPackage = "vesseloracle.vesseloracle";
/**
 * @name VesselIndexImo
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.VesselIndexImo
 */
export interface VesselIndexImo {
  keys: VesselIndexImo_Key[];
}
/**
 * @name VesselIndexImo_Key
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.Key
 */
export interface VesselIndexImo_Key {
  imo: string;
  ts: bigint;
  source: string;
}
function createBaseVesselIndexImo(): VesselIndexImo {
  return {
    keys: [],
  };
}
/**
 * @name VesselIndexImo
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.VesselIndexImo
 */
export const VesselIndexImo = {
  typeUrl: "/vesseloracle.vesseloracle.VesselIndexImo",
  encode(message: VesselIndexImo, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.keys) {
      VesselIndexImo_Key.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): VesselIndexImo {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseVesselIndexImo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.keys.push(VesselIndexImo_Key.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): VesselIndexImo {
    const obj = createBaseVesselIndexImo();
    if (Array.isArray(object?.keys)) obj.keys = object.keys.map((e: any) => VesselIndexImo_Key.fromJSON(e));
    return obj;
  },
  toJSON(message: VesselIndexImo): unknown {
    const obj: any = {};
    if (message.keys) {
      obj.keys = message.keys.map((e) => (e ? VesselIndexImo_Key.toJSON(e) : undefined));
    } else {
      obj.keys = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<VesselIndexImo>, I>>(object: I): VesselIndexImo {
    const message = createBaseVesselIndexImo();
    message.keys = object.keys?.map((e) => VesselIndexImo_Key.fromPartial(e)) || [];
    return message;
  },
};
function createBaseVesselIndexImo_Key(): VesselIndexImo_Key {
  return {
    imo: "",
    ts: BigInt(0),
    source: "",
  };
}
/**
 * @name VesselIndexImo_Key
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.Key
 */
export const VesselIndexImo_Key = {
  typeUrl: "/vesseloracle.vesseloracle.Key",
  encode(message: VesselIndexImo_Key, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
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
  decode(input: BinaryReader | Uint8Array, length?: number): VesselIndexImo_Key {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseVesselIndexImo_Key();
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
  fromJSON(object: any): VesselIndexImo_Key {
    const obj = createBaseVesselIndexImo_Key();
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.source)) obj.source = String(object.source);
    return obj;
  },
  toJSON(message: VesselIndexImo_Key): unknown {
    const obj: any = {};
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.source !== undefined && (obj.source = message.source);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<VesselIndexImo_Key>, I>>(object: I): VesselIndexImo_Key {
    const message = createBaseVesselIndexImo_Key();
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.source = object.source ?? "";
    return message;
  },
};
