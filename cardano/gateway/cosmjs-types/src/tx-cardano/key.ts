/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../binary";
import { isSet, DeepPartial, Exact } from "../helpers";
export const protobufPackage = "key";
export interface AddKeyRequest {
  key_name: string;
  chain_id: string;
}
export interface AddKeyResponse {
  address: string;
  mnemonic: string;
}
export interface DeleteKeyRequest {
  key_name: string;
  chain_id: string;
}
export interface DeleteKeyResponse {}
export interface ShowAddressRequest {
  key_name: string;
  chain_id: string;
}
export interface ShowAddressResponse {
  address: string;
}
export interface KeyExistRequest {
  key_name: string;
  chain_id: string;
}
export interface KeyExistResponse {
  exist: boolean;
}
export interface AddressInfo {
  key_name: string;
  address: string;
}
export interface ListAddressesRequest {
  chain_id: string;
}
export interface ListAddressesResponse {
  addresses: AddressInfo[];
}
export interface KeyFromKeyOrAddressRequest {
  chain_id: string;
  key_or_address: string;
}
export interface KeyFromKeyOrAddressResponse {
  key_name: string;
}
export interface RestoreKeyRequest {
  key_name: string;
  chain_id: string;
  mnemonic: string;
}
export interface RestoreKeyResponse {
  address: string;
}
function createBaseAddKeyRequest(): AddKeyRequest {
  return {
    key_name: "",
    chain_id: ""
  };
}
export const AddKeyRequest = {
  typeUrl: "/key.AddKeyRequest",
  encode(message: AddKeyRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key_name !== "") {
      writer.uint32(10).string(message.key_name);
    }
    if (message.chain_id !== "") {
      writer.uint32(18).string(message.chain_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): AddKeyRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAddKeyRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key_name = reader.string();
          break;
        case 2:
          message.chain_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): AddKeyRequest {
    const obj = createBaseAddKeyRequest();
    if (isSet(object.key_name)) obj.key_name = String(object.key_name);
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    return obj;
  },
  toJSON(message: AddKeyRequest): unknown {
    const obj: any = {};
    message.key_name !== undefined && (obj.key_name = message.key_name);
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<AddKeyRequest>, I>>(object: I): AddKeyRequest {
    const message = createBaseAddKeyRequest();
    message.key_name = object.key_name ?? "";
    message.chain_id = object.chain_id ?? "";
    return message;
  }
};
function createBaseAddKeyResponse(): AddKeyResponse {
  return {
    address: "",
    mnemonic: ""
  };
}
export const AddKeyResponse = {
  typeUrl: "/key.AddKeyResponse",
  encode(message: AddKeyResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    if (message.mnemonic !== "") {
      writer.uint32(18).string(message.mnemonic);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): AddKeyResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAddKeyResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.address = reader.string();
          break;
        case 2:
          message.mnemonic = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): AddKeyResponse {
    const obj = createBaseAddKeyResponse();
    if (isSet(object.address)) obj.address = String(object.address);
    if (isSet(object.mnemonic)) obj.mnemonic = String(object.mnemonic);
    return obj;
  },
  toJSON(message: AddKeyResponse): unknown {
    const obj: any = {};
    message.address !== undefined && (obj.address = message.address);
    message.mnemonic !== undefined && (obj.mnemonic = message.mnemonic);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<AddKeyResponse>, I>>(object: I): AddKeyResponse {
    const message = createBaseAddKeyResponse();
    message.address = object.address ?? "";
    message.mnemonic = object.mnemonic ?? "";
    return message;
  }
};
function createBaseDeleteKeyRequest(): DeleteKeyRequest {
  return {
    key_name: "",
    chain_id: ""
  };
}
export const DeleteKeyRequest = {
  typeUrl: "/key.DeleteKeyRequest",
  encode(message: DeleteKeyRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key_name !== "") {
      writer.uint32(10).string(message.key_name);
    }
    if (message.chain_id !== "") {
      writer.uint32(18).string(message.chain_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): DeleteKeyRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseDeleteKeyRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key_name = reader.string();
          break;
        case 2:
          message.chain_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): DeleteKeyRequest {
    const obj = createBaseDeleteKeyRequest();
    if (isSet(object.key_name)) obj.key_name = String(object.key_name);
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    return obj;
  },
  toJSON(message: DeleteKeyRequest): unknown {
    const obj: any = {};
    message.key_name !== undefined && (obj.key_name = message.key_name);
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<DeleteKeyRequest>, I>>(object: I): DeleteKeyRequest {
    const message = createBaseDeleteKeyRequest();
    message.key_name = object.key_name ?? "";
    message.chain_id = object.chain_id ?? "";
    return message;
  }
};
function createBaseDeleteKeyResponse(): DeleteKeyResponse {
  return {};
}
export const DeleteKeyResponse = {
  typeUrl: "/key.DeleteKeyResponse",
  encode(_: DeleteKeyResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): DeleteKeyResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseDeleteKeyResponse();
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
  fromJSON(_: any): DeleteKeyResponse {
    const obj = createBaseDeleteKeyResponse();
    return obj;
  },
  toJSON(_: DeleteKeyResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<DeleteKeyResponse>, I>>(_: I): DeleteKeyResponse {
    const message = createBaseDeleteKeyResponse();
    return message;
  }
};
function createBaseShowAddressRequest(): ShowAddressRequest {
  return {
    key_name: "",
    chain_id: ""
  };
}
export const ShowAddressRequest = {
  typeUrl: "/key.ShowAddressRequest",
  encode(message: ShowAddressRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key_name !== "") {
      writer.uint32(10).string(message.key_name);
    }
    if (message.chain_id !== "") {
      writer.uint32(18).string(message.chain_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ShowAddressRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseShowAddressRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key_name = reader.string();
          break;
        case 2:
          message.chain_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ShowAddressRequest {
    const obj = createBaseShowAddressRequest();
    if (isSet(object.key_name)) obj.key_name = String(object.key_name);
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    return obj;
  },
  toJSON(message: ShowAddressRequest): unknown {
    const obj: any = {};
    message.key_name !== undefined && (obj.key_name = message.key_name);
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ShowAddressRequest>, I>>(object: I): ShowAddressRequest {
    const message = createBaseShowAddressRequest();
    message.key_name = object.key_name ?? "";
    message.chain_id = object.chain_id ?? "";
    return message;
  }
};
function createBaseShowAddressResponse(): ShowAddressResponse {
  return {
    address: ""
  };
}
export const ShowAddressResponse = {
  typeUrl: "/key.ShowAddressResponse",
  encode(message: ShowAddressResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ShowAddressResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseShowAddressResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.address = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ShowAddressResponse {
    const obj = createBaseShowAddressResponse();
    if (isSet(object.address)) obj.address = String(object.address);
    return obj;
  },
  toJSON(message: ShowAddressResponse): unknown {
    const obj: any = {};
    message.address !== undefined && (obj.address = message.address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ShowAddressResponse>, I>>(object: I): ShowAddressResponse {
    const message = createBaseShowAddressResponse();
    message.address = object.address ?? "";
    return message;
  }
};
function createBaseKeyExistRequest(): KeyExistRequest {
  return {
    key_name: "",
    chain_id: ""
  };
}
export const KeyExistRequest = {
  typeUrl: "/key.KeyExistRequest",
  encode(message: KeyExistRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key_name !== "") {
      writer.uint32(10).string(message.key_name);
    }
    if (message.chain_id !== "") {
      writer.uint32(18).string(message.chain_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): KeyExistRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseKeyExistRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key_name = reader.string();
          break;
        case 2:
          message.chain_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): KeyExistRequest {
    const obj = createBaseKeyExistRequest();
    if (isSet(object.key_name)) obj.key_name = String(object.key_name);
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    return obj;
  },
  toJSON(message: KeyExistRequest): unknown {
    const obj: any = {};
    message.key_name !== undefined && (obj.key_name = message.key_name);
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<KeyExistRequest>, I>>(object: I): KeyExistRequest {
    const message = createBaseKeyExistRequest();
    message.key_name = object.key_name ?? "";
    message.chain_id = object.chain_id ?? "";
    return message;
  }
};
function createBaseKeyExistResponse(): KeyExistResponse {
  return {
    exist: false
  };
}
export const KeyExistResponse = {
  typeUrl: "/key.KeyExistResponse",
  encode(message: KeyExistResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.exist === true) {
      writer.uint32(8).bool(message.exist);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): KeyExistResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseKeyExistResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.exist = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): KeyExistResponse {
    const obj = createBaseKeyExistResponse();
    if (isSet(object.exist)) obj.exist = Boolean(object.exist);
    return obj;
  },
  toJSON(message: KeyExistResponse): unknown {
    const obj: any = {};
    message.exist !== undefined && (obj.exist = message.exist);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<KeyExistResponse>, I>>(object: I): KeyExistResponse {
    const message = createBaseKeyExistResponse();
    message.exist = object.exist ?? false;
    return message;
  }
};
function createBaseAddressInfo(): AddressInfo {
  return {
    key_name: "",
    address: ""
  };
}
export const AddressInfo = {
  typeUrl: "/key.AddressInfo",
  encode(message: AddressInfo, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key_name !== "") {
      writer.uint32(10).string(message.key_name);
    }
    if (message.address !== "") {
      writer.uint32(18).string(message.address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): AddressInfo {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAddressInfo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key_name = reader.string();
          break;
        case 2:
          message.address = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): AddressInfo {
    const obj = createBaseAddressInfo();
    if (isSet(object.key_name)) obj.key_name = String(object.key_name);
    if (isSet(object.address)) obj.address = String(object.address);
    return obj;
  },
  toJSON(message: AddressInfo): unknown {
    const obj: any = {};
    message.key_name !== undefined && (obj.key_name = message.key_name);
    message.address !== undefined && (obj.address = message.address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<AddressInfo>, I>>(object: I): AddressInfo {
    const message = createBaseAddressInfo();
    message.key_name = object.key_name ?? "";
    message.address = object.address ?? "";
    return message;
  }
};
function createBaseListAddressesRequest(): ListAddressesRequest {
  return {
    chain_id: ""
  };
}
export const ListAddressesRequest = {
  typeUrl: "/key.ListAddressesRequest",
  encode(message: ListAddressesRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.chain_id !== "") {
      writer.uint32(10).string(message.chain_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ListAddressesRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseListAddressesRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.chain_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ListAddressesRequest {
    const obj = createBaseListAddressesRequest();
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    return obj;
  },
  toJSON(message: ListAddressesRequest): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ListAddressesRequest>, I>>(object: I): ListAddressesRequest {
    const message = createBaseListAddressesRequest();
    message.chain_id = object.chain_id ?? "";
    return message;
  }
};
function createBaseListAddressesResponse(): ListAddressesResponse {
  return {
    addresses: []
  };
}
export const ListAddressesResponse = {
  typeUrl: "/key.ListAddressesResponse",
  encode(message: ListAddressesResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.addresses) {
      AddressInfo.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ListAddressesResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseListAddressesResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.addresses.push(AddressInfo.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ListAddressesResponse {
    const obj = createBaseListAddressesResponse();
    if (Array.isArray(object?.addresses)) obj.addresses = object.addresses.map((e: any) => AddressInfo.fromJSON(e));
    return obj;
  },
  toJSON(message: ListAddressesResponse): unknown {
    const obj: any = {};
    if (message.addresses) {
      obj.addresses = message.addresses.map(e => e ? AddressInfo.toJSON(e) : undefined);
    } else {
      obj.addresses = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ListAddressesResponse>, I>>(object: I): ListAddressesResponse {
    const message = createBaseListAddressesResponse();
    message.addresses = object.addresses?.map(e => AddressInfo.fromPartial(e)) || [];
    return message;
  }
};
function createBaseKeyFromKeyOrAddressRequest(): KeyFromKeyOrAddressRequest {
  return {
    chain_id: "",
    key_or_address: ""
  };
}
export const KeyFromKeyOrAddressRequest = {
  typeUrl: "/key.KeyFromKeyOrAddressRequest",
  encode(message: KeyFromKeyOrAddressRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.chain_id !== "") {
      writer.uint32(10).string(message.chain_id);
    }
    if (message.key_or_address !== "") {
      writer.uint32(18).string(message.key_or_address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): KeyFromKeyOrAddressRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseKeyFromKeyOrAddressRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.chain_id = reader.string();
          break;
        case 2:
          message.key_or_address = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): KeyFromKeyOrAddressRequest {
    const obj = createBaseKeyFromKeyOrAddressRequest();
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    if (isSet(object.key_or_address)) obj.key_or_address = String(object.key_or_address);
    return obj;
  },
  toJSON(message: KeyFromKeyOrAddressRequest): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.key_or_address !== undefined && (obj.key_or_address = message.key_or_address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<KeyFromKeyOrAddressRequest>, I>>(object: I): KeyFromKeyOrAddressRequest {
    const message = createBaseKeyFromKeyOrAddressRequest();
    message.chain_id = object.chain_id ?? "";
    message.key_or_address = object.key_or_address ?? "";
    return message;
  }
};
function createBaseKeyFromKeyOrAddressResponse(): KeyFromKeyOrAddressResponse {
  return {
    key_name: ""
  };
}
export const KeyFromKeyOrAddressResponse = {
  typeUrl: "/key.KeyFromKeyOrAddressResponse",
  encode(message: KeyFromKeyOrAddressResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key_name !== "") {
      writer.uint32(10).string(message.key_name);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): KeyFromKeyOrAddressResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseKeyFromKeyOrAddressResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key_name = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): KeyFromKeyOrAddressResponse {
    const obj = createBaseKeyFromKeyOrAddressResponse();
    if (isSet(object.key_name)) obj.key_name = String(object.key_name);
    return obj;
  },
  toJSON(message: KeyFromKeyOrAddressResponse): unknown {
    const obj: any = {};
    message.key_name !== undefined && (obj.key_name = message.key_name);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<KeyFromKeyOrAddressResponse>, I>>(object: I): KeyFromKeyOrAddressResponse {
    const message = createBaseKeyFromKeyOrAddressResponse();
    message.key_name = object.key_name ?? "";
    return message;
  }
};
function createBaseRestoreKeyRequest(): RestoreKeyRequest {
  return {
    key_name: "",
    chain_id: "",
    mnemonic: ""
  };
}
export const RestoreKeyRequest = {
  typeUrl: "/key.RestoreKeyRequest",
  encode(message: RestoreKeyRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key_name !== "") {
      writer.uint32(10).string(message.key_name);
    }
    if (message.chain_id !== "") {
      writer.uint32(18).string(message.chain_id);
    }
    if (message.mnemonic !== "") {
      writer.uint32(26).string(message.mnemonic);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): RestoreKeyRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseRestoreKeyRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key_name = reader.string();
          break;
        case 2:
          message.chain_id = reader.string();
          break;
        case 3:
          message.mnemonic = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): RestoreKeyRequest {
    const obj = createBaseRestoreKeyRequest();
    if (isSet(object.key_name)) obj.key_name = String(object.key_name);
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    if (isSet(object.mnemonic)) obj.mnemonic = String(object.mnemonic);
    return obj;
  },
  toJSON(message: RestoreKeyRequest): unknown {
    const obj: any = {};
    message.key_name !== undefined && (obj.key_name = message.key_name);
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.mnemonic !== undefined && (obj.mnemonic = message.mnemonic);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<RestoreKeyRequest>, I>>(object: I): RestoreKeyRequest {
    const message = createBaseRestoreKeyRequest();
    message.key_name = object.key_name ?? "";
    message.chain_id = object.chain_id ?? "";
    message.mnemonic = object.mnemonic ?? "";
    return message;
  }
};
function createBaseRestoreKeyResponse(): RestoreKeyResponse {
  return {
    address: ""
  };
}
export const RestoreKeyResponse = {
  typeUrl: "/key.RestoreKeyResponse",
  encode(message: RestoreKeyResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): RestoreKeyResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseRestoreKeyResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.address = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): RestoreKeyResponse {
    const obj = createBaseRestoreKeyResponse();
    if (isSet(object.address)) obj.address = String(object.address);
    return obj;
  },
  toJSON(message: RestoreKeyResponse): unknown {
    const obj: any = {};
    message.address !== undefined && (obj.address = message.address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<RestoreKeyResponse>, I>>(object: I): RestoreKeyResponse {
    const message = createBaseRestoreKeyResponse();
    message.address = object.address ?? "";
    return message;
  }
};