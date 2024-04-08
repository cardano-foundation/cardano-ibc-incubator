/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../binary";
import { isSet, DeepPartial, Exact } from "../helpers";
export const protobufPackage = "config";
export interface UpdatePathConfigRequest {
  path: string;
}
export interface UpdatePathConfigResponse {}
export interface ShowPathConfigRequest {}
export interface ShowPathConfigResponse {
  path: string;
}
function createBaseUpdatePathConfigRequest(): UpdatePathConfigRequest {
  return {
    path: ""
  };
}
export const UpdatePathConfigRequest = {
  typeUrl: "/config.UpdatePathConfigRequest",
  encode(message: UpdatePathConfigRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.path !== "") {
      writer.uint32(10).string(message.path);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): UpdatePathConfigRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpdatePathConfigRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.path = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): UpdatePathConfigRequest {
    const obj = createBaseUpdatePathConfigRequest();
    if (isSet(object.path)) obj.path = String(object.path);
    return obj;
  },
  toJSON(message: UpdatePathConfigRequest): unknown {
    const obj: any = {};
    message.path !== undefined && (obj.path = message.path);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<UpdatePathConfigRequest>, I>>(object: I): UpdatePathConfigRequest {
    const message = createBaseUpdatePathConfigRequest();
    message.path = object.path ?? "";
    return message;
  }
};
function createBaseUpdatePathConfigResponse(): UpdatePathConfigResponse {
  return {};
}
export const UpdatePathConfigResponse = {
  typeUrl: "/config.UpdatePathConfigResponse",
  encode(_: UpdatePathConfigResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): UpdatePathConfigResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpdatePathConfigResponse();
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
  fromJSON(_: any): UpdatePathConfigResponse {
    const obj = createBaseUpdatePathConfigResponse();
    return obj;
  },
  toJSON(_: UpdatePathConfigResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<UpdatePathConfigResponse>, I>>(_: I): UpdatePathConfigResponse {
    const message = createBaseUpdatePathConfigResponse();
    return message;
  }
};
function createBaseShowPathConfigRequest(): ShowPathConfigRequest {
  return {};
}
export const ShowPathConfigRequest = {
  typeUrl: "/config.ShowPathConfigRequest",
  encode(_: ShowPathConfigRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ShowPathConfigRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseShowPathConfigRequest();
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
  fromJSON(_: any): ShowPathConfigRequest {
    const obj = createBaseShowPathConfigRequest();
    return obj;
  },
  toJSON(_: ShowPathConfigRequest): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ShowPathConfigRequest>, I>>(_: I): ShowPathConfigRequest {
    const message = createBaseShowPathConfigRequest();
    return message;
  }
};
function createBaseShowPathConfigResponse(): ShowPathConfigResponse {
  return {
    path: ""
  };
}
export const ShowPathConfigResponse = {
  typeUrl: "/config.ShowPathConfigResponse",
  encode(message: ShowPathConfigResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.path !== "") {
      writer.uint32(10).string(message.path);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ShowPathConfigResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseShowPathConfigResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.path = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ShowPathConfigResponse {
    const obj = createBaseShowPathConfigResponse();
    if (isSet(object.path)) obj.path = String(object.path);
    return obj;
  },
  toJSON(message: ShowPathConfigResponse): unknown {
    const obj: any = {};
    message.path !== undefined && (obj.path = message.path);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ShowPathConfigResponse>, I>>(object: I): ShowPathConfigResponse {
    const message = createBaseShowPathConfigResponse();
    message.path = object.path ?? "";
    return message;
  }
};