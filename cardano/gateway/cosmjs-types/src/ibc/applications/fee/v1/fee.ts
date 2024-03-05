/* eslint-disable */
import { Coin } from "../../../../cosmos/base/v1beta1/coin";
import { PacketId } from "../../../core/channel/v1/channel";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { DeepPartial, Exact, isSet } from "../../../../helpers";
export const protobufPackage = "ibc.applications.fee.v1";
/** Fee defines the ICS29 receive, acknowledgement and timeout fees */
export interface Fee {
  /** the packet receive fee */
  recv_fee: Coin[];
  /** the packet acknowledgement fee */
  ack_fee: Coin[];
  /** the packet timeout fee */
  timeout_fee: Coin[];
}
/** PacketFee contains ICS29 relayer fees, refund address and optional list of permitted relayers */
export interface PacketFee {
  /** fee encapsulates the recv, ack and timeout fees associated with an IBC packet */
  fee: Fee;
  /** the refund address for unspent fees */
  refund_address: string;
  /** optional list of relayers permitted to receive fees */
  relayers: string[];
}
/** PacketFees contains a list of type PacketFee */
export interface PacketFees {
  /** list of packet fees */
  packet_fees: PacketFee[];
}
/** IdentifiedPacketFees contains a list of type PacketFee and associated PacketId */
export interface IdentifiedPacketFees {
  /** unique packet identifier comprised of the channel ID, port ID and sequence */
  packet_id: PacketId;
  /** list of packet fees */
  packet_fees: PacketFee[];
}
function createBaseFee(): Fee {
  return {
    recv_fee: [],
    ack_fee: [],
    timeout_fee: [],
  };
}
export const Fee = {
  typeUrl: "/ibc.applications.fee.v1.Fee",
  encode(message: Fee, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.recv_fee) {
      Coin.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.ack_fee) {
      Coin.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.timeout_fee) {
      Coin.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Fee {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseFee();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.recv_fee.push(Coin.decode(reader, reader.uint32()));
          break;
        case 2:
          message.ack_fee.push(Coin.decode(reader, reader.uint32()));
          break;
        case 3:
          message.timeout_fee.push(Coin.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Fee {
    const obj = createBaseFee();
    if (Array.isArray(object?.recv_fee)) obj.recv_fee = object.recv_fee.map((e: any) => Coin.fromJSON(e));
    if (Array.isArray(object?.ack_fee)) obj.ack_fee = object.ack_fee.map((e: any) => Coin.fromJSON(e));
    if (Array.isArray(object?.timeout_fee))
      obj.timeout_fee = object.timeout_fee.map((e: any) => Coin.fromJSON(e));
    return obj;
  },
  toJSON(message: Fee): unknown {
    const obj: any = {};
    if (message.recv_fee) {
      obj.recv_fee = message.recv_fee.map((e) => (e ? Coin.toJSON(e) : undefined));
    } else {
      obj.recv_fee = [];
    }
    if (message.ack_fee) {
      obj.ack_fee = message.ack_fee.map((e) => (e ? Coin.toJSON(e) : undefined));
    } else {
      obj.ack_fee = [];
    }
    if (message.timeout_fee) {
      obj.timeout_fee = message.timeout_fee.map((e) => (e ? Coin.toJSON(e) : undefined));
    } else {
      obj.timeout_fee = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Fee>, I>>(object: I): Fee {
    const message = createBaseFee();
    message.recv_fee = object.recv_fee?.map((e) => Coin.fromPartial(e)) || [];
    message.ack_fee = object.ack_fee?.map((e) => Coin.fromPartial(e)) || [];
    message.timeout_fee = object.timeout_fee?.map((e) => Coin.fromPartial(e)) || [];
    return message;
  },
};
function createBasePacketFee(): PacketFee {
  return {
    fee: Fee.fromPartial({}),
    refund_address: "",
    relayers: [],
  };
}
export const PacketFee = {
  typeUrl: "/ibc.applications.fee.v1.PacketFee",
  encode(message: PacketFee, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.fee !== undefined) {
      Fee.encode(message.fee, writer.uint32(10).fork()).ldelim();
    }
    if (message.refund_address !== "") {
      writer.uint32(18).string(message.refund_address);
    }
    for (const v of message.relayers) {
      writer.uint32(26).string(v!);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PacketFee {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePacketFee();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.fee = Fee.decode(reader, reader.uint32());
          break;
        case 2:
          message.refund_address = reader.string();
          break;
        case 3:
          message.relayers.push(reader.string());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PacketFee {
    const obj = createBasePacketFee();
    if (isSet(object.fee)) obj.fee = Fee.fromJSON(object.fee);
    if (isSet(object.refund_address)) obj.refund_address = String(object.refund_address);
    if (Array.isArray(object?.relayers)) obj.relayers = object.relayers.map((e: any) => String(e));
    return obj;
  },
  toJSON(message: PacketFee): unknown {
    const obj: any = {};
    message.fee !== undefined && (obj.fee = message.fee ? Fee.toJSON(message.fee) : undefined);
    message.refund_address !== undefined && (obj.refund_address = message.refund_address);
    if (message.relayers) {
      obj.relayers = message.relayers.map((e) => e);
    } else {
      obj.relayers = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PacketFee>, I>>(object: I): PacketFee {
    const message = createBasePacketFee();
    if (object.fee !== undefined && object.fee !== null) {
      message.fee = Fee.fromPartial(object.fee);
    }
    message.refund_address = object.refund_address ?? "";
    message.relayers = object.relayers?.map((e) => e) || [];
    return message;
  },
};
function createBasePacketFees(): PacketFees {
  return {
    packet_fees: [],
  };
}
export const PacketFees = {
  typeUrl: "/ibc.applications.fee.v1.PacketFees",
  encode(message: PacketFees, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.packet_fees) {
      PacketFee.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PacketFees {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePacketFees();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_fees.push(PacketFee.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PacketFees {
    const obj = createBasePacketFees();
    if (Array.isArray(object?.packet_fees))
      obj.packet_fees = object.packet_fees.map((e: any) => PacketFee.fromJSON(e));
    return obj;
  },
  toJSON(message: PacketFees): unknown {
    const obj: any = {};
    if (message.packet_fees) {
      obj.packet_fees = message.packet_fees.map((e) => (e ? PacketFee.toJSON(e) : undefined));
    } else {
      obj.packet_fees = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PacketFees>, I>>(object: I): PacketFees {
    const message = createBasePacketFees();
    message.packet_fees = object.packet_fees?.map((e) => PacketFee.fromPartial(e)) || [];
    return message;
  },
};
function createBaseIdentifiedPacketFees(): IdentifiedPacketFees {
  return {
    packet_id: PacketId.fromPartial({}),
    packet_fees: [],
  };
}
export const IdentifiedPacketFees = {
  typeUrl: "/ibc.applications.fee.v1.IdentifiedPacketFees",
  encode(message: IdentifiedPacketFees, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet_id !== undefined) {
      PacketId.encode(message.packet_id, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.packet_fees) {
      PacketFee.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): IdentifiedPacketFees {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseIdentifiedPacketFees();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_id = PacketId.decode(reader, reader.uint32());
          break;
        case 2:
          message.packet_fees.push(PacketFee.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): IdentifiedPacketFees {
    const obj = createBaseIdentifiedPacketFees();
    if (isSet(object.packet_id)) obj.packet_id = PacketId.fromJSON(object.packet_id);
    if (Array.isArray(object?.packet_fees))
      obj.packet_fees = object.packet_fees.map((e: any) => PacketFee.fromJSON(e));
    return obj;
  },
  toJSON(message: IdentifiedPacketFees): unknown {
    const obj: any = {};
    message.packet_id !== undefined &&
      (obj.packet_id = message.packet_id ? PacketId.toJSON(message.packet_id) : undefined);
    if (message.packet_fees) {
      obj.packet_fees = message.packet_fees.map((e) => (e ? PacketFee.toJSON(e) : undefined));
    } else {
      obj.packet_fees = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<IdentifiedPacketFees>, I>>(object: I): IdentifiedPacketFees {
    const message = createBaseIdentifiedPacketFees();
    if (object.packet_id !== undefined && object.packet_id !== null) {
      message.packet_id = PacketId.fromPartial(object.packet_id);
    }
    message.packet_fees = object.packet_fees?.map((e) => PacketFee.fromPartial(e)) || [];
    return message;
  },
};
