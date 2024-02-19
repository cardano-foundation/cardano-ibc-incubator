/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../../helpers";
export const protobufPackage = "ibc.applications.interchain_accounts.host.v1";
/**
 * Params defines the set of on-chain interchain accounts parameters.
 * The following parameters may be used to disable the host submodule.
 */
export interface Params {
  /** host_enabled enables or disables the host submodule. */
  host_enabled: boolean;
  /** allow_messages defines a list of sdk message typeURLs allowed to be executed on a host chain. */
  allow_messages: string[];
}
function createBaseParams(): Params {
  return {
    host_enabled: false,
    allow_messages: [],
  };
}
export const Params = {
  typeUrl: "/ibc.applications.interchain_accounts.host.v1.Params",
  encode(message: Params, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.host_enabled === true) {
      writer.uint32(8).bool(message.host_enabled);
    }
    for (const v of message.allow_messages) {
      writer.uint32(18).string(v!);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Params {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseParams();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.host_enabled = reader.bool();
          break;
        case 2:
          message.allow_messages.push(reader.string());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Params {
    const obj = createBaseParams();
    if (isSet(object.host_enabled)) obj.host_enabled = Boolean(object.host_enabled);
    if (Array.isArray(object?.allow_messages))
      obj.allow_messages = object.allow_messages.map((e: any) => String(e));
    return obj;
  },
  toJSON(message: Params): unknown {
    const obj: any = {};
    message.host_enabled !== undefined && (obj.host_enabled = message.host_enabled);
    if (message.allow_messages) {
      obj.allow_messages = message.allow_messages.map((e) => e);
    } else {
      obj.allow_messages = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Params>, I>>(object: I): Params {
    const message = createBaseParams();
    message.host_enabled = object.host_enabled ?? false;
    message.allow_messages = object.allow_messages?.map((e) => e) || [];
    return message;
  },
};
