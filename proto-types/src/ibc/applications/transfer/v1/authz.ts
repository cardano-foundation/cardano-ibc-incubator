/* eslint-disable */
import { Coin } from "../../../../cosmos/base/v1beta1/coin";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.applications.transfer.v1";
/** Allocation defines the spend limit for a particular port and channel */
export interface Allocation {
  /** the port on which the packet will be sent */
  source_port: string;
  /** the channel by which the packet will be sent */
  source_channel: string;
  /** spend limitation on the channel */
  spend_limit: Coin[];
  /** allow list of receivers, an empty allow list permits any receiver address */
  allow_list: string[];
}
/**
 * TransferAuthorization allows the grantee to spend up to spend_limit coins from
 * the granter's account for ibc transfer on a specific channel
 */
export interface TransferAuthorization {
  /** port and channel amounts */
  allocations: Allocation[];
}
function createBaseAllocation(): Allocation {
  return {
    source_port: "",
    source_channel: "",
    spend_limit: [],
    allow_list: [],
  };
}
export const Allocation = {
  typeUrl: "/ibc.applications.transfer.v1.Allocation",
  encode(message: Allocation, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.source_port !== "") {
      writer.uint32(10).string(message.source_port);
    }
    if (message.source_channel !== "") {
      writer.uint32(18).string(message.source_channel);
    }
    for (const v of message.spend_limit) {
      Coin.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.allow_list) {
      writer.uint32(34).string(v!);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Allocation {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAllocation();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.source_port = reader.string();
          break;
        case 2:
          message.source_channel = reader.string();
          break;
        case 3:
          message.spend_limit.push(Coin.decode(reader, reader.uint32()));
          break;
        case 4:
          message.allow_list.push(reader.string());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Allocation {
    const obj = createBaseAllocation();
    if (isSet(object.source_port)) obj.source_port = String(object.source_port);
    if (isSet(object.source_channel)) obj.source_channel = String(object.source_channel);
    if (Array.isArray(object?.spend_limit))
      obj.spend_limit = object.spend_limit.map((e: any) => Coin.fromJSON(e));
    if (Array.isArray(object?.allow_list)) obj.allow_list = object.allow_list.map((e: any) => String(e));
    return obj;
  },
  toJSON(message: Allocation): unknown {
    const obj: any = {};
    message.source_port !== undefined && (obj.source_port = message.source_port);
    message.source_channel !== undefined && (obj.source_channel = message.source_channel);
    if (message.spend_limit) {
      obj.spend_limit = message.spend_limit.map((e) => (e ? Coin.toJSON(e) : undefined));
    } else {
      obj.spend_limit = [];
    }
    if (message.allow_list) {
      obj.allow_list = message.allow_list.map((e) => e);
    } else {
      obj.allow_list = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Allocation>, I>>(object: I): Allocation {
    const message = createBaseAllocation();
    message.source_port = object.source_port ?? "";
    message.source_channel = object.source_channel ?? "";
    message.spend_limit = object.spend_limit?.map((e) => Coin.fromPartial(e)) || [];
    message.allow_list = object.allow_list?.map((e) => e) || [];
    return message;
  },
};
function createBaseTransferAuthorization(): TransferAuthorization {
  return {
    allocations: [],
  };
}
export const TransferAuthorization = {
  typeUrl: "/ibc.applications.transfer.v1.TransferAuthorization",
  encode(message: TransferAuthorization, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.allocations) {
      Allocation.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): TransferAuthorization {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTransferAuthorization();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.allocations.push(Allocation.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): TransferAuthorization {
    const obj = createBaseTransferAuthorization();
    if (Array.isArray(object?.allocations))
      obj.allocations = object.allocations.map((e: any) => Allocation.fromJSON(e));
    return obj;
  },
  toJSON(message: TransferAuthorization): unknown {
    const obj: any = {};
    if (message.allocations) {
      obj.allocations = message.allocations.map((e) => (e ? Allocation.toJSON(e) : undefined));
    } else {
      obj.allocations = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<TransferAuthorization>, I>>(object: I): TransferAuthorization {
    const message = createBaseTransferAuthorization();
    message.allocations = object.allocations?.map((e) => Allocation.fromPartial(e)) || [];
    return message;
  },
};
