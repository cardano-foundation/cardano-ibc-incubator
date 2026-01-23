/* eslint-disable */
import { PublicKey } from "../crypto/keys";
import { BinaryReader, BinaryWriter } from "../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../helpers";
export const protobufPackage = "tendermint.types";
export interface ValidatorSet {
  validators: Validator[];
  proposer?: Validator;
  total_voting_power: bigint;
}
export interface Validator {
  address: Uint8Array;
  pub_key: PublicKey;
  voting_power: bigint;
  proposer_priority: bigint;
}
export interface SimpleValidator {
  pub_key?: PublicKey;
  voting_power: bigint;
}
function createBaseValidatorSet(): ValidatorSet {
  return {
    validators: [],
    proposer: undefined,
    total_voting_power: BigInt(0),
  };
}
export const ValidatorSet = {
  typeUrl: "/tendermint.types.ValidatorSet",
  encode(message: ValidatorSet, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.validators) {
      Validator.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    if (message.proposer !== undefined) {
      Validator.encode(message.proposer, writer.uint32(18).fork()).ldelim();
    }
    if (message.total_voting_power !== BigInt(0)) {
      writer.uint32(24).int64(message.total_voting_power);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ValidatorSet {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseValidatorSet();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.validators.push(Validator.decode(reader, reader.uint32()));
          break;
        case 2:
          message.proposer = Validator.decode(reader, reader.uint32());
          break;
        case 3:
          message.total_voting_power = reader.int64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ValidatorSet {
    const obj = createBaseValidatorSet();
    if (Array.isArray(object?.validators))
      obj.validators = object.validators.map((e: any) => Validator.fromJSON(e));
    if (isSet(object.proposer)) obj.proposer = Validator.fromJSON(object.proposer);
    if (isSet(object.total_voting_power))
      obj.total_voting_power = BigInt(object.total_voting_power.toString());
    return obj;
  },
  toJSON(message: ValidatorSet): unknown {
    const obj: any = {};
    if (message.validators) {
      obj.validators = message.validators.map((e) => (e ? Validator.toJSON(e) : undefined));
    } else {
      obj.validators = [];
    }
    message.proposer !== undefined &&
      (obj.proposer = message.proposer ? Validator.toJSON(message.proposer) : undefined);
    message.total_voting_power !== undefined &&
      (obj.total_voting_power = (message.total_voting_power || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ValidatorSet>, I>>(object: I): ValidatorSet {
    const message = createBaseValidatorSet();
    message.validators = object.validators?.map((e) => Validator.fromPartial(e)) || [];
    if (object.proposer !== undefined && object.proposer !== null) {
      message.proposer = Validator.fromPartial(object.proposer);
    }
    if (object.total_voting_power !== undefined && object.total_voting_power !== null) {
      message.total_voting_power = BigInt(object.total_voting_power.toString());
    }
    return message;
  },
};
function createBaseValidator(): Validator {
  return {
    address: new Uint8Array(),
    pub_key: PublicKey.fromPartial({}),
    voting_power: BigInt(0),
    proposer_priority: BigInt(0),
  };
}
export const Validator = {
  typeUrl: "/tendermint.types.Validator",
  encode(message: Validator, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address.length !== 0) {
      writer.uint32(10).bytes(message.address);
    }
    if (message.pub_key !== undefined) {
      PublicKey.encode(message.pub_key, writer.uint32(18).fork()).ldelim();
    }
    if (message.voting_power !== BigInt(0)) {
      writer.uint32(24).int64(message.voting_power);
    }
    if (message.proposer_priority !== BigInt(0)) {
      writer.uint32(32).int64(message.proposer_priority);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Validator {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseValidator();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.address = reader.bytes();
          break;
        case 2:
          message.pub_key = PublicKey.decode(reader, reader.uint32());
          break;
        case 3:
          message.voting_power = reader.int64();
          break;
        case 4:
          message.proposer_priority = reader.int64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Validator {
    const obj = createBaseValidator();
    if (isSet(object.address)) obj.address = bytesFromBase64(object.address);
    if (isSet(object.pub_key)) obj.pub_key = PublicKey.fromJSON(object.pub_key);
    if (isSet(object.voting_power)) obj.voting_power = BigInt(object.voting_power.toString());
    if (isSet(object.proposer_priority)) obj.proposer_priority = BigInt(object.proposer_priority.toString());
    return obj;
  },
  toJSON(message: Validator): unknown {
    const obj: any = {};
    message.address !== undefined &&
      (obj.address = base64FromBytes(message.address !== undefined ? message.address : new Uint8Array()));
    message.pub_key !== undefined &&
      (obj.pub_key = message.pub_key ? PublicKey.toJSON(message.pub_key) : undefined);
    message.voting_power !== undefined && (obj.voting_power = (message.voting_power || BigInt(0)).toString());
    message.proposer_priority !== undefined &&
      (obj.proposer_priority = (message.proposer_priority || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Validator>, I>>(object: I): Validator {
    const message = createBaseValidator();
    message.address = object.address ?? new Uint8Array();
    if (object.pub_key !== undefined && object.pub_key !== null) {
      message.pub_key = PublicKey.fromPartial(object.pub_key);
    }
    if (object.voting_power !== undefined && object.voting_power !== null) {
      message.voting_power = BigInt(object.voting_power.toString());
    }
    if (object.proposer_priority !== undefined && object.proposer_priority !== null) {
      message.proposer_priority = BigInt(object.proposer_priority.toString());
    }
    return message;
  },
};
function createBaseSimpleValidator(): SimpleValidator {
  return {
    pub_key: undefined,
    voting_power: BigInt(0),
  };
}
export const SimpleValidator = {
  typeUrl: "/tendermint.types.SimpleValidator",
  encode(message: SimpleValidator, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pub_key !== undefined) {
      PublicKey.encode(message.pub_key, writer.uint32(10).fork()).ldelim();
    }
    if (message.voting_power !== BigInt(0)) {
      writer.uint32(16).int64(message.voting_power);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SimpleValidator {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSimpleValidator();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pub_key = PublicKey.decode(reader, reader.uint32());
          break;
        case 2:
          message.voting_power = reader.int64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SimpleValidator {
    const obj = createBaseSimpleValidator();
    if (isSet(object.pub_key)) obj.pub_key = PublicKey.fromJSON(object.pub_key);
    if (isSet(object.voting_power)) obj.voting_power = BigInt(object.voting_power.toString());
    return obj;
  },
  toJSON(message: SimpleValidator): unknown {
    const obj: any = {};
    message.pub_key !== undefined &&
      (obj.pub_key = message.pub_key ? PublicKey.toJSON(message.pub_key) : undefined);
    message.voting_power !== undefined && (obj.voting_power = (message.voting_power || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SimpleValidator>, I>>(object: I): SimpleValidator {
    const message = createBaseSimpleValidator();
    if (object.pub_key !== undefined && object.pub_key !== null) {
      message.pub_key = PublicKey.fromPartial(object.pub_key);
    }
    if (object.voting_power !== undefined && object.voting_power !== null) {
      message.voting_power = BigInt(object.voting_power.toString());
    }
    return message;
  },
};
