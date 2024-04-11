/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../binary";
import { isSet, bytesFromBase64, base64FromBytes, DeepPartial, Exact } from "../helpers";
export const protobufPackage = "tx";
export interface SignAndSubmitTxRequest {
  chain_id: string;
  transaction_hex_string: Uint8Array;
}
export interface SignAndSubmitTxResponse {
  transaction_id: string;
}
function createBaseSignAndSubmitTxRequest(): SignAndSubmitTxRequest {
  return {
    chain_id: "",
    transaction_hex_string: new Uint8Array()
  };
}
export const SignAndSubmitTxRequest = {
  typeUrl: "/tx.SignAndSubmitTxRequest",
  encode(message: SignAndSubmitTxRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.chain_id !== "") {
      writer.uint32(10).string(message.chain_id);
    }
    if (message.transaction_hex_string.length !== 0) {
      writer.uint32(18).bytes(message.transaction_hex_string);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SignAndSubmitTxRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSignAndSubmitTxRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.chain_id = reader.string();
          break;
        case 2:
          message.transaction_hex_string = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SignAndSubmitTxRequest {
    const obj = createBaseSignAndSubmitTxRequest();
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    if (isSet(object.transaction_hex_string)) obj.transaction_hex_string = bytesFromBase64(object.transaction_hex_string);
    return obj;
  },
  toJSON(message: SignAndSubmitTxRequest): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.transaction_hex_string !== undefined && (obj.transaction_hex_string = base64FromBytes(message.transaction_hex_string !== undefined ? message.transaction_hex_string : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SignAndSubmitTxRequest>, I>>(object: I): SignAndSubmitTxRequest {
    const message = createBaseSignAndSubmitTxRequest();
    message.chain_id = object.chain_id ?? "";
    message.transaction_hex_string = object.transaction_hex_string ?? new Uint8Array();
    return message;
  }
};
function createBaseSignAndSubmitTxResponse(): SignAndSubmitTxResponse {
  return {
    transaction_id: ""
  };
}
export const SignAndSubmitTxResponse = {
  typeUrl: "/tx.SignAndSubmitTxResponse",
  encode(message: SignAndSubmitTxResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.transaction_id !== "") {
      writer.uint32(10).string(message.transaction_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SignAndSubmitTxResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSignAndSubmitTxResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.transaction_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SignAndSubmitTxResponse {
    const obj = createBaseSignAndSubmitTxResponse();
    if (isSet(object.transaction_id)) obj.transaction_id = String(object.transaction_id);
    return obj;
  },
  toJSON(message: SignAndSubmitTxResponse): unknown {
    const obj: any = {};
    message.transaction_id !== undefined && (obj.transaction_id = message.transaction_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SignAndSubmitTxResponse>, I>>(object: I): SignAndSubmitTxResponse {
    const message = createBaseSignAndSubmitTxResponse();
    message.transaction_id = object.transaction_id ?? "";
    return message;
  }
};