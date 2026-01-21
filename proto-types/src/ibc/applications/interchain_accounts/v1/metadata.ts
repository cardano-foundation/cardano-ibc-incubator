/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.applications.interchain_accounts.v1";
/**
 * Metadata defines a set of protocol specific data encoded into the ICS27 channel version bytestring
 * See ICS004: https://github.com/cosmos/ibc/tree/master/spec/core/ics-004-channel-and-packet-semantics#Versioning
 */
export interface Metadata {
  /** version defines the ICS27 protocol version */
  version: string;
  /** controller_connection_id is the connection identifier associated with the controller chain */
  controller_connection_id: string;
  /** host_connection_id is the connection identifier associated with the host chain */
  host_connection_id: string;
  /**
   * address defines the interchain account address to be fulfilled upon the OnChanOpenTry handshake step
   * NOTE: the address field is empty on the OnChanOpenInit handshake step
   */
  address: string;
  /** encoding defines the supported codec format */
  encoding: string;
  /** tx_type defines the type of transactions the interchain account can execute */
  tx_type: string;
}
function createBaseMetadata(): Metadata {
  return {
    version: "",
    controller_connection_id: "",
    host_connection_id: "",
    address: "",
    encoding: "",
    tx_type: "",
  };
}
export const Metadata = {
  typeUrl: "/ibc.applications.interchain_accounts.v1.Metadata",
  encode(message: Metadata, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.version !== "") {
      writer.uint32(10).string(message.version);
    }
    if (message.controller_connection_id !== "") {
      writer.uint32(18).string(message.controller_connection_id);
    }
    if (message.host_connection_id !== "") {
      writer.uint32(26).string(message.host_connection_id);
    }
    if (message.address !== "") {
      writer.uint32(34).string(message.address);
    }
    if (message.encoding !== "") {
      writer.uint32(42).string(message.encoding);
    }
    if (message.tx_type !== "") {
      writer.uint32(50).string(message.tx_type);
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
          message.version = reader.string();
          break;
        case 2:
          message.controller_connection_id = reader.string();
          break;
        case 3:
          message.host_connection_id = reader.string();
          break;
        case 4:
          message.address = reader.string();
          break;
        case 5:
          message.encoding = reader.string();
          break;
        case 6:
          message.tx_type = reader.string();
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
    if (isSet(object.version)) obj.version = String(object.version);
    if (isSet(object.controller_connection_id))
      obj.controller_connection_id = String(object.controller_connection_id);
    if (isSet(object.host_connection_id)) obj.host_connection_id = String(object.host_connection_id);
    if (isSet(object.address)) obj.address = String(object.address);
    if (isSet(object.encoding)) obj.encoding = String(object.encoding);
    if (isSet(object.tx_type)) obj.tx_type = String(object.tx_type);
    return obj;
  },
  toJSON(message: Metadata): unknown {
    const obj: any = {};
    message.version !== undefined && (obj.version = message.version);
    message.controller_connection_id !== undefined &&
      (obj.controller_connection_id = message.controller_connection_id);
    message.host_connection_id !== undefined && (obj.host_connection_id = message.host_connection_id);
    message.address !== undefined && (obj.address = message.address);
    message.encoding !== undefined && (obj.encoding = message.encoding);
    message.tx_type !== undefined && (obj.tx_type = message.tx_type);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Metadata>, I>>(object: I): Metadata {
    const message = createBaseMetadata();
    message.version = object.version ?? "";
    message.controller_connection_id = object.controller_connection_id ?? "";
    message.host_connection_id = object.host_connection_id ?? "";
    message.address = object.address ?? "";
    message.encoding = object.encoding ?? "";
    message.tx_type = object.tx_type ?? "";
    return message;
  },
};
