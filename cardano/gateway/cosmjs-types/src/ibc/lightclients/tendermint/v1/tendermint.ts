/* eslint-disable */
import { Duration } from "../../../../google/protobuf/duration";
import { Height } from "../../../core/client/v1/client";
import { ProofSpec } from "../../../../cosmos/ics23/v1/proofs";
import { Timestamp } from "../../../../google/protobuf/timestamp";
import { MerkleRoot } from "../../../core/commitment/v1/commitment";
import { SignedHeader } from "../../../../tendermint/types/types";
import { ValidatorSet } from "../../../../tendermint/types/validator";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import {
  isSet,
  DeepPartial,
  Exact,
  fromJsonTimestamp,
  bytesFromBase64,
  fromTimestamp,
  base64FromBytes,
} from "../../../../helpers";
export const protobufPackage = "ibc.lightclients.tendermint.v1";
/**
 * ClientState from Tendermint tracks the current validator set, latest height,
 * and a possible frozen height.
 */
export interface ClientState {
  chain_id: string;
  trust_level: Fraction;
  /**
   * duration of the period since the LastestTimestamp during which the
   * submitted headers are valid for upgrade
   */
  trusting_period: Duration;
  /** duration of the staking unbonding period */
  unbonding_period: Duration;
  /** defines how much new (untrusted) header's Time can drift into the future. */
  max_clock_drift: Duration;
  /** Block height when the client was frozen due to a misbehaviour */
  frozen_height: Height;
  /** Latest height the client was updated to */
  latest_height: Height;
  /** Proof specifications used in verifying counterparty state */
  proof_specs: ProofSpec[];
  /**
   * Path at which next upgraded client will be committed.
   * Each element corresponds to the key for a single CommitmentProof in the
   * chained proof. NOTE: ClientState must stored under
   * `{upgradePath}/{upgradeHeight}/clientState` ConsensusState must be stored
   * under `{upgradepath}/{upgradeHeight}/consensusState` For SDK chains using
   * the default upgrade module, upgrade_path should be []string{"upgrade",
   * "upgradedIBCState"}`
   */
  upgrade_path: string[];
  /** allow_update_after_expiry is deprecated */
  /** @deprecated */
  allow_update_after_expiry: boolean;
  /** allow_update_after_misbehaviour is deprecated */
  /** @deprecated */
  allow_update_after_misbehaviour: boolean;
}
/** ConsensusState defines the consensus state from Tendermint. */
export interface ConsensusState {
  /**
   * timestamp that corresponds to the block height in which the ConsensusState
   * was stored.
   */
  timestamp: Timestamp;
  /** commitment root (i.e app hash) */
  root: MerkleRoot;
  next_validators_hash: Uint8Array;
}
/**
 * Misbehaviour is a wrapper over two conflicting Headers
 * that implements Misbehaviour interface expected by ICS-02
 */
export interface Misbehaviour {
  /** ClientID is deprecated */
  /** @deprecated */
  client_id: string;
  header1?: Header;
  header2?: Header;
}
/**
 * Header defines the Tendermint client consensus Header.
 * It encapsulates all the information necessary to update from a trusted
 * Tendermint ConsensusState. The inclusion of TrustedHeight and
 * TrustedValidators allows this update to process correctly, so long as the
 * ConsensusState for the TrustedHeight exists, this removes race conditions
 * among relayers The SignedHeader and ValidatorSet are the new untrusted update
 * fields for the client. The TrustedHeight is the height of a stored
 * ConsensusState on the client that will be used to verify the new untrusted
 * header. The Trusted ConsensusState must be within the unbonding period of
 * current time in order to correctly verify, and the TrustedValidators must
 * hash to TrustedConsensusState.NextValidatorsHash since that is the last
 * trusted validator set at the TrustedHeight.
 */
export interface Header {
  signed_header?: SignedHeader;
  validator_set?: ValidatorSet;
  trusted_height: Height;
  trusted_validators?: ValidatorSet;
}
/**
 * Fraction defines the protobuf message type for tmmath.Fraction that only
 * supports positive values.
 */
export interface Fraction {
  numerator: bigint;
  denominator: bigint;
}
function createBaseClientState(): ClientState {
  return {
    chain_id: "",
    trust_level: Fraction.fromPartial({}),
    trusting_period: Duration.fromPartial({}),
    unbonding_period: Duration.fromPartial({}),
    max_clock_drift: Duration.fromPartial({}),
    frozen_height: Height.fromPartial({}),
    latest_height: Height.fromPartial({}),
    proof_specs: [],
    upgrade_path: [],
    allow_update_after_expiry: false,
    allow_update_after_misbehaviour: false,
  };
}
export const ClientState = {
  typeUrl: "/ibc.lightclients.tendermint.v1.ClientState",
  encode(message: ClientState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.chain_id !== "") {
      writer.uint32(10).string(message.chain_id);
    }
    if (message.trust_level !== undefined) {
      Fraction.encode(message.trust_level, writer.uint32(18).fork()).ldelim();
    }
    if (message.trusting_period !== undefined) {
      Duration.encode(message.trusting_period, writer.uint32(26).fork()).ldelim();
    }
    if (message.unbonding_period !== undefined) {
      Duration.encode(message.unbonding_period, writer.uint32(34).fork()).ldelim();
    }
    if (message.max_clock_drift !== undefined) {
      Duration.encode(message.max_clock_drift, writer.uint32(42).fork()).ldelim();
    }
    if (message.frozen_height !== undefined) {
      Height.encode(message.frozen_height, writer.uint32(50).fork()).ldelim();
    }
    if (message.latest_height !== undefined) {
      Height.encode(message.latest_height, writer.uint32(58).fork()).ldelim();
    }
    for (const v of message.proof_specs) {
      ProofSpec.encode(v!, writer.uint32(66).fork()).ldelim();
    }
    for (const v of message.upgrade_path) {
      writer.uint32(74).string(v!);
    }
    if (message.allow_update_after_expiry === true) {
      writer.uint32(80).bool(message.allow_update_after_expiry);
    }
    if (message.allow_update_after_misbehaviour === true) {
      writer.uint32(88).bool(message.allow_update_after_misbehaviour);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ClientState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseClientState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.chain_id = reader.string();
          break;
        case 2:
          message.trust_level = Fraction.decode(reader, reader.uint32());
          break;
        case 3:
          message.trusting_period = Duration.decode(reader, reader.uint32());
          break;
        case 4:
          message.unbonding_period = Duration.decode(reader, reader.uint32());
          break;
        case 5:
          message.max_clock_drift = Duration.decode(reader, reader.uint32());
          break;
        case 6:
          message.frozen_height = Height.decode(reader, reader.uint32());
          break;
        case 7:
          message.latest_height = Height.decode(reader, reader.uint32());
          break;
        case 8:
          message.proof_specs.push(ProofSpec.decode(reader, reader.uint32()));
          break;
        case 9:
          message.upgrade_path.push(reader.string());
          break;
        case 10:
          message.allow_update_after_expiry = reader.bool();
          break;
        case 11:
          message.allow_update_after_misbehaviour = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ClientState {
    const obj = createBaseClientState();
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    if (isSet(object.trust_level)) obj.trust_level = Fraction.fromJSON(object.trust_level);
    if (isSet(object.trusting_period)) obj.trusting_period = Duration.fromJSON(object.trusting_period);
    if (isSet(object.unbonding_period)) obj.unbonding_period = Duration.fromJSON(object.unbonding_period);
    if (isSet(object.max_clock_drift)) obj.max_clock_drift = Duration.fromJSON(object.max_clock_drift);
    if (isSet(object.frozen_height)) obj.frozen_height = Height.fromJSON(object.frozen_height);
    if (isSet(object.latest_height)) obj.latest_height = Height.fromJSON(object.latest_height);
    if (Array.isArray(object?.proof_specs))
      obj.proof_specs = object.proof_specs.map((e: any) => ProofSpec.fromJSON(e));
    if (Array.isArray(object?.upgrade_path))
      obj.upgrade_path = object.upgrade_path.map((e: any) => String(e));
    if (isSet(object.allow_update_after_expiry))
      obj.allow_update_after_expiry = Boolean(object.allow_update_after_expiry);
    if (isSet(object.allow_update_after_misbehaviour))
      obj.allow_update_after_misbehaviour = Boolean(object.allow_update_after_misbehaviour);
    return obj;
  },
  toJSON(message: ClientState): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.trust_level !== undefined &&
      (obj.trust_level = message.trust_level ? Fraction.toJSON(message.trust_level) : undefined);
    message.trusting_period !== undefined &&
      (obj.trusting_period = message.trusting_period ? Duration.toJSON(message.trusting_period) : undefined);
    message.unbonding_period !== undefined &&
      (obj.unbonding_period = message.unbonding_period
        ? Duration.toJSON(message.unbonding_period)
        : undefined);
    message.max_clock_drift !== undefined &&
      (obj.max_clock_drift = message.max_clock_drift ? Duration.toJSON(message.max_clock_drift) : undefined);
    message.frozen_height !== undefined &&
      (obj.frozen_height = message.frozen_height ? Height.toJSON(message.frozen_height) : undefined);
    message.latest_height !== undefined &&
      (obj.latest_height = message.latest_height ? Height.toJSON(message.latest_height) : undefined);
    if (message.proof_specs) {
      obj.proof_specs = message.proof_specs.map((e) => (e ? ProofSpec.toJSON(e) : undefined));
    } else {
      obj.proof_specs = [];
    }
    if (message.upgrade_path) {
      obj.upgrade_path = message.upgrade_path.map((e) => e);
    } else {
      obj.upgrade_path = [];
    }
    message.allow_update_after_expiry !== undefined &&
      (obj.allow_update_after_expiry = message.allow_update_after_expiry);
    message.allow_update_after_misbehaviour !== undefined &&
      (obj.allow_update_after_misbehaviour = message.allow_update_after_misbehaviour);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ClientState>, I>>(object: I): ClientState {
    const message = createBaseClientState();
    message.chain_id = object.chain_id ?? "";
    if (object.trust_level !== undefined && object.trust_level !== null) {
      message.trust_level = Fraction.fromPartial(object.trust_level);
    }
    if (object.trusting_period !== undefined && object.trusting_period !== null) {
      message.trusting_period = Duration.fromPartial(object.trusting_period);
    }
    if (object.unbonding_period !== undefined && object.unbonding_period !== null) {
      message.unbonding_period = Duration.fromPartial(object.unbonding_period);
    }
    if (object.max_clock_drift !== undefined && object.max_clock_drift !== null) {
      message.max_clock_drift = Duration.fromPartial(object.max_clock_drift);
    }
    if (object.frozen_height !== undefined && object.frozen_height !== null) {
      message.frozen_height = Height.fromPartial(object.frozen_height);
    }
    if (object.latest_height !== undefined && object.latest_height !== null) {
      message.latest_height = Height.fromPartial(object.latest_height);
    }
    message.proof_specs = object.proof_specs?.map((e) => ProofSpec.fromPartial(e)) || [];
    message.upgrade_path = object.upgrade_path?.map((e) => e) || [];
    message.allow_update_after_expiry = object.allow_update_after_expiry ?? false;
    message.allow_update_after_misbehaviour = object.allow_update_after_misbehaviour ?? false;
    return message;
  },
};
function createBaseConsensusState(): ConsensusState {
  return {
    timestamp: Timestamp.fromPartial({}),
    root: MerkleRoot.fromPartial({}),
    next_validators_hash: new Uint8Array(),
  };
}
export const ConsensusState = {
  typeUrl: "/ibc.lightclients.tendermint.v1.ConsensusState",
  encode(message: ConsensusState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.timestamp !== undefined) {
      Timestamp.encode(message.timestamp, writer.uint32(10).fork()).ldelim();
    }
    if (message.root !== undefined) {
      MerkleRoot.encode(message.root, writer.uint32(18).fork()).ldelim();
    }
    if (message.next_validators_hash.length !== 0) {
      writer.uint32(26).bytes(message.next_validators_hash);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ConsensusState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseConsensusState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.timestamp = Timestamp.decode(reader, reader.uint32());
          break;
        case 2:
          message.root = MerkleRoot.decode(reader, reader.uint32());
          break;
        case 3:
          message.next_validators_hash = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ConsensusState {
    const obj = createBaseConsensusState();
    if (isSet(object.timestamp)) obj.timestamp = fromJsonTimestamp(object.timestamp);
    if (isSet(object.root)) obj.root = MerkleRoot.fromJSON(object.root);
    if (isSet(object.next_validators_hash))
      obj.next_validators_hash = bytesFromBase64(object.next_validators_hash);
    return obj;
  },
  toJSON(message: ConsensusState): unknown {
    const obj: any = {};
    message.timestamp !== undefined && (obj.timestamp = fromTimestamp(message.timestamp).toISOString());
    message.root !== undefined && (obj.root = message.root ? MerkleRoot.toJSON(message.root) : undefined);
    message.next_validators_hash !== undefined &&
      (obj.next_validators_hash = base64FromBytes(
        message.next_validators_hash !== undefined ? message.next_validators_hash : new Uint8Array(),
      ));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ConsensusState>, I>>(object: I): ConsensusState {
    const message = createBaseConsensusState();
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = Timestamp.fromPartial(object.timestamp);
    }
    if (object.root !== undefined && object.root !== null) {
      message.root = MerkleRoot.fromPartial(object.root);
    }
    message.next_validators_hash = object.next_validators_hash ?? new Uint8Array();
    return message;
  },
};
function createBaseMisbehaviour(): Misbehaviour {
  return {
    client_id: "",
    header1: undefined,
    header2: undefined,
  };
}
export const Misbehaviour = {
  typeUrl: "/ibc.lightclients.tendermint.v1.Misbehaviour",
  encode(message: Misbehaviour, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.header1 !== undefined) {
      Header.encode(message.header1, writer.uint32(18).fork()).ldelim();
    }
    if (message.header2 !== undefined) {
      Header.encode(message.header2, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Misbehaviour {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMisbehaviour();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.header1 = Header.decode(reader, reader.uint32());
          break;
        case 3:
          message.header2 = Header.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Misbehaviour {
    const obj = createBaseMisbehaviour();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.header1)) obj.header1 = Header.fromJSON(object.header1);
    if (isSet(object.header2)) obj.header2 = Header.fromJSON(object.header2);
    return obj;
  },
  toJSON(message: Misbehaviour): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.header1 !== undefined &&
      (obj.header1 = message.header1 ? Header.toJSON(message.header1) : undefined);
    message.header2 !== undefined &&
      (obj.header2 = message.header2 ? Header.toJSON(message.header2) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Misbehaviour>, I>>(object: I): Misbehaviour {
    const message = createBaseMisbehaviour();
    message.client_id = object.client_id ?? "";
    if (object.header1 !== undefined && object.header1 !== null) {
      message.header1 = Header.fromPartial(object.header1);
    }
    if (object.header2 !== undefined && object.header2 !== null) {
      message.header2 = Header.fromPartial(object.header2);
    }
    return message;
  },
};
function createBaseHeader(): Header {
  return {
    signed_header: undefined,
    validator_set: undefined,
    trusted_height: Height.fromPartial({}),
    trusted_validators: undefined,
  };
}
export const Header = {
  typeUrl: "/ibc.lightclients.tendermint.v1.Header",
  encode(message: Header, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signed_header !== undefined) {
      SignedHeader.encode(message.signed_header, writer.uint32(10).fork()).ldelim();
    }
    if (message.validator_set !== undefined) {
      ValidatorSet.encode(message.validator_set, writer.uint32(18).fork()).ldelim();
    }
    if (message.trusted_height !== undefined) {
      Height.encode(message.trusted_height, writer.uint32(26).fork()).ldelim();
    }
    if (message.trusted_validators !== undefined) {
      ValidatorSet.encode(message.trusted_validators, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Header {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signed_header = SignedHeader.decode(reader, reader.uint32());
          break;
        case 2:
          message.validator_set = ValidatorSet.decode(reader, reader.uint32());
          break;
        case 3:
          message.trusted_height = Height.decode(reader, reader.uint32());
          break;
        case 4:
          message.trusted_validators = ValidatorSet.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Header {
    const obj = createBaseHeader();
    if (isSet(object.signed_header)) obj.signed_header = SignedHeader.fromJSON(object.signed_header);
    if (isSet(object.validator_set)) obj.validator_set = ValidatorSet.fromJSON(object.validator_set);
    if (isSet(object.trusted_height)) obj.trusted_height = Height.fromJSON(object.trusted_height);
    if (isSet(object.trusted_validators))
      obj.trusted_validators = ValidatorSet.fromJSON(object.trusted_validators);
    return obj;
  },
  toJSON(message: Header): unknown {
    const obj: any = {};
    message.signed_header !== undefined &&
      (obj.signed_header = message.signed_header ? SignedHeader.toJSON(message.signed_header) : undefined);
    message.validator_set !== undefined &&
      (obj.validator_set = message.validator_set ? ValidatorSet.toJSON(message.validator_set) : undefined);
    message.trusted_height !== undefined &&
      (obj.trusted_height = message.trusted_height ? Height.toJSON(message.trusted_height) : undefined);
    message.trusted_validators !== undefined &&
      (obj.trusted_validators = message.trusted_validators
        ? ValidatorSet.toJSON(message.trusted_validators)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Header>, I>>(object: I): Header {
    const message = createBaseHeader();
    if (object.signed_header !== undefined && object.signed_header !== null) {
      message.signed_header = SignedHeader.fromPartial(object.signed_header);
    }
    if (object.validator_set !== undefined && object.validator_set !== null) {
      message.validator_set = ValidatorSet.fromPartial(object.validator_set);
    }
    if (object.trusted_height !== undefined && object.trusted_height !== null) {
      message.trusted_height = Height.fromPartial(object.trusted_height);
    }
    if (object.trusted_validators !== undefined && object.trusted_validators !== null) {
      message.trusted_validators = ValidatorSet.fromPartial(object.trusted_validators);
    }
    return message;
  },
};
function createBaseFraction(): Fraction {
  return {
    numerator: BigInt(0),
    denominator: BigInt(0),
  };
}
export const Fraction = {
  typeUrl: "/ibc.lightclients.tendermint.v1.Fraction",
  encode(message: Fraction, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.numerator !== BigInt(0)) {
      writer.uint32(8).uint64(message.numerator);
    }
    if (message.denominator !== BigInt(0)) {
      writer.uint32(16).uint64(message.denominator);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Fraction {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseFraction();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.numerator = reader.uint64();
          break;
        case 2:
          message.denominator = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Fraction {
    const obj = createBaseFraction();
    if (isSet(object.numerator)) obj.numerator = BigInt(object.numerator.toString());
    if (isSet(object.denominator)) obj.denominator = BigInt(object.denominator.toString());
    return obj;
  },
  toJSON(message: Fraction): unknown {
    const obj: any = {};
    message.numerator !== undefined && (obj.numerator = (message.numerator || BigInt(0)).toString());
    message.denominator !== undefined && (obj.denominator = (message.denominator || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Fraction>, I>>(object: I): Fraction {
    const message = createBaseFraction();
    if (object.numerator !== undefined && object.numerator !== null) {
      message.numerator = BigInt(object.numerator.toString());
    }
    if (object.denominator !== undefined && object.denominator !== null) {
      message.denominator = BigInt(object.denominator.toString());
    }
    return message;
  },
};
