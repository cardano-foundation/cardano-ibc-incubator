/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.applications.fee.v1";
/**
 * Metadata defines the ICS29 channel specific metadata encoded into the channel version bytestring
 * See ICS004: https://github.com/cosmos/ibc/tree/master/spec/core/ics-004-channel-and-packet-semantics#Versioning
 */
export interface Metadata {
  /** fee_version defines the ICS29 fee version */
  fee_version: string;
  /** app_version defines the underlying application version, which may or may not be a JSON encoded bytestring */
  app_version: string;
}
function createBaseMetadata(): Metadata {
  return {
    fee_version: "",
    app_version: ""
  };
}
export const Metadata = {
  typeUrl: "/ibc.applications.fee.v1.Metadata",
  encode(message: Metadata, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.fee_version !== "") {
      writer.uint32(10).string(message.fee_version);
    }
    if (message.app_version !== "") {
      writer.uint32(18).string(message.app_version);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Metadata {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMetadata();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.fee_version = reader.string();
          break;
        case 2:
          message.app_version = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Metadata {
    const obj = createBaseMetadata();
    if (isSet(object.fee_version)) obj.fee_version = String(object.fee_version);
    if (isSet(object.app_version)) obj.app_version = String(object.app_version);
    return obj;
  },
  toJSON(message: Metadata): unknown {
    const obj: any = {};
    message.fee_version !== undefined && (obj.fee_version = message.fee_version);
    message.app_version !== undefined && (obj.app_version = message.app_version);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Metadata>, I>>(object: I): Metadata {
    const message = createBaseMetadata();
    message.fee_version = object.fee_version ?? "";
    message.app_version = object.app_version ?? "";
    return message;
  }
};