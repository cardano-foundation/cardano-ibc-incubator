/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.lightclients.probabilistic.v1";
/**
 * @name MsgContinueClient
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.MsgContinueClient
 */
export interface MsgContinueClient {
  signer: string;
  client_id: string;
  /**
   * Permissionless bounded cleanup or continuation of already authorized recovery.
   */
  operation: number;
}
/**
 * @name MsgContinueClientResponse
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.MsgContinueClientResponse
 */
export interface MsgContinueClientResponse {}
function createBaseMsgContinueClient(): MsgContinueClient {
  return {
    signer: "",
    client_id: "",
    operation: 0,
  };
}
/**
 * @name MsgContinueClient
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.MsgContinueClient
 */
export const MsgContinueClient = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.MsgContinueClient",
  encode(message: MsgContinueClient, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    if (message.client_id !== "") {
      writer.uint32(18).string(message.client_id);
    }
    if (message.operation !== 0) {
      writer.uint32(24).uint32(message.operation);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgContinueClient {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgContinueClient();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signer = reader.string();
          break;
        case 2:
          message.client_id = reader.string();
          break;
        case 3:
          message.operation = reader.uint32();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgContinueClient {
    const obj = createBaseMsgContinueClient();
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.operation)) obj.operation = Number(object.operation);
    return obj;
  },
  toJSON(message: MsgContinueClient): unknown {
    const obj: any = {};
    message.signer !== undefined && (obj.signer = message.signer);
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.operation !== undefined && (obj.operation = Math.round(message.operation));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgContinueClient>, I>>(object: I): MsgContinueClient {
    const message = createBaseMsgContinueClient();
    message.signer = object.signer ?? "";
    message.client_id = object.client_id ?? "";
    message.operation = object.operation ?? 0;
    return message;
  },
};
function createBaseMsgContinueClientResponse(): MsgContinueClientResponse {
  return {};
}
/**
 * @name MsgContinueClientResponse
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.MsgContinueClientResponse
 */
export const MsgContinueClientResponse = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.MsgContinueClientResponse",
  encode(_: MsgContinueClientResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgContinueClientResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgContinueClientResponse();
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
  fromJSON(_: any): MsgContinueClientResponse {
    const obj = createBaseMsgContinueClientResponse();
    return obj;
  },
  toJSON(_: MsgContinueClientResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgContinueClientResponse>, I>>(_: I): MsgContinueClientResponse {
    const message = createBaseMsgContinueClientResponse();
    return message;
  },
};
export interface Msg {
  ContinueClient(request: MsgContinueClient): Promise<MsgContinueClientResponse>;
}
export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.ContinueClient = this.ContinueClient.bind(this);
  }
  ContinueClient(request: MsgContinueClient): Promise<MsgContinueClientResponse> {
    const data = MsgContinueClient.encode(request).finish();
    const promise = this.rpc.request("ibc.lightclients.probabilistic.v1.Msg", "ContinueClient", data);
    return promise.then((data) => MsgContinueClientResponse.decode(new BinaryReader(data)));
  }
}
export const createClientImpl = (rpc: Rpc) => {
  return new MsgClientImpl(rpc);
};
