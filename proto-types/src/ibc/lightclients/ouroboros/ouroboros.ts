/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact } from "../../../helpers";
export const protobufPackage = "ibc.clients.cardano.v1";
export interface TokenConfigs {
  /** IBC handler token uint (policyID + name), in hex format */
  handler_token_unit: string;
  /** IBC client token policyID, in hex format */
  client_policy_id: string;
  /** IBC connection token policyID, in hex format */
  connection_policy_id: string;
  /** IBC channel token policyID, in hex format */
  channel_policy_id: string;
}
export interface Height {
  /** the revision that the client is currently on */
  revision_number: bigint;
  /** the height within the given revision */
  revision_height: bigint;
}
/** ConsensusState defines the consensus state from Tendermint. */
export interface ConsensusState {
  /**
   * timestamp that corresponds to the block height in which the ConsensusState
   * was stored. Will be Chain start time + slot
   */
  timestamp: bigint;
  /** Slot at consensus height */
  slot: bigint;
}
export interface Validator {
  /** vrf key hash of pool operator */
  vrf_key_hash: string;
  /** pool id of operator */
  pool_id: string;
}
export interface BlockData {
  /** Block number */
  height?: Height;
  /** Slot number */
  slot: bigint;
  /** Block hash */
  hash: string;
  /** Hash of previous block */
  prev_hash: string;
  /** Epoch number */
  epoch_no: bigint;
  /** Hex string of block header to cbor */
  header_cbor: string;
  /** Hex string of block txs to cbor */
  body_cbor: string;
  /**
   * Hex string of current epoch's epoch nonce, calculated at the start of each epoch,
   * calculated by evolving nonce of block inside epoch and last block nonce of prev block
   * Used to construct vrf value, also to verify slot leader is valid
   */
  epoch_nonce: string;
  /** Time stamp of current block */
  timestamp: bigint;
  /** Chain id */
  chain_id: string;
}
export interface ClientState {
  /** Chain id */
  chain_id: string;
  /** Latest height the client was updated to */
  latest_height?: Height;
  /** Block height when the client was frozen due to a misbehaviour */
  frozen_height?: Height;
  /** To support finality, this state will be mark as finality after `valid_after` slots, default 0, unit: slot */
  valid_after: bigint;
  /** Time when chain start */
  genesis_time: bigint;
  /** Epoch number of current chain state */
  current_epoch: bigint;
  /** Number of slots of this current epoch */
  epoch_length: bigint;
  /** Number of slots of per KES period */
  slot_per_kes_period: bigint;
  /** Current epoch validator set */
  current_validator_set: Validator[];
  /** Next epoch validator set */
  next_validator_set: Validator[];
  trusting_period: bigint;
  /** Path at which next upgraded client will be committed. */
  upgrade_path: string[];
  /** IBC related auth token policy configs */
  token_configs?: TokenConfigs;
}
export interface Misbehaviour {
  /** ClientID is deprecated */
  /** @deprecated */
  client_id: string;
  block_data1?: BlockData;
  block_data2?: BlockData;
}
function createBaseTokenConfigs(): TokenConfigs {
  return {
    handler_token_unit: "",
    client_policy_id: "",
    connection_policy_id: "",
    channel_policy_id: "",
  };
}
export const TokenConfigs = {
  typeUrl: "/ibc.clients.cardano.v1.TokenConfigs",
  encode(message: TokenConfigs, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.handler_token_unit !== "") {
      writer.uint32(10).string(message.handler_token_unit);
    }
    if (message.client_policy_id !== "") {
      writer.uint32(18).string(message.client_policy_id);
    }
    if (message.connection_policy_id !== "") {
      writer.uint32(26).string(message.connection_policy_id);
    }
    if (message.channel_policy_id !== "") {
      writer.uint32(34).string(message.channel_policy_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): TokenConfigs {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTokenConfigs();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.handler_token_unit = reader.string();
          break;
        case 2:
          message.client_policy_id = reader.string();
          break;
        case 3:
          message.connection_policy_id = reader.string();
          break;
        case 4:
          message.channel_policy_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): TokenConfigs {
    const obj = createBaseTokenConfigs();
    if (isSet(object.handler_token_unit)) obj.handler_token_unit = String(object.handler_token_unit);
    if (isSet(object.client_policy_id)) obj.client_policy_id = String(object.client_policy_id);
    if (isSet(object.connection_policy_id)) obj.connection_policy_id = String(object.connection_policy_id);
    if (isSet(object.channel_policy_id)) obj.channel_policy_id = String(object.channel_policy_id);
    return obj;
  },
  toJSON(message: TokenConfigs): unknown {
    const obj: any = {};
    message.handler_token_unit !== undefined && (obj.handler_token_unit = message.handler_token_unit);
    message.client_policy_id !== undefined && (obj.client_policy_id = message.client_policy_id);
    message.connection_policy_id !== undefined && (obj.connection_policy_id = message.connection_policy_id);
    message.channel_policy_id !== undefined && (obj.channel_policy_id = message.channel_policy_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<TokenConfigs>, I>>(object: I): TokenConfigs {
    const message = createBaseTokenConfigs();
    message.handler_token_unit = object.handler_token_unit ?? "";
    message.client_policy_id = object.client_policy_id ?? "";
    message.connection_policy_id = object.connection_policy_id ?? "";
    message.channel_policy_id = object.channel_policy_id ?? "";
    return message;
  },
};
function createBaseHeight(): Height {
  return {
    revision_number: BigInt(0),
    revision_height: BigInt(0),
  };
}
export const Height = {
  typeUrl: "/ibc.clients.cardano.v1.Height",
  encode(message: Height, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.revision_number !== BigInt(0)) {
      writer.uint32(8).uint64(message.revision_number);
    }
    if (message.revision_height !== BigInt(0)) {
      writer.uint32(16).uint64(message.revision_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Height {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHeight();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.revision_number = reader.uint64();
          break;
        case 2:
          message.revision_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Height {
    const obj = createBaseHeight();
    if (isSet(object.revision_number)) obj.revision_number = BigInt(object.revision_number.toString());
    if (isSet(object.revision_height)) obj.revision_height = BigInt(object.revision_height.toString());
    return obj;
  },
  toJSON(message: Height): unknown {
    const obj: any = {};
    message.revision_number !== undefined &&
      (obj.revision_number = (message.revision_number || BigInt(0)).toString());
    message.revision_height !== undefined &&
      (obj.revision_height = (message.revision_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Height>, I>>(object: I): Height {
    const message = createBaseHeight();
    if (object.revision_number !== undefined && object.revision_number !== null) {
      message.revision_number = BigInt(object.revision_number.toString());
    }
    if (object.revision_height !== undefined && object.revision_height !== null) {
      message.revision_height = BigInt(object.revision_height.toString());
    }
    return message;
  },
};
function createBaseConsensusState(): ConsensusState {
  return {
    timestamp: BigInt(0),
    slot: BigInt(0),
  };
}
export const ConsensusState = {
  typeUrl: "/ibc.clients.cardano.v1.ConsensusState",
  encode(message: ConsensusState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(8).uint64(message.timestamp);
    }
    if (message.slot !== BigInt(0)) {
      writer.uint32(16).uint64(message.slot);
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
          message.timestamp = reader.uint64();
          break;
        case 2:
          message.slot = reader.uint64();
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
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    if (isSet(object.slot)) obj.slot = BigInt(object.slot.toString());
    return obj;
  },
  toJSON(message: ConsensusState): unknown {
    const obj: any = {};
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.slot !== undefined && (obj.slot = (message.slot || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ConsensusState>, I>>(object: I): ConsensusState {
    const message = createBaseConsensusState();
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    if (object.slot !== undefined && object.slot !== null) {
      message.slot = BigInt(object.slot.toString());
    }
    return message;
  },
};
function createBaseValidator(): Validator {
  return {
    vrf_key_hash: "",
    pool_id: "",
  };
}
export const Validator = {
  typeUrl: "/ibc.clients.cardano.v1.Validator",
  encode(message: Validator, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.vrf_key_hash !== "") {
      writer.uint32(10).string(message.vrf_key_hash);
    }
    if (message.pool_id !== "") {
      writer.uint32(18).string(message.pool_id);
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
          message.vrf_key_hash = reader.string();
          break;
        case 2:
          message.pool_id = reader.string();
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
    if (isSet(object.vrf_key_hash)) obj.vrf_key_hash = String(object.vrf_key_hash);
    if (isSet(object.pool_id)) obj.pool_id = String(object.pool_id);
    return obj;
  },
  toJSON(message: Validator): unknown {
    const obj: any = {};
    message.vrf_key_hash !== undefined && (obj.vrf_key_hash = message.vrf_key_hash);
    message.pool_id !== undefined && (obj.pool_id = message.pool_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Validator>, I>>(object: I): Validator {
    const message = createBaseValidator();
    message.vrf_key_hash = object.vrf_key_hash ?? "";
    message.pool_id = object.pool_id ?? "";
    return message;
  },
};
function createBaseBlockData(): BlockData {
  return {
    height: undefined,
    slot: BigInt(0),
    hash: "",
    prev_hash: "",
    epoch_no: BigInt(0),
    header_cbor: "",
    body_cbor: "",
    epoch_nonce: "",
    timestamp: BigInt(0),
    chain_id: "",
  };
}
export const BlockData = {
  typeUrl: "/ibc.clients.cardano.v1.BlockData",
  encode(message: BlockData, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(10).fork()).ldelim();
    }
    if (message.slot !== BigInt(0)) {
      writer.uint32(16).uint64(message.slot);
    }
    if (message.hash !== "") {
      writer.uint32(26).string(message.hash);
    }
    if (message.prev_hash !== "") {
      writer.uint32(34).string(message.prev_hash);
    }
    if (message.epoch_no !== BigInt(0)) {
      writer.uint32(40).uint64(message.epoch_no);
    }
    if (message.header_cbor !== "") {
      writer.uint32(50).string(message.header_cbor);
    }
    if (message.body_cbor !== "") {
      writer.uint32(58).string(message.body_cbor);
    }
    if (message.epoch_nonce !== "") {
      writer.uint32(66).string(message.epoch_nonce);
    }
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(72).uint64(message.timestamp);
    }
    if (message.chain_id !== "") {
      writer.uint32(82).string(message.chain_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BlockData {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBlockData();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = Height.decode(reader, reader.uint32());
          break;
        case 2:
          message.slot = reader.uint64();
          break;
        case 3:
          message.hash = reader.string();
          break;
        case 4:
          message.prev_hash = reader.string();
          break;
        case 5:
          message.epoch_no = reader.uint64();
          break;
        case 6:
          message.header_cbor = reader.string();
          break;
        case 7:
          message.body_cbor = reader.string();
          break;
        case 8:
          message.epoch_nonce = reader.string();
          break;
        case 9:
          message.timestamp = reader.uint64();
          break;
        case 10:
          message.chain_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BlockData {
    const obj = createBaseBlockData();
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    if (isSet(object.slot)) obj.slot = BigInt(object.slot.toString());
    if (isSet(object.hash)) obj.hash = String(object.hash);
    if (isSet(object.prev_hash)) obj.prev_hash = String(object.prev_hash);
    if (isSet(object.epoch_no)) obj.epoch_no = BigInt(object.epoch_no.toString());
    if (isSet(object.header_cbor)) obj.header_cbor = String(object.header_cbor);
    if (isSet(object.body_cbor)) obj.body_cbor = String(object.body_cbor);
    if (isSet(object.epoch_nonce)) obj.epoch_nonce = String(object.epoch_nonce);
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    return obj;
  },
  toJSON(message: BlockData): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    message.slot !== undefined && (obj.slot = (message.slot || BigInt(0)).toString());
    message.hash !== undefined && (obj.hash = message.hash);
    message.prev_hash !== undefined && (obj.prev_hash = message.prev_hash);
    message.epoch_no !== undefined && (obj.epoch_no = (message.epoch_no || BigInt(0)).toString());
    message.header_cbor !== undefined && (obj.header_cbor = message.header_cbor);
    message.body_cbor !== undefined && (obj.body_cbor = message.body_cbor);
    message.epoch_nonce !== undefined && (obj.epoch_nonce = message.epoch_nonce);
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BlockData>, I>>(object: I): BlockData {
    const message = createBaseBlockData();
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    if (object.slot !== undefined && object.slot !== null) {
      message.slot = BigInt(object.slot.toString());
    }
    message.hash = object.hash ?? "";
    message.prev_hash = object.prev_hash ?? "";
    if (object.epoch_no !== undefined && object.epoch_no !== null) {
      message.epoch_no = BigInt(object.epoch_no.toString());
    }
    message.header_cbor = object.header_cbor ?? "";
    message.body_cbor = object.body_cbor ?? "";
    message.epoch_nonce = object.epoch_nonce ?? "";
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    message.chain_id = object.chain_id ?? "";
    return message;
  },
};
function createBaseClientState(): ClientState {
  return {
    chain_id: "",
    latest_height: undefined,
    frozen_height: undefined,
    valid_after: BigInt(0),
    genesis_time: BigInt(0),
    current_epoch: BigInt(0),
    epoch_length: BigInt(0),
    slot_per_kes_period: BigInt(0),
    current_validator_set: [],
    next_validator_set: [],
    trusting_period: BigInt(0),
    upgrade_path: [],
    token_configs: undefined,
  };
}
export const ClientState = {
  typeUrl: "/ibc.clients.cardano.v1.ClientState",
  encode(message: ClientState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.chain_id !== "") {
      writer.uint32(10).string(message.chain_id);
    }
    if (message.latest_height !== undefined) {
      Height.encode(message.latest_height, writer.uint32(18).fork()).ldelim();
    }
    if (message.frozen_height !== undefined) {
      Height.encode(message.frozen_height, writer.uint32(26).fork()).ldelim();
    }
    if (message.valid_after !== BigInt(0)) {
      writer.uint32(32).uint64(message.valid_after);
    }
    if (message.genesis_time !== BigInt(0)) {
      writer.uint32(40).uint64(message.genesis_time);
    }
    if (message.current_epoch !== BigInt(0)) {
      writer.uint32(48).uint64(message.current_epoch);
    }
    if (message.epoch_length !== BigInt(0)) {
      writer.uint32(56).uint64(message.epoch_length);
    }
    if (message.slot_per_kes_period !== BigInt(0)) {
      writer.uint32(64).uint64(message.slot_per_kes_period);
    }
    for (const v of message.current_validator_set) {
      Validator.encode(v!, writer.uint32(74).fork()).ldelim();
    }
    for (const v of message.next_validator_set) {
      Validator.encode(v!, writer.uint32(82).fork()).ldelim();
    }
    if (message.trusting_period !== BigInt(0)) {
      writer.uint32(88).uint64(message.trusting_period);
    }
    for (const v of message.upgrade_path) {
      writer.uint32(98).string(v!);
    }
    if (message.token_configs !== undefined) {
      TokenConfigs.encode(message.token_configs, writer.uint32(106).fork()).ldelim();
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
          message.latest_height = Height.decode(reader, reader.uint32());
          break;
        case 3:
          message.frozen_height = Height.decode(reader, reader.uint32());
          break;
        case 4:
          message.valid_after = reader.uint64();
          break;
        case 5:
          message.genesis_time = reader.uint64();
          break;
        case 6:
          message.current_epoch = reader.uint64();
          break;
        case 7:
          message.epoch_length = reader.uint64();
          break;
        case 8:
          message.slot_per_kes_period = reader.uint64();
          break;
        case 9:
          message.current_validator_set.push(Validator.decode(reader, reader.uint32()));
          break;
        case 10:
          message.next_validator_set.push(Validator.decode(reader, reader.uint32()));
          break;
        case 11:
          message.trusting_period = reader.uint64();
          break;
        case 12:
          message.upgrade_path.push(reader.string());
          break;
        case 13:
          message.token_configs = TokenConfigs.decode(reader, reader.uint32());
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
    if (isSet(object.latest_height)) obj.latest_height = Height.fromJSON(object.latest_height);
    if (isSet(object.frozen_height)) obj.frozen_height = Height.fromJSON(object.frozen_height);
    if (isSet(object.valid_after)) obj.valid_after = BigInt(object.valid_after.toString());
    if (isSet(object.genesis_time)) obj.genesis_time = BigInt(object.genesis_time.toString());
    if (isSet(object.current_epoch)) obj.current_epoch = BigInt(object.current_epoch.toString());
    if (isSet(object.epoch_length)) obj.epoch_length = BigInt(object.epoch_length.toString());
    if (isSet(object.slot_per_kes_period))
      obj.slot_per_kes_period = BigInt(object.slot_per_kes_period.toString());
    if (Array.isArray(object?.current_validator_set))
      obj.current_validator_set = object.current_validator_set.map((e: any) => Validator.fromJSON(e));
    if (Array.isArray(object?.next_validator_set))
      obj.next_validator_set = object.next_validator_set.map((e: any) => Validator.fromJSON(e));
    if (isSet(object.trusting_period)) obj.trusting_period = BigInt(object.trusting_period.toString());
    if (Array.isArray(object?.upgrade_path))
      obj.upgrade_path = object.upgrade_path.map((e: any) => String(e));
    if (isSet(object.token_configs)) obj.token_configs = TokenConfigs.fromJSON(object.token_configs);
    return obj;
  },
  toJSON(message: ClientState): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.latest_height !== undefined &&
      (obj.latest_height = message.latest_height ? Height.toJSON(message.latest_height) : undefined);
    message.frozen_height !== undefined &&
      (obj.frozen_height = message.frozen_height ? Height.toJSON(message.frozen_height) : undefined);
    message.valid_after !== undefined && (obj.valid_after = (message.valid_after || BigInt(0)).toString());
    message.genesis_time !== undefined && (obj.genesis_time = (message.genesis_time || BigInt(0)).toString());
    message.current_epoch !== undefined &&
      (obj.current_epoch = (message.current_epoch || BigInt(0)).toString());
    message.epoch_length !== undefined && (obj.epoch_length = (message.epoch_length || BigInt(0)).toString());
    message.slot_per_kes_period !== undefined &&
      (obj.slot_per_kes_period = (message.slot_per_kes_period || BigInt(0)).toString());
    if (message.current_validator_set) {
      obj.current_validator_set = message.current_validator_set.map((e) =>
        e ? Validator.toJSON(e) : undefined,
      );
    } else {
      obj.current_validator_set = [];
    }
    if (message.next_validator_set) {
      obj.next_validator_set = message.next_validator_set.map((e) => (e ? Validator.toJSON(e) : undefined));
    } else {
      obj.next_validator_set = [];
    }
    message.trusting_period !== undefined &&
      (obj.trusting_period = (message.trusting_period || BigInt(0)).toString());
    if (message.upgrade_path) {
      obj.upgrade_path = message.upgrade_path.map((e) => e);
    } else {
      obj.upgrade_path = [];
    }
    message.token_configs !== undefined &&
      (obj.token_configs = message.token_configs ? TokenConfigs.toJSON(message.token_configs) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ClientState>, I>>(object: I): ClientState {
    const message = createBaseClientState();
    message.chain_id = object.chain_id ?? "";
    if (object.latest_height !== undefined && object.latest_height !== null) {
      message.latest_height = Height.fromPartial(object.latest_height);
    }
    if (object.frozen_height !== undefined && object.frozen_height !== null) {
      message.frozen_height = Height.fromPartial(object.frozen_height);
    }
    if (object.valid_after !== undefined && object.valid_after !== null) {
      message.valid_after = BigInt(object.valid_after.toString());
    }
    if (object.genesis_time !== undefined && object.genesis_time !== null) {
      message.genesis_time = BigInt(object.genesis_time.toString());
    }
    if (object.current_epoch !== undefined && object.current_epoch !== null) {
      message.current_epoch = BigInt(object.current_epoch.toString());
    }
    if (object.epoch_length !== undefined && object.epoch_length !== null) {
      message.epoch_length = BigInt(object.epoch_length.toString());
    }
    if (object.slot_per_kes_period !== undefined && object.slot_per_kes_period !== null) {
      message.slot_per_kes_period = BigInt(object.slot_per_kes_period.toString());
    }
    message.current_validator_set = object.current_validator_set?.map((e) => Validator.fromPartial(e)) || [];
    message.next_validator_set = object.next_validator_set?.map((e) => Validator.fromPartial(e)) || [];
    if (object.trusting_period !== undefined && object.trusting_period !== null) {
      message.trusting_period = BigInt(object.trusting_period.toString());
    }
    message.upgrade_path = object.upgrade_path?.map((e) => e) || [];
    if (object.token_configs !== undefined && object.token_configs !== null) {
      message.token_configs = TokenConfigs.fromPartial(object.token_configs);
    }
    return message;
  },
};
function createBaseMisbehaviour(): Misbehaviour {
  return {
    client_id: "",
    block_data1: undefined,
    block_data2: undefined,
  };
}
export const Misbehaviour = {
  typeUrl: "/ibc.clients.cardano.v1.Misbehaviour",
  encode(message: Misbehaviour, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.block_data1 !== undefined) {
      BlockData.encode(message.block_data1, writer.uint32(18).fork()).ldelim();
    }
    if (message.block_data2 !== undefined) {
      BlockData.encode(message.block_data2, writer.uint32(26).fork()).ldelim();
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
          message.block_data1 = BlockData.decode(reader, reader.uint32());
          break;
        case 3:
          message.block_data2 = BlockData.decode(reader, reader.uint32());
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
    if (isSet(object.block_data1)) obj.block_data1 = BlockData.fromJSON(object.block_data1);
    if (isSet(object.block_data2)) obj.block_data2 = BlockData.fromJSON(object.block_data2);
    return obj;
  },
  toJSON(message: Misbehaviour): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.block_data1 !== undefined &&
      (obj.block_data1 = message.block_data1 ? BlockData.toJSON(message.block_data1) : undefined);
    message.block_data2 !== undefined &&
      (obj.block_data2 = message.block_data2 ? BlockData.toJSON(message.block_data2) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Misbehaviour>, I>>(object: I): Misbehaviour {
    const message = createBaseMisbehaviour();
    message.client_id = object.client_id ?? "";
    if (object.block_data1 !== undefined && object.block_data1 !== null) {
      message.block_data1 = BlockData.fromPartial(object.block_data1);
    }
    if (object.block_data2 !== undefined && object.block_data2 !== null) {
      message.block_data2 = BlockData.fromPartial(object.block_data2);
    }
    return message;
  },
};
