/* eslint-disable */
import { Any } from "../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../helpers";
export const protobufPackage = "cosmos.auth.v1beta1";
/**
 * BaseAccount defines a base account type. It contains all the necessary fields
 * for basic account functionality. Any custom account type should extend this
 * type for additional functionality (e.g. vesting).
 */
export interface BaseAccount {
  address: string;
  pub_key?: Any;
  account_number: bigint;
  sequence: bigint;
}
/** ModuleAccount defines an account for modules that holds coins on a pool. */
export interface ModuleAccount {
  base_account?: BaseAccount;
  name: string;
  permissions: string[];
}
/**
 * ModuleCredential represents a unclaimable pubkey for base accounts controlled by modules.
 * 
 * Since: cosmos-sdk 0.47
 */
export interface ModuleCredential {
  /** module_name is the name of the module used for address derivation (passed into address.Module). */
  module_name: string;
  /**
   * derivation_keys is for deriving a module account address (passed into address.Module)
   * adding more keys creates sub-account addresses (passed into address.Derive)
   */
  derivation_keys: Uint8Array[];
}
/** Params defines the parameters for the auth module. */
export interface Params {
  max_memo_characters: bigint;
  tx_sig_limit: bigint;
  tx_size_cost_per_byte: bigint;
  sig_verify_cost_ed25519: bigint;
  sig_verify_cost_secp256k1: bigint;
}
function createBaseBaseAccount(): BaseAccount {
  return {
    address: "",
    pub_key: undefined,
    account_number: BigInt(0),
    sequence: BigInt(0)
  };
}
export const BaseAccount = {
  typeUrl: "/cosmos.auth.v1beta1.BaseAccount",
  encode(message: BaseAccount, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    if (message.pub_key !== undefined) {
      Any.encode(message.pub_key, writer.uint32(18).fork()).ldelim();
    }
    if (message.account_number !== BigInt(0)) {
      writer.uint32(24).uint64(message.account_number);
    }
    if (message.sequence !== BigInt(0)) {
      writer.uint32(32).uint64(message.sequence);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BaseAccount {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBaseAccount();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.address = reader.string();
          break;
        case 2:
          message.pub_key = Any.decode(reader, reader.uint32());
          break;
        case 3:
          message.account_number = reader.uint64();
          break;
        case 4:
          message.sequence = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BaseAccount {
    const obj = createBaseBaseAccount();
    if (isSet(object.address)) obj.address = String(object.address);
    if (isSet(object.pub_key)) obj.pub_key = Any.fromJSON(object.pub_key);
    if (isSet(object.account_number)) obj.account_number = BigInt(object.account_number.toString());
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    return obj;
  },
  toJSON(message: BaseAccount): unknown {
    const obj: any = {};
    message.address !== undefined && (obj.address = message.address);
    message.pub_key !== undefined && (obj.pub_key = message.pub_key ? Any.toJSON(message.pub_key) : undefined);
    message.account_number !== undefined && (obj.account_number = (message.account_number || BigInt(0)).toString());
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BaseAccount>, I>>(object: I): BaseAccount {
    const message = createBaseBaseAccount();
    message.address = object.address ?? "";
    if (object.pub_key !== undefined && object.pub_key !== null) {
      message.pub_key = Any.fromPartial(object.pub_key);
    }
    if (object.account_number !== undefined && object.account_number !== null) {
      message.account_number = BigInt(object.account_number.toString());
    }
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    return message;
  }
};
function createBaseModuleAccount(): ModuleAccount {
  return {
    base_account: undefined,
    name: "",
    permissions: []
  };
}
export const ModuleAccount = {
  typeUrl: "/cosmos.auth.v1beta1.ModuleAccount",
  encode(message: ModuleAccount, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.base_account !== undefined) {
      BaseAccount.encode(message.base_account, writer.uint32(10).fork()).ldelim();
    }
    if (message.name !== "") {
      writer.uint32(18).string(message.name);
    }
    for (const v of message.permissions) {
      writer.uint32(26).string(v!);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ModuleAccount {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseModuleAccount();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.base_account = BaseAccount.decode(reader, reader.uint32());
          break;
        case 2:
          message.name = reader.string();
          break;
        case 3:
          message.permissions.push(reader.string());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ModuleAccount {
    const obj = createBaseModuleAccount();
    if (isSet(object.base_account)) obj.base_account = BaseAccount.fromJSON(object.base_account);
    if (isSet(object.name)) obj.name = String(object.name);
    if (Array.isArray(object?.permissions)) obj.permissions = object.permissions.map((e: any) => String(e));
    return obj;
  },
  toJSON(message: ModuleAccount): unknown {
    const obj: any = {};
    message.base_account !== undefined && (obj.base_account = message.base_account ? BaseAccount.toJSON(message.base_account) : undefined);
    message.name !== undefined && (obj.name = message.name);
    if (message.permissions) {
      obj.permissions = message.permissions.map(e => e);
    } else {
      obj.permissions = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ModuleAccount>, I>>(object: I): ModuleAccount {
    const message = createBaseModuleAccount();
    if (object.base_account !== undefined && object.base_account !== null) {
      message.base_account = BaseAccount.fromPartial(object.base_account);
    }
    message.name = object.name ?? "";
    message.permissions = object.permissions?.map(e => e) || [];
    return message;
  }
};
function createBaseModuleCredential(): ModuleCredential {
  return {
    module_name: "",
    derivation_keys: []
  };
}
export const ModuleCredential = {
  typeUrl: "/cosmos.auth.v1beta1.ModuleCredential",
  encode(message: ModuleCredential, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.module_name !== "") {
      writer.uint32(10).string(message.module_name);
    }
    for (const v of message.derivation_keys) {
      writer.uint32(18).bytes(v!);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ModuleCredential {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseModuleCredential();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.module_name = reader.string();
          break;
        case 2:
          message.derivation_keys.push(reader.bytes());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ModuleCredential {
    const obj = createBaseModuleCredential();
    if (isSet(object.module_name)) obj.module_name = String(object.module_name);
    if (Array.isArray(object?.derivation_keys)) obj.derivation_keys = object.derivation_keys.map((e: any) => bytesFromBase64(e));
    return obj;
  },
  toJSON(message: ModuleCredential): unknown {
    const obj: any = {};
    message.module_name !== undefined && (obj.module_name = message.module_name);
    if (message.derivation_keys) {
      obj.derivation_keys = message.derivation_keys.map(e => base64FromBytes(e !== undefined ? e : new Uint8Array()));
    } else {
      obj.derivation_keys = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ModuleCredential>, I>>(object: I): ModuleCredential {
    const message = createBaseModuleCredential();
    message.module_name = object.module_name ?? "";
    message.derivation_keys = object.derivation_keys?.map(e => e) || [];
    return message;
  }
};
function createBaseParams(): Params {
  return {
    max_memo_characters: BigInt(0),
    tx_sig_limit: BigInt(0),
    tx_size_cost_per_byte: BigInt(0),
    sig_verify_cost_ed25519: BigInt(0),
    sig_verify_cost_secp256k1: BigInt(0)
  };
}
export const Params = {
  typeUrl: "/cosmos.auth.v1beta1.Params",
  encode(message: Params, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.max_memo_characters !== BigInt(0)) {
      writer.uint32(8).uint64(message.max_memo_characters);
    }
    if (message.tx_sig_limit !== BigInt(0)) {
      writer.uint32(16).uint64(message.tx_sig_limit);
    }
    if (message.tx_size_cost_per_byte !== BigInt(0)) {
      writer.uint32(24).uint64(message.tx_size_cost_per_byte);
    }
    if (message.sig_verify_cost_ed25519 !== BigInt(0)) {
      writer.uint32(32).uint64(message.sig_verify_cost_ed25519);
    }
    if (message.sig_verify_cost_secp256k1 !== BigInt(0)) {
      writer.uint32(40).uint64(message.sig_verify_cost_secp256k1);
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
          message.max_memo_characters = reader.uint64();
          break;
        case 2:
          message.tx_sig_limit = reader.uint64();
          break;
        case 3:
          message.tx_size_cost_per_byte = reader.uint64();
          break;
        case 4:
          message.sig_verify_cost_ed25519 = reader.uint64();
          break;
        case 5:
          message.sig_verify_cost_secp256k1 = reader.uint64();
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
    if (isSet(object.max_memo_characters)) obj.max_memo_characters = BigInt(object.max_memo_characters.toString());
    if (isSet(object.tx_sig_limit)) obj.tx_sig_limit = BigInt(object.tx_sig_limit.toString());
    if (isSet(object.tx_size_cost_per_byte)) obj.tx_size_cost_per_byte = BigInt(object.tx_size_cost_per_byte.toString());
    if (isSet(object.sig_verify_cost_ed25519)) obj.sig_verify_cost_ed25519 = BigInt(object.sig_verify_cost_ed25519.toString());
    if (isSet(object.sig_verify_cost_secp256k1)) obj.sig_verify_cost_secp256k1 = BigInt(object.sig_verify_cost_secp256k1.toString());
    return obj;
  },
  toJSON(message: Params): unknown {
    const obj: any = {};
    message.max_memo_characters !== undefined && (obj.max_memo_characters = (message.max_memo_characters || BigInt(0)).toString());
    message.tx_sig_limit !== undefined && (obj.tx_sig_limit = (message.tx_sig_limit || BigInt(0)).toString());
    message.tx_size_cost_per_byte !== undefined && (obj.tx_size_cost_per_byte = (message.tx_size_cost_per_byte || BigInt(0)).toString());
    message.sig_verify_cost_ed25519 !== undefined && (obj.sig_verify_cost_ed25519 = (message.sig_verify_cost_ed25519 || BigInt(0)).toString());
    message.sig_verify_cost_secp256k1 !== undefined && (obj.sig_verify_cost_secp256k1 = (message.sig_verify_cost_secp256k1 || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Params>, I>>(object: I): Params {
    const message = createBaseParams();
    if (object.max_memo_characters !== undefined && object.max_memo_characters !== null) {
      message.max_memo_characters = BigInt(object.max_memo_characters.toString());
    }
    if (object.tx_sig_limit !== undefined && object.tx_sig_limit !== null) {
      message.tx_sig_limit = BigInt(object.tx_sig_limit.toString());
    }
    if (object.tx_size_cost_per_byte !== undefined && object.tx_size_cost_per_byte !== null) {
      message.tx_size_cost_per_byte = BigInt(object.tx_size_cost_per_byte.toString());
    }
    if (object.sig_verify_cost_ed25519 !== undefined && object.sig_verify_cost_ed25519 !== null) {
      message.sig_verify_cost_ed25519 = BigInt(object.sig_verify_cost_ed25519.toString());
    }
    if (object.sig_verify_cost_secp256k1 !== undefined && object.sig_verify_cost_secp256k1 !== null) {
      message.sig_verify_cost_secp256k1 = BigInt(object.sig_verify_cost_secp256k1.toString());
    }
    return message;
  }
};