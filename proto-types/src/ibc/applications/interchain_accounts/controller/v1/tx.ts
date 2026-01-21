/* eslint-disable */
import { InterchainAccountPacketData } from "../../v1/packet";
import { BinaryReader, BinaryWriter } from "../../../../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../../../../helpers";
export const protobufPackage = "ibc.applications.interchain_accounts.controller.v1";
/** MsgRegisterInterchainAccount defines the payload for Msg/RegisterAccount */
export interface MsgRegisterInterchainAccount {
  owner: string;
  connection_id: string;
  version: string;
}
/** MsgRegisterInterchainAccountResponse defines the response for Msg/RegisterAccount */
export interface MsgRegisterInterchainAccountResponse {
  channel_id: string;
}
/** MsgSendTx defines the payload for Msg/SendTx */
export interface MsgSendTx {
  owner: string;
  connection_id: string;
  packet_data: InterchainAccountPacketData;
  /**
   * Relative timeout timestamp provided will be added to the current block time during transaction execution.
   * The timeout timestamp must be non-zero.
   */
  relative_timeout: bigint;
}
/** MsgSendTxResponse defines the response for MsgSendTx */
export interface MsgSendTxResponse {
  sequence: bigint;
}
function createBaseMsgRegisterInterchainAccount(): MsgRegisterInterchainAccount {
  return {
    owner: "",
    connection_id: "",
    version: "",
  };
}
export const MsgRegisterInterchainAccount = {
  typeUrl: "/ibc.applications.interchain_accounts.controller.v1.MsgRegisterInterchainAccount",
  encode(message: MsgRegisterInterchainAccount, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.owner !== "") {
      writer.uint32(10).string(message.owner);
    }
    if (message.connection_id !== "") {
      writer.uint32(18).string(message.connection_id);
    }
    if (message.version !== "") {
      writer.uint32(26).string(message.version);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRegisterInterchainAccount {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRegisterInterchainAccount();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.owner = reader.string();
          break;
        case 2:
          message.connection_id = reader.string();
          break;
        case 3:
          message.version = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgRegisterInterchainAccount {
    const obj = createBaseMsgRegisterInterchainAccount();
    if (isSet(object.owner)) obj.owner = String(object.owner);
    if (isSet(object.connection_id)) obj.connection_id = String(object.connection_id);
    if (isSet(object.version)) obj.version = String(object.version);
    return obj;
  },
  toJSON(message: MsgRegisterInterchainAccount): unknown {
    const obj: any = {};
    message.owner !== undefined && (obj.owner = message.owner);
    message.connection_id !== undefined && (obj.connection_id = message.connection_id);
    message.version !== undefined && (obj.version = message.version);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRegisterInterchainAccount>, I>>(
    object: I,
  ): MsgRegisterInterchainAccount {
    const message = createBaseMsgRegisterInterchainAccount();
    message.owner = object.owner ?? "";
    message.connection_id = object.connection_id ?? "";
    message.version = object.version ?? "";
    return message;
  },
};
function createBaseMsgRegisterInterchainAccountResponse(): MsgRegisterInterchainAccountResponse {
  return {
    channel_id: "",
  };
}
export const MsgRegisterInterchainAccountResponse = {
  typeUrl: "/ibc.applications.interchain_accounts.controller.v1.MsgRegisterInterchainAccountResponse",
  encode(
    message: MsgRegisterInterchainAccountResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.channel_id !== "") {
      writer.uint32(10).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRegisterInterchainAccountResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRegisterInterchainAccountResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channel_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgRegisterInterchainAccountResponse {
    const obj = createBaseMsgRegisterInterchainAccountResponse();
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: MsgRegisterInterchainAccountResponse): unknown {
    const obj: any = {};
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRegisterInterchainAccountResponse>, I>>(
    object: I,
  ): MsgRegisterInterchainAccountResponse {
    const message = createBaseMsgRegisterInterchainAccountResponse();
    message.channel_id = object.channel_id ?? "";
    return message;
  },
};
function createBaseMsgSendTx(): MsgSendTx {
  return {
    owner: "",
    connection_id: "",
    packet_data: InterchainAccountPacketData.fromPartial({}),
    relative_timeout: BigInt(0),
  };
}
export const MsgSendTx = {
  typeUrl: "/ibc.applications.interchain_accounts.controller.v1.MsgSendTx",
  encode(message: MsgSendTx, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.owner !== "") {
      writer.uint32(10).string(message.owner);
    }
    if (message.connection_id !== "") {
      writer.uint32(18).string(message.connection_id);
    }
    if (message.packet_data !== undefined) {
      InterchainAccountPacketData.encode(message.packet_data, writer.uint32(26).fork()).ldelim();
    }
    if (message.relative_timeout !== BigInt(0)) {
      writer.uint32(32).uint64(message.relative_timeout);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgSendTx {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSendTx();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.owner = reader.string();
          break;
        case 2:
          message.connection_id = reader.string();
          break;
        case 3:
          message.packet_data = InterchainAccountPacketData.decode(reader, reader.uint32());
          break;
        case 4:
          message.relative_timeout = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgSendTx {
    const obj = createBaseMsgSendTx();
    if (isSet(object.owner)) obj.owner = String(object.owner);
    if (isSet(object.connection_id)) obj.connection_id = String(object.connection_id);
    if (isSet(object.packet_data)) obj.packet_data = InterchainAccountPacketData.fromJSON(object.packet_data);
    if (isSet(object.relative_timeout)) obj.relative_timeout = BigInt(object.relative_timeout.toString());
    return obj;
  },
  toJSON(message: MsgSendTx): unknown {
    const obj: any = {};
    message.owner !== undefined && (obj.owner = message.owner);
    message.connection_id !== undefined && (obj.connection_id = message.connection_id);
    message.packet_data !== undefined &&
      (obj.packet_data = message.packet_data
        ? InterchainAccountPacketData.toJSON(message.packet_data)
        : undefined);
    message.relative_timeout !== undefined &&
      (obj.relative_timeout = (message.relative_timeout || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgSendTx>, I>>(object: I): MsgSendTx {
    const message = createBaseMsgSendTx();
    message.owner = object.owner ?? "";
    message.connection_id = object.connection_id ?? "";
    if (object.packet_data !== undefined && object.packet_data !== null) {
      message.packet_data = InterchainAccountPacketData.fromPartial(object.packet_data);
    }
    if (object.relative_timeout !== undefined && object.relative_timeout !== null) {
      message.relative_timeout = BigInt(object.relative_timeout.toString());
    }
    return message;
  },
};
function createBaseMsgSendTxResponse(): MsgSendTxResponse {
  return {
    sequence: BigInt(0),
  };
}
export const MsgSendTxResponse = {
  typeUrl: "/ibc.applications.interchain_accounts.controller.v1.MsgSendTxResponse",
  encode(message: MsgSendTxResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.sequence !== BigInt(0)) {
      writer.uint32(8).uint64(message.sequence);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgSendTxResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSendTxResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sequence = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgSendTxResponse {
    const obj = createBaseMsgSendTxResponse();
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    return obj;
  },
  toJSON(message: MsgSendTxResponse): unknown {
    const obj: any = {};
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgSendTxResponse>, I>>(object: I): MsgSendTxResponse {
    const message = createBaseMsgSendTxResponse();
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    return message;
  },
};
/** Msg defines the 27-interchain-accounts/controller Msg service. */
export interface Msg {
  /** RegisterInterchainAccount defines a rpc handler for MsgRegisterInterchainAccount. */
  RegisterInterchainAccount(
    request: MsgRegisterInterchainAccount,
  ): Promise<MsgRegisterInterchainAccountResponse>;
  /** SendTx defines a rpc handler for MsgSendTx. */
  SendTx(request: MsgSendTx): Promise<MsgSendTxResponse>;
}
export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.RegisterInterchainAccount = this.RegisterInterchainAccount.bind(this);
    this.SendTx = this.SendTx.bind(this);
  }
  RegisterInterchainAccount(
    request: MsgRegisterInterchainAccount,
  ): Promise<MsgRegisterInterchainAccountResponse> {
    const data = MsgRegisterInterchainAccount.encode(request).finish();
    const promise = this.rpc.request(
      "ibc.applications.interchain_accounts.controller.v1.Msg",
      "RegisterInterchainAccount",
      data,
    );
    return promise.then((data) => MsgRegisterInterchainAccountResponse.decode(new BinaryReader(data)));
  }
  SendTx(request: MsgSendTx): Promise<MsgSendTxResponse> {
    const data = MsgSendTx.encode(request).finish();
    const promise = this.rpc.request(
      "ibc.applications.interchain_accounts.controller.v1.Msg",
      "SendTx",
      data,
    );
    return promise.then((data) => MsgSendTxResponse.decode(new BinaryReader(data)));
  }
}
