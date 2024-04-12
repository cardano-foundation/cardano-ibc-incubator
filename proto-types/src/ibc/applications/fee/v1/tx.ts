/* eslint-disable */
import { Fee, PacketFee } from "./fee";
import { PacketId } from "../../../core/channel/v1/channel";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.applications.fee.v1";
/** MsgRegisterPayee defines the request type for the RegisterPayee rpc */
export interface MsgRegisterPayee {
  /** unique port identifier */
  port_id: string;
  /** unique channel identifier */
  channel_id: string;
  /** the relayer address */
  relayer: string;
  /** the payee address */
  payee: string;
}
/** MsgRegisterPayeeResponse defines the response type for the RegisterPayee rpc */
export interface MsgRegisterPayeeResponse {}
/** MsgRegisterCounterpartyPayee defines the request type for the RegisterCounterpartyPayee rpc */
export interface MsgRegisterCounterpartyPayee {
  /** unique port identifier */
  port_id: string;
  /** unique channel identifier */
  channel_id: string;
  /** the relayer address */
  relayer: string;
  /** the counterparty payee address */
  counterparty_payee: string;
}
/** MsgRegisterCounterpartyPayeeResponse defines the response type for the RegisterCounterpartyPayee rpc */
export interface MsgRegisterCounterpartyPayeeResponse {}
/**
 * MsgPayPacketFee defines the request type for the PayPacketFee rpc
 * This Msg can be used to pay for a packet at the next sequence send & should be combined with the Msg that will be
 * paid for
 */
export interface MsgPayPacketFee {
  /** fee encapsulates the recv, ack and timeout fees associated with an IBC packet */
  fee: Fee;
  /** the source port unique identifier */
  source_port_id: string;
  /** the source channel unique identifer */
  source_channel_id: string;
  /** account address to refund fee if necessary */
  signer: string;
  /** optional list of relayers permitted to the receive packet fees */
  relayers: string[];
}
/** MsgPayPacketFeeResponse defines the response type for the PayPacketFee rpc */
export interface MsgPayPacketFeeResponse {}
/**
 * MsgPayPacketFeeAsync defines the request type for the PayPacketFeeAsync rpc
 * This Msg can be used to pay for a packet at a specified sequence (instead of the next sequence send)
 */
export interface MsgPayPacketFeeAsync {
  /** unique packet identifier comprised of the channel ID, port ID and sequence */
  packet_id: PacketId;
  /** the packet fee associated with a particular IBC packet */
  packet_fee: PacketFee;
}
/** MsgPayPacketFeeAsyncResponse defines the response type for the PayPacketFeeAsync rpc */
export interface MsgPayPacketFeeAsyncResponse {}
function createBaseMsgRegisterPayee(): MsgRegisterPayee {
  return {
    port_id: "",
    channel_id: "",
    relayer: "",
    payee: ""
  };
}
export const MsgRegisterPayee = {
  typeUrl: "/ibc.applications.fee.v1.MsgRegisterPayee",
  encode(message: MsgRegisterPayee, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.relayer !== "") {
      writer.uint32(26).string(message.relayer);
    }
    if (message.payee !== "") {
      writer.uint32(34).string(message.payee);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRegisterPayee {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRegisterPayee();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.relayer = reader.string();
          break;
        case 4:
          message.payee = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgRegisterPayee {
    const obj = createBaseMsgRegisterPayee();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.relayer)) obj.relayer = String(object.relayer);
    if (isSet(object.payee)) obj.payee = String(object.payee);
    return obj;
  },
  toJSON(message: MsgRegisterPayee): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.relayer !== undefined && (obj.relayer = message.relayer);
    message.payee !== undefined && (obj.payee = message.payee);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRegisterPayee>, I>>(object: I): MsgRegisterPayee {
    const message = createBaseMsgRegisterPayee();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.relayer = object.relayer ?? "";
    message.payee = object.payee ?? "";
    return message;
  }
};
function createBaseMsgRegisterPayeeResponse(): MsgRegisterPayeeResponse {
  return {};
}
export const MsgRegisterPayeeResponse = {
  typeUrl: "/ibc.applications.fee.v1.MsgRegisterPayeeResponse",
  encode(_: MsgRegisterPayeeResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRegisterPayeeResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRegisterPayeeResponse();
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
  fromJSON(_: any): MsgRegisterPayeeResponse {
    const obj = createBaseMsgRegisterPayeeResponse();
    return obj;
  },
  toJSON(_: MsgRegisterPayeeResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRegisterPayeeResponse>, I>>(_: I): MsgRegisterPayeeResponse {
    const message = createBaseMsgRegisterPayeeResponse();
    return message;
  }
};
function createBaseMsgRegisterCounterpartyPayee(): MsgRegisterCounterpartyPayee {
  return {
    port_id: "",
    channel_id: "",
    relayer: "",
    counterparty_payee: ""
  };
}
export const MsgRegisterCounterpartyPayee = {
  typeUrl: "/ibc.applications.fee.v1.MsgRegisterCounterpartyPayee",
  encode(message: MsgRegisterCounterpartyPayee, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.relayer !== "") {
      writer.uint32(26).string(message.relayer);
    }
    if (message.counterparty_payee !== "") {
      writer.uint32(34).string(message.counterparty_payee);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRegisterCounterpartyPayee {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRegisterCounterpartyPayee();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.relayer = reader.string();
          break;
        case 4:
          message.counterparty_payee = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgRegisterCounterpartyPayee {
    const obj = createBaseMsgRegisterCounterpartyPayee();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.relayer)) obj.relayer = String(object.relayer);
    if (isSet(object.counterparty_payee)) obj.counterparty_payee = String(object.counterparty_payee);
    return obj;
  },
  toJSON(message: MsgRegisterCounterpartyPayee): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.relayer !== undefined && (obj.relayer = message.relayer);
    message.counterparty_payee !== undefined && (obj.counterparty_payee = message.counterparty_payee);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRegisterCounterpartyPayee>, I>>(object: I): MsgRegisterCounterpartyPayee {
    const message = createBaseMsgRegisterCounterpartyPayee();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.relayer = object.relayer ?? "";
    message.counterparty_payee = object.counterparty_payee ?? "";
    return message;
  }
};
function createBaseMsgRegisterCounterpartyPayeeResponse(): MsgRegisterCounterpartyPayeeResponse {
  return {};
}
export const MsgRegisterCounterpartyPayeeResponse = {
  typeUrl: "/ibc.applications.fee.v1.MsgRegisterCounterpartyPayeeResponse",
  encode(_: MsgRegisterCounterpartyPayeeResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRegisterCounterpartyPayeeResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRegisterCounterpartyPayeeResponse();
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
  fromJSON(_: any): MsgRegisterCounterpartyPayeeResponse {
    const obj = createBaseMsgRegisterCounterpartyPayeeResponse();
    return obj;
  },
  toJSON(_: MsgRegisterCounterpartyPayeeResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRegisterCounterpartyPayeeResponse>, I>>(_: I): MsgRegisterCounterpartyPayeeResponse {
    const message = createBaseMsgRegisterCounterpartyPayeeResponse();
    return message;
  }
};
function createBaseMsgPayPacketFee(): MsgPayPacketFee {
  return {
    fee: Fee.fromPartial({}),
    source_port_id: "",
    source_channel_id: "",
    signer: "",
    relayers: []
  };
}
export const MsgPayPacketFee = {
  typeUrl: "/ibc.applications.fee.v1.MsgPayPacketFee",
  encode(message: MsgPayPacketFee, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.fee !== undefined) {
      Fee.encode(message.fee, writer.uint32(10).fork()).ldelim();
    }
    if (message.source_port_id !== "") {
      writer.uint32(18).string(message.source_port_id);
    }
    if (message.source_channel_id !== "") {
      writer.uint32(26).string(message.source_channel_id);
    }
    if (message.signer !== "") {
      writer.uint32(34).string(message.signer);
    }
    for (const v of message.relayers) {
      writer.uint32(42).string(v!);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPayPacketFee {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPayPacketFee();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.fee = Fee.decode(reader, reader.uint32());
          break;
        case 2:
          message.source_port_id = reader.string();
          break;
        case 3:
          message.source_channel_id = reader.string();
          break;
        case 4:
          message.signer = reader.string();
          break;
        case 5:
          message.relayers.push(reader.string());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgPayPacketFee {
    const obj = createBaseMsgPayPacketFee();
    if (isSet(object.fee)) obj.fee = Fee.fromJSON(object.fee);
    if (isSet(object.source_port_id)) obj.source_port_id = String(object.source_port_id);
    if (isSet(object.source_channel_id)) obj.source_channel_id = String(object.source_channel_id);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (Array.isArray(object?.relayers)) obj.relayers = object.relayers.map((e: any) => String(e));
    return obj;
  },
  toJSON(message: MsgPayPacketFee): unknown {
    const obj: any = {};
    message.fee !== undefined && (obj.fee = message.fee ? Fee.toJSON(message.fee) : undefined);
    message.source_port_id !== undefined && (obj.source_port_id = message.source_port_id);
    message.source_channel_id !== undefined && (obj.source_channel_id = message.source_channel_id);
    message.signer !== undefined && (obj.signer = message.signer);
    if (message.relayers) {
      obj.relayers = message.relayers.map(e => e);
    } else {
      obj.relayers = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPayPacketFee>, I>>(object: I): MsgPayPacketFee {
    const message = createBaseMsgPayPacketFee();
    if (object.fee !== undefined && object.fee !== null) {
      message.fee = Fee.fromPartial(object.fee);
    }
    message.source_port_id = object.source_port_id ?? "";
    message.source_channel_id = object.source_channel_id ?? "";
    message.signer = object.signer ?? "";
    message.relayers = object.relayers?.map(e => e) || [];
    return message;
  }
};
function createBaseMsgPayPacketFeeResponse(): MsgPayPacketFeeResponse {
  return {};
}
export const MsgPayPacketFeeResponse = {
  typeUrl: "/ibc.applications.fee.v1.MsgPayPacketFeeResponse",
  encode(_: MsgPayPacketFeeResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPayPacketFeeResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPayPacketFeeResponse();
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
  fromJSON(_: any): MsgPayPacketFeeResponse {
    const obj = createBaseMsgPayPacketFeeResponse();
    return obj;
  },
  toJSON(_: MsgPayPacketFeeResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPayPacketFeeResponse>, I>>(_: I): MsgPayPacketFeeResponse {
    const message = createBaseMsgPayPacketFeeResponse();
    return message;
  }
};
function createBaseMsgPayPacketFeeAsync(): MsgPayPacketFeeAsync {
  return {
    packet_id: PacketId.fromPartial({}),
    packet_fee: PacketFee.fromPartial({})
  };
}
export const MsgPayPacketFeeAsync = {
  typeUrl: "/ibc.applications.fee.v1.MsgPayPacketFeeAsync",
  encode(message: MsgPayPacketFeeAsync, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet_id !== undefined) {
      PacketId.encode(message.packet_id, writer.uint32(10).fork()).ldelim();
    }
    if (message.packet_fee !== undefined) {
      PacketFee.encode(message.packet_fee, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPayPacketFeeAsync {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPayPacketFeeAsync();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet_id = PacketId.decode(reader, reader.uint32());
          break;
        case 2:
          message.packet_fee = PacketFee.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgPayPacketFeeAsync {
    const obj = createBaseMsgPayPacketFeeAsync();
    if (isSet(object.packet_id)) obj.packet_id = PacketId.fromJSON(object.packet_id);
    if (isSet(object.packet_fee)) obj.packet_fee = PacketFee.fromJSON(object.packet_fee);
    return obj;
  },
  toJSON(message: MsgPayPacketFeeAsync): unknown {
    const obj: any = {};
    message.packet_id !== undefined && (obj.packet_id = message.packet_id ? PacketId.toJSON(message.packet_id) : undefined);
    message.packet_fee !== undefined && (obj.packet_fee = message.packet_fee ? PacketFee.toJSON(message.packet_fee) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPayPacketFeeAsync>, I>>(object: I): MsgPayPacketFeeAsync {
    const message = createBaseMsgPayPacketFeeAsync();
    if (object.packet_id !== undefined && object.packet_id !== null) {
      message.packet_id = PacketId.fromPartial(object.packet_id);
    }
    if (object.packet_fee !== undefined && object.packet_fee !== null) {
      message.packet_fee = PacketFee.fromPartial(object.packet_fee);
    }
    return message;
  }
};
function createBaseMsgPayPacketFeeAsyncResponse(): MsgPayPacketFeeAsyncResponse {
  return {};
}
export const MsgPayPacketFeeAsyncResponse = {
  typeUrl: "/ibc.applications.fee.v1.MsgPayPacketFeeAsyncResponse",
  encode(_: MsgPayPacketFeeAsyncResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPayPacketFeeAsyncResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPayPacketFeeAsyncResponse();
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
  fromJSON(_: any): MsgPayPacketFeeAsyncResponse {
    const obj = createBaseMsgPayPacketFeeAsyncResponse();
    return obj;
  },
  toJSON(_: MsgPayPacketFeeAsyncResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPayPacketFeeAsyncResponse>, I>>(_: I): MsgPayPacketFeeAsyncResponse {
    const message = createBaseMsgPayPacketFeeAsyncResponse();
    return message;
  }
};
/** Msg defines the ICS29 Msg service. */
export interface Msg {
  /**
   * RegisterPayee defines a rpc handler method for MsgRegisterPayee
   * RegisterPayee is called by the relayer on each channelEnd and allows them to set an optional
   * payee to which reverse and timeout relayer packet fees will be paid out. The payee should be registered on
   * the source chain from which packets originate as this is where fee distribution takes place. This function may be
   * called more than once by a relayer, in which case, the latest payee is always used.
   */
  RegisterPayee(request: MsgRegisterPayee): Promise<MsgRegisterPayeeResponse>;
  /**
   * RegisterCounterpartyPayee defines a rpc handler method for MsgRegisterCounterpartyPayee
   * RegisterCounterpartyPayee is called by the relayer on each channelEnd and allows them to specify the counterparty
   * payee address before relaying. This ensures they will be properly compensated for forward relaying since
   * the destination chain must include the registered counterparty payee address in the acknowledgement. This function
   * may be called more than once by a relayer, in which case, the latest counterparty payee address is always used.
   */
  RegisterCounterpartyPayee(request: MsgRegisterCounterpartyPayee): Promise<MsgRegisterCounterpartyPayeeResponse>;
  /**
   * PayPacketFee defines a rpc handler method for MsgPayPacketFee
   * PayPacketFee is an open callback that may be called by any module/user that wishes to escrow funds in order to
   * incentivize the relaying of the packet at the next sequence
   * NOTE: This method is intended to be used within a multi msg transaction, where the subsequent msg that follows
   * initiates the lifecycle of the incentivized packet
   */
  PayPacketFee(request: MsgPayPacketFee): Promise<MsgPayPacketFeeResponse>;
  /**
   * PayPacketFeeAsync defines a rpc handler method for MsgPayPacketFeeAsync
   * PayPacketFeeAsync is an open callback that may be called by any module/user that wishes to escrow funds in order to
   * incentivize the relaying of a known packet (i.e. at a particular sequence)
   */
  PayPacketFeeAsync(request: MsgPayPacketFeeAsync): Promise<MsgPayPacketFeeAsyncResponse>;
}
export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.RegisterPayee = this.RegisterPayee.bind(this);
    this.RegisterCounterpartyPayee = this.RegisterCounterpartyPayee.bind(this);
    this.PayPacketFee = this.PayPacketFee.bind(this);
    this.PayPacketFeeAsync = this.PayPacketFeeAsync.bind(this);
  }
  RegisterPayee(request: MsgRegisterPayee): Promise<MsgRegisterPayeeResponse> {
    const data = MsgRegisterPayee.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Msg", "RegisterPayee", data);
    return promise.then(data => MsgRegisterPayeeResponse.decode(new BinaryReader(data)));
  }
  RegisterCounterpartyPayee(request: MsgRegisterCounterpartyPayee): Promise<MsgRegisterCounterpartyPayeeResponse> {
    const data = MsgRegisterCounterpartyPayee.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Msg", "RegisterCounterpartyPayee", data);
    return promise.then(data => MsgRegisterCounterpartyPayeeResponse.decode(new BinaryReader(data)));
  }
  PayPacketFee(request: MsgPayPacketFee): Promise<MsgPayPacketFeeResponse> {
    const data = MsgPayPacketFee.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Msg", "PayPacketFee", data);
    return promise.then(data => MsgPayPacketFeeResponse.decode(new BinaryReader(data)));
  }
  PayPacketFeeAsync(request: MsgPayPacketFeeAsync): Promise<MsgPayPacketFeeAsyncResponse> {
    const data = MsgPayPacketFeeAsync.encode(request).finish();
    const promise = this.rpc.request("ibc.applications.fee.v1.Msg", "PayPacketFeeAsync", data);
    return promise.then(data => MsgPayPacketFeeAsyncResponse.decode(new BinaryReader(data)));
  }
}