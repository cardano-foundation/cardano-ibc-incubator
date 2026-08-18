/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../binary";
import { isSet, DeepPartial, Exact } from "../../helpers";
export const protobufPackage = "vesseloracle.vesseloracle";
/**
 * @name ConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.ConsolidatedDataReport
 */
export interface ConsolidatedDataReport {
  imo: string;
  ts: bigint;
  total_samples: number;
  eta_outliers: number;
  eta_mean_cleaned: bigint;
  eta_mean_all: bigint;
  eta_std_cleaned: bigint;
  eta_std_all: bigint;
  depport_score: number;
  depport: string;
  creator: string;
}
function createBaseConsolidatedDataReport(): ConsolidatedDataReport {
  return {
    imo: "",
    ts: BigInt(0),
    total_samples: 0,
    eta_outliers: 0,
    eta_mean_cleaned: BigInt(0),
    eta_mean_all: BigInt(0),
    eta_std_cleaned: BigInt(0),
    eta_std_all: BigInt(0),
    depport_score: 0,
    depport: "",
    creator: "",
  };
}
/**
 * @name ConsolidatedDataReport
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.ConsolidatedDataReport
 */
export const ConsolidatedDataReport = {
  typeUrl: "/vesseloracle.vesseloracle.ConsolidatedDataReport",
  encode(message: ConsolidatedDataReport, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.imo !== "") {
      writer.uint32(10).string(message.imo);
    }
    if (message.ts !== BigInt(0)) {
      writer.uint32(16).uint64(message.ts);
    }
    if (message.total_samples !== 0) {
      writer.uint32(24).int32(message.total_samples);
    }
    if (message.eta_outliers !== 0) {
      writer.uint32(32).int32(message.eta_outliers);
    }
    if (message.eta_mean_cleaned !== BigInt(0)) {
      writer.uint32(40).uint64(message.eta_mean_cleaned);
    }
    if (message.eta_mean_all !== BigInt(0)) {
      writer.uint32(48).uint64(message.eta_mean_all);
    }
    if (message.eta_std_cleaned !== BigInt(0)) {
      writer.uint32(56).uint64(message.eta_std_cleaned);
    }
    if (message.eta_std_all !== BigInt(0)) {
      writer.uint32(64).uint64(message.eta_std_all);
    }
    if (message.depport_score !== 0) {
      writer.uint32(72).int32(message.depport_score);
    }
    if (message.depport !== "") {
      writer.uint32(82).string(message.depport);
    }
    if (message.creator !== "") {
      writer.uint32(90).string(message.creator);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ConsolidatedDataReport {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseConsolidatedDataReport();
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
          message.total_samples = reader.int32();
          break;
        case 4:
          message.eta_outliers = reader.int32();
          break;
        case 5:
          message.eta_mean_cleaned = reader.uint64();
          break;
        case 6:
          message.eta_mean_all = reader.uint64();
          break;
        case 7:
          message.eta_std_cleaned = reader.uint64();
          break;
        case 8:
          message.eta_std_all = reader.uint64();
          break;
        case 9:
          message.depport_score = reader.int32();
          break;
        case 10:
          message.depport = reader.string();
          break;
        case 11:
          message.creator = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ConsolidatedDataReport {
    const obj = createBaseConsolidatedDataReport();
    if (isSet(object.imo)) obj.imo = String(object.imo);
    if (isSet(object.ts)) obj.ts = BigInt(object.ts.toString());
    if (isSet(object.total_samples)) obj.total_samples = Number(object.total_samples);
    if (isSet(object.eta_outliers)) obj.eta_outliers = Number(object.eta_outliers);
    if (isSet(object.eta_mean_cleaned)) obj.eta_mean_cleaned = BigInt(object.eta_mean_cleaned.toString());
    if (isSet(object.eta_mean_all)) obj.eta_mean_all = BigInt(object.eta_mean_all.toString());
    if (isSet(object.eta_std_cleaned)) obj.eta_std_cleaned = BigInt(object.eta_std_cleaned.toString());
    if (isSet(object.eta_std_all)) obj.eta_std_all = BigInt(object.eta_std_all.toString());
    if (isSet(object.depport_score)) obj.depport_score = Number(object.depport_score);
    if (isSet(object.depport)) obj.depport = String(object.depport);
    if (isSet(object.creator)) obj.creator = String(object.creator);
    return obj;
  },
  toJSON(message: ConsolidatedDataReport): unknown {
    const obj: any = {};
    message.imo !== undefined && (obj.imo = message.imo);
    message.ts !== undefined && (obj.ts = (message.ts || BigInt(0)).toString());
    message.total_samples !== undefined && (obj.total_samples = Math.round(message.total_samples));
    message.eta_outliers !== undefined && (obj.eta_outliers = Math.round(message.eta_outliers));
    message.eta_mean_cleaned !== undefined &&
      (obj.eta_mean_cleaned = (message.eta_mean_cleaned || BigInt(0)).toString());
    message.eta_mean_all !== undefined && (obj.eta_mean_all = (message.eta_mean_all || BigInt(0)).toString());
    message.eta_std_cleaned !== undefined &&
      (obj.eta_std_cleaned = (message.eta_std_cleaned || BigInt(0)).toString());
    message.eta_std_all !== undefined && (obj.eta_std_all = (message.eta_std_all || BigInt(0)).toString());
    message.depport_score !== undefined && (obj.depport_score = Math.round(message.depport_score));
    message.depport !== undefined && (obj.depport = message.depport);
    message.creator !== undefined && (obj.creator = message.creator);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ConsolidatedDataReport>, I>>(object: I): ConsolidatedDataReport {
    const message = createBaseConsolidatedDataReport();
    message.imo = object.imo ?? "";
    if (object.ts !== undefined && object.ts !== null) {
      message.ts = BigInt(object.ts.toString());
    }
    message.total_samples = object.total_samples ?? 0;
    message.eta_outliers = object.eta_outliers ?? 0;
    if (object.eta_mean_cleaned !== undefined && object.eta_mean_cleaned !== null) {
      message.eta_mean_cleaned = BigInt(object.eta_mean_cleaned.toString());
    }
    if (object.eta_mean_all !== undefined && object.eta_mean_all !== null) {
      message.eta_mean_all = BigInt(object.eta_mean_all.toString());
    }
    if (object.eta_std_cleaned !== undefined && object.eta_std_cleaned !== null) {
      message.eta_std_cleaned = BigInt(object.eta_std_cleaned.toString());
    }
    if (object.eta_std_all !== undefined && object.eta_std_all !== null) {
      message.eta_std_all = BigInt(object.eta_std_all.toString());
    }
    message.depport_score = object.depport_score ?? 0;
    message.depport = object.depport ?? "";
    message.creator = object.creator ?? "";
    return message;
  },
};
