/* eslint-disable */
import { Duration } from "../../../../google/protobuf/duration";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../../helpers";
export const protobufPackage = "ibc.lightclients.stability.v1";
export interface Height {
  revision_number: bigint;
  revision_height: bigint;
}
export interface HeuristicParams {
  threshold_depth: bigint;
  threshold_unique_pools: bigint;
  threshold_unique_stake_bps: bigint;
  depth_weight_bps: bigint;
  pools_weight_bps: bigint;
  stake_weight_bps: bigint;
}
export interface StakeDistributionEntry {
  pool_id: string;
  stake: bigint;
  vrf_key_hash: Uint8Array;
}
export interface ClientState {
  chain_id: string;
  latest_height?: Height;
  frozen_height?: Height;
  current_epoch: bigint;
  trusting_period: Duration;
  heuristic_params?: HeuristicParams;
  upgrade_path: string[];
  host_state_nft_policy_id: Uint8Array;
  host_state_nft_token_name: Uint8Array;
  epoch_stake_distribution: StakeDistributionEntry[];
  epoch_nonce: Uint8Array;
  slots_per_kes_period: bigint;
  current_epoch_start_slot: bigint;
  current_epoch_end_slot_exclusive: bigint;
  system_start_unix_ns: bigint;
  slot_length_ns: bigint;
}
export interface ConsensusState {
  timestamp: bigint;
  ibc_state_root: Uint8Array;
  accepted_block_hash: string;
  accepted_epoch: bigint;
  unique_pools_count: bigint;
  unique_stake_bps: bigint;
  security_score_bps: bigint;
}
export interface Misbehaviour {
  /** @deprecated */
  client_id: string;
  stability_header1?: StabilityHeader;
  stability_header2?: StabilityHeader;
}
export interface StabilityBlock {
  height?: Height;
  slot: bigint;
  hash: string;
  prev_hash: string;
  epoch: bigint;
  timestamp: bigint;
  slot_leader: string;
  block_cbor: Uint8Array;
}
export interface StabilityHeader {
  trusted_height?: Height;
  anchor_block?: StabilityBlock;
  descendant_blocks: StabilityBlock[];
  host_state_tx_hash: string;
  host_state_tx_body_cbor: Uint8Array;
  host_state_tx_output_index: number;
  unique_pools_count: bigint;
  unique_stake_bps: bigint;
  security_score_bps: bigint;
  bridge_blocks: StabilityBlock[];
}
function createBaseHeight(): Height {
  return {
    revision_number: BigInt(0),
    revision_height: BigInt(0),
  };
}
export const Height = {
  typeUrl: "/ibc.lightclients.stability.v1.Height",
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
function createBaseHeuristicParams(): HeuristicParams {
  return {
    threshold_depth: BigInt(0),
    threshold_unique_pools: BigInt(0),
    threshold_unique_stake_bps: BigInt(0),
    depth_weight_bps: BigInt(0),
    pools_weight_bps: BigInt(0),
    stake_weight_bps: BigInt(0),
  };
}
export const HeuristicParams = {
  typeUrl: "/ibc.lightclients.stability.v1.HeuristicParams",
  encode(message: HeuristicParams, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.threshold_depth !== BigInt(0)) {
      writer.uint32(32).uint64(message.threshold_depth);
    }
    if (message.threshold_unique_pools !== BigInt(0)) {
      writer.uint32(40).uint64(message.threshold_unique_pools);
    }
    if (message.threshold_unique_stake_bps !== BigInt(0)) {
      writer.uint32(48).uint64(message.threshold_unique_stake_bps);
    }
    if (message.depth_weight_bps !== BigInt(0)) {
      writer.uint32(56).uint64(message.depth_weight_bps);
    }
    if (message.pools_weight_bps !== BigInt(0)) {
      writer.uint32(64).uint64(message.pools_weight_bps);
    }
    if (message.stake_weight_bps !== BigInt(0)) {
      writer.uint32(72).uint64(message.stake_weight_bps);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): HeuristicParams {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHeuristicParams();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 4:
          message.threshold_depth = reader.uint64();
          break;
        case 5:
          message.threshold_unique_pools = reader.uint64();
          break;
        case 6:
          message.threshold_unique_stake_bps = reader.uint64();
          break;
        case 7:
          message.depth_weight_bps = reader.uint64();
          break;
        case 8:
          message.pools_weight_bps = reader.uint64();
          break;
        case 9:
          message.stake_weight_bps = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): HeuristicParams {
    const obj = createBaseHeuristicParams();
    if (isSet(object.threshold_depth)) obj.threshold_depth = BigInt(object.threshold_depth.toString());
    if (isSet(object.threshold_unique_pools))
      obj.threshold_unique_pools = BigInt(object.threshold_unique_pools.toString());
    if (isSet(object.threshold_unique_stake_bps))
      obj.threshold_unique_stake_bps = BigInt(object.threshold_unique_stake_bps.toString());
    if (isSet(object.depth_weight_bps)) obj.depth_weight_bps = BigInt(object.depth_weight_bps.toString());
    if (isSet(object.pools_weight_bps)) obj.pools_weight_bps = BigInt(object.pools_weight_bps.toString());
    if (isSet(object.stake_weight_bps)) obj.stake_weight_bps = BigInt(object.stake_weight_bps.toString());
    return obj;
  },
  toJSON(message: HeuristicParams): unknown {
    const obj: any = {};
    message.threshold_depth !== undefined &&
      (obj.threshold_depth = (message.threshold_depth || BigInt(0)).toString());
    message.threshold_unique_pools !== undefined &&
      (obj.threshold_unique_pools = (message.threshold_unique_pools || BigInt(0)).toString());
    message.threshold_unique_stake_bps !== undefined &&
      (obj.threshold_unique_stake_bps = (message.threshold_unique_stake_bps || BigInt(0)).toString());
    message.depth_weight_bps !== undefined &&
      (obj.depth_weight_bps = (message.depth_weight_bps || BigInt(0)).toString());
    message.pools_weight_bps !== undefined &&
      (obj.pools_weight_bps = (message.pools_weight_bps || BigInt(0)).toString());
    message.stake_weight_bps !== undefined &&
      (obj.stake_weight_bps = (message.stake_weight_bps || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<HeuristicParams>, I>>(object: I): HeuristicParams {
    const message = createBaseHeuristicParams();
    if (object.threshold_depth !== undefined && object.threshold_depth !== null) {
      message.threshold_depth = BigInt(object.threshold_depth.toString());
    }
    if (object.threshold_unique_pools !== undefined && object.threshold_unique_pools !== null) {
      message.threshold_unique_pools = BigInt(object.threshold_unique_pools.toString());
    }
    if (object.threshold_unique_stake_bps !== undefined && object.threshold_unique_stake_bps !== null) {
      message.threshold_unique_stake_bps = BigInt(object.threshold_unique_stake_bps.toString());
    }
    if (object.depth_weight_bps !== undefined && object.depth_weight_bps !== null) {
      message.depth_weight_bps = BigInt(object.depth_weight_bps.toString());
    }
    if (object.pools_weight_bps !== undefined && object.pools_weight_bps !== null) {
      message.pools_weight_bps = BigInt(object.pools_weight_bps.toString());
    }
    if (object.stake_weight_bps !== undefined && object.stake_weight_bps !== null) {
      message.stake_weight_bps = BigInt(object.stake_weight_bps.toString());
    }
    return message;
  },
};
function createBaseStakeDistributionEntry(): StakeDistributionEntry {
  return {
    pool_id: "",
    stake: BigInt(0),
    vrf_key_hash: new Uint8Array(),
  };
}
export const StakeDistributionEntry = {
  typeUrl: "/ibc.lightclients.stability.v1.StakeDistributionEntry",
  encode(message: StakeDistributionEntry, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pool_id !== "") {
      writer.uint32(10).string(message.pool_id);
    }
    if (message.stake !== BigInt(0)) {
      writer.uint32(16).uint64(message.stake);
    }
    if (message.vrf_key_hash.length !== 0) {
      writer.uint32(26).bytes(message.vrf_key_hash);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): StakeDistributionEntry {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStakeDistributionEntry();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pool_id = reader.string();
          break;
        case 2:
          message.stake = reader.uint64();
          break;
        case 3:
          message.vrf_key_hash = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): StakeDistributionEntry {
    const obj = createBaseStakeDistributionEntry();
    if (isSet(object.pool_id)) obj.pool_id = String(object.pool_id);
    if (isSet(object.stake)) obj.stake = BigInt(object.stake.toString());
    if (isSet(object.vrf_key_hash)) obj.vrf_key_hash = bytesFromBase64(object.vrf_key_hash);
    return obj;
  },
  toJSON(message: StakeDistributionEntry): unknown {
    const obj: any = {};
    message.pool_id !== undefined && (obj.pool_id = message.pool_id);
    message.stake !== undefined && (obj.stake = (message.stake || BigInt(0)).toString());
    message.vrf_key_hash !== undefined &&
      (obj.vrf_key_hash = base64FromBytes(
        message.vrf_key_hash !== undefined ? message.vrf_key_hash : new Uint8Array(),
      ));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<StakeDistributionEntry>, I>>(object: I): StakeDistributionEntry {
    const message = createBaseStakeDistributionEntry();
    message.pool_id = object.pool_id ?? "";
    if (object.stake !== undefined && object.stake !== null) {
      message.stake = BigInt(object.stake.toString());
    }
    message.vrf_key_hash = object.vrf_key_hash ?? new Uint8Array();
    return message;
  },
};
function createBaseClientState(): ClientState {
  return {
    chain_id: "",
    latest_height: undefined,
    frozen_height: undefined,
    current_epoch: BigInt(0),
    trusting_period: Duration.fromPartial({}),
    heuristic_params: undefined,
    upgrade_path: [],
    host_state_nft_policy_id: new Uint8Array(),
    host_state_nft_token_name: new Uint8Array(),
    epoch_stake_distribution: [],
    epoch_nonce: new Uint8Array(),
    slots_per_kes_period: BigInt(0),
    current_epoch_start_slot: BigInt(0),
    current_epoch_end_slot_exclusive: BigInt(0),
    system_start_unix_ns: BigInt(0),
    slot_length_ns: BigInt(0),
  };
}
export const ClientState = {
  typeUrl: "/ibc.lightclients.stability.v1.ClientState",
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
    if (message.current_epoch !== BigInt(0)) {
      writer.uint32(32).uint64(message.current_epoch);
    }
    if (message.trusting_period !== undefined) {
      Duration.encode(message.trusting_period, writer.uint32(42).fork()).ldelim();
    }
    if (message.heuristic_params !== undefined) {
      HeuristicParams.encode(message.heuristic_params, writer.uint32(50).fork()).ldelim();
    }
    for (const v of message.upgrade_path) {
      writer.uint32(58).string(v!);
    }
    if (message.host_state_nft_policy_id.length !== 0) {
      writer.uint32(66).bytes(message.host_state_nft_policy_id);
    }
    if (message.host_state_nft_token_name.length !== 0) {
      writer.uint32(74).bytes(message.host_state_nft_token_name);
    }
    for (const v of message.epoch_stake_distribution) {
      StakeDistributionEntry.encode(v!, writer.uint32(82).fork()).ldelim();
    }
    if (message.epoch_nonce.length !== 0) {
      writer.uint32(90).bytes(message.epoch_nonce);
    }
    if (message.slots_per_kes_period !== BigInt(0)) {
      writer.uint32(96).uint64(message.slots_per_kes_period);
    }
    if (message.current_epoch_start_slot !== BigInt(0)) {
      writer.uint32(104).uint64(message.current_epoch_start_slot);
    }
    if (message.current_epoch_end_slot_exclusive !== BigInt(0)) {
      writer.uint32(112).uint64(message.current_epoch_end_slot_exclusive);
    }
    if (message.system_start_unix_ns !== BigInt(0)) {
      writer.uint32(120).uint64(message.system_start_unix_ns);
    }
    if (message.slot_length_ns !== BigInt(0)) {
      writer.uint32(128).uint64(message.slot_length_ns);
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
          message.current_epoch = reader.uint64();
          break;
        case 5:
          message.trusting_period = Duration.decode(reader, reader.uint32());
          break;
        case 6:
          message.heuristic_params = HeuristicParams.decode(reader, reader.uint32());
          break;
        case 7:
          message.upgrade_path.push(reader.string());
          break;
        case 8:
          message.host_state_nft_policy_id = reader.bytes();
          break;
        case 9:
          message.host_state_nft_token_name = reader.bytes();
          break;
        case 10:
          message.epoch_stake_distribution.push(StakeDistributionEntry.decode(reader, reader.uint32()));
          break;
        case 11:
          message.epoch_nonce = reader.bytes();
          break;
        case 12:
          message.slots_per_kes_period = reader.uint64();
          break;
        case 13:
          message.current_epoch_start_slot = reader.uint64();
          break;
        case 14:
          message.current_epoch_end_slot_exclusive = reader.uint64();
          break;
        case 15:
          message.system_start_unix_ns = reader.uint64();
          break;
        case 16:
          message.slot_length_ns = reader.uint64();
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
    if (isSet(object.current_epoch)) obj.current_epoch = BigInt(object.current_epoch.toString());
    if (isSet(object.trusting_period)) obj.trusting_period = Duration.fromJSON(object.trusting_period);
    if (isSet(object.heuristic_params))
      obj.heuristic_params = HeuristicParams.fromJSON(object.heuristic_params);
    if (Array.isArray(object?.upgrade_path))
      obj.upgrade_path = object.upgrade_path.map((e: any) => String(e));
    if (isSet(object.host_state_nft_policy_id))
      obj.host_state_nft_policy_id = bytesFromBase64(object.host_state_nft_policy_id);
    if (isSet(object.host_state_nft_token_name))
      obj.host_state_nft_token_name = bytesFromBase64(object.host_state_nft_token_name);
    if (Array.isArray(object?.epoch_stake_distribution))
      obj.epoch_stake_distribution = object.epoch_stake_distribution.map((e: any) =>
        StakeDistributionEntry.fromJSON(e),
      );
    if (isSet(object.epoch_nonce)) obj.epoch_nonce = bytesFromBase64(object.epoch_nonce);
    if (isSet(object.slots_per_kes_period))
      obj.slots_per_kes_period = BigInt(object.slots_per_kes_period.toString());
    if (isSet(object.current_epoch_start_slot))
      obj.current_epoch_start_slot = BigInt(object.current_epoch_start_slot.toString());
    if (isSet(object.current_epoch_end_slot_exclusive))
      obj.current_epoch_end_slot_exclusive = BigInt(object.current_epoch_end_slot_exclusive.toString());
    if (isSet(object.system_start_unix_ns))
      obj.system_start_unix_ns = BigInt(object.system_start_unix_ns.toString());
    if (isSet(object.slot_length_ns)) obj.slot_length_ns = BigInt(object.slot_length_ns.toString());
    return obj;
  },
  toJSON(message: ClientState): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.latest_height !== undefined &&
      (obj.latest_height = message.latest_height ? Height.toJSON(message.latest_height) : undefined);
    message.frozen_height !== undefined &&
      (obj.frozen_height = message.frozen_height ? Height.toJSON(message.frozen_height) : undefined);
    message.current_epoch !== undefined &&
      (obj.current_epoch = (message.current_epoch || BigInt(0)).toString());
    message.trusting_period !== undefined &&
      (obj.trusting_period = message.trusting_period ? Duration.toJSON(message.trusting_period) : undefined);
    message.heuristic_params !== undefined &&
      (obj.heuristic_params = message.heuristic_params
        ? HeuristicParams.toJSON(message.heuristic_params)
        : undefined);
    if (message.upgrade_path) {
      obj.upgrade_path = message.upgrade_path.map((e) => e);
    } else {
      obj.upgrade_path = [];
    }
    message.host_state_nft_policy_id !== undefined &&
      (obj.host_state_nft_policy_id = base64FromBytes(
        message.host_state_nft_policy_id !== undefined ? message.host_state_nft_policy_id : new Uint8Array(),
      ));
    message.host_state_nft_token_name !== undefined &&
      (obj.host_state_nft_token_name = base64FromBytes(
        message.host_state_nft_token_name !== undefined
          ? message.host_state_nft_token_name
          : new Uint8Array(),
      ));
    if (message.epoch_stake_distribution) {
      obj.epoch_stake_distribution = message.epoch_stake_distribution.map((e) =>
        e ? StakeDistributionEntry.toJSON(e) : undefined,
      );
    } else {
      obj.epoch_stake_distribution = [];
    }
    message.epoch_nonce !== undefined &&
      (obj.epoch_nonce = base64FromBytes(
        message.epoch_nonce !== undefined ? message.epoch_nonce : new Uint8Array(),
      ));
    message.slots_per_kes_period !== undefined &&
      (obj.slots_per_kes_period = (message.slots_per_kes_period || BigInt(0)).toString());
    message.current_epoch_start_slot !== undefined &&
      (obj.current_epoch_start_slot = (message.current_epoch_start_slot || BigInt(0)).toString());
    message.current_epoch_end_slot_exclusive !== undefined &&
      (obj.current_epoch_end_slot_exclusive = (
        message.current_epoch_end_slot_exclusive || BigInt(0)
      ).toString());
    message.system_start_unix_ns !== undefined &&
      (obj.system_start_unix_ns = (message.system_start_unix_ns || BigInt(0)).toString());
    message.slot_length_ns !== undefined &&
      (obj.slot_length_ns = (message.slot_length_ns || BigInt(0)).toString());
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
    if (object.current_epoch !== undefined && object.current_epoch !== null) {
      message.current_epoch = BigInt(object.current_epoch.toString());
    }
    if (object.trusting_period !== undefined && object.trusting_period !== null) {
      message.trusting_period = Duration.fromPartial(object.trusting_period);
    }
    if (object.heuristic_params !== undefined && object.heuristic_params !== null) {
      message.heuristic_params = HeuristicParams.fromPartial(object.heuristic_params);
    }
    message.upgrade_path = object.upgrade_path?.map((e) => e) || [];
    message.host_state_nft_policy_id = object.host_state_nft_policy_id ?? new Uint8Array();
    message.host_state_nft_token_name = object.host_state_nft_token_name ?? new Uint8Array();
    message.epoch_stake_distribution =
      object.epoch_stake_distribution?.map((e) => StakeDistributionEntry.fromPartial(e)) || [];
    message.epoch_nonce = object.epoch_nonce ?? new Uint8Array();
    if (object.slots_per_kes_period !== undefined && object.slots_per_kes_period !== null) {
      message.slots_per_kes_period = BigInt(object.slots_per_kes_period.toString());
    }
    if (object.current_epoch_start_slot !== undefined && object.current_epoch_start_slot !== null) {
      message.current_epoch_start_slot = BigInt(object.current_epoch_start_slot.toString());
    }
    if (
      object.current_epoch_end_slot_exclusive !== undefined &&
      object.current_epoch_end_slot_exclusive !== null
    ) {
      message.current_epoch_end_slot_exclusive = BigInt(object.current_epoch_end_slot_exclusive.toString());
    }
    if (object.system_start_unix_ns !== undefined && object.system_start_unix_ns !== null) {
      message.system_start_unix_ns = BigInt(object.system_start_unix_ns.toString());
    }
    if (object.slot_length_ns !== undefined && object.slot_length_ns !== null) {
      message.slot_length_ns = BigInt(object.slot_length_ns.toString());
    }
    return message;
  },
};
function createBaseConsensusState(): ConsensusState {
  return {
    timestamp: BigInt(0),
    ibc_state_root: new Uint8Array(),
    accepted_block_hash: "",
    accepted_epoch: BigInt(0),
    unique_pools_count: BigInt(0),
    unique_stake_bps: BigInt(0),
    security_score_bps: BigInt(0),
  };
}
export const ConsensusState = {
  typeUrl: "/ibc.lightclients.stability.v1.ConsensusState",
  encode(message: ConsensusState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(8).uint64(message.timestamp);
    }
    if (message.ibc_state_root.length !== 0) {
      writer.uint32(18).bytes(message.ibc_state_root);
    }
    if (message.accepted_block_hash !== "") {
      writer.uint32(26).string(message.accepted_block_hash);
    }
    if (message.accepted_epoch !== BigInt(0)) {
      writer.uint32(32).uint64(message.accepted_epoch);
    }
    if (message.unique_pools_count !== BigInt(0)) {
      writer.uint32(40).uint64(message.unique_pools_count);
    }
    if (message.unique_stake_bps !== BigInt(0)) {
      writer.uint32(48).uint64(message.unique_stake_bps);
    }
    if (message.security_score_bps !== BigInt(0)) {
      writer.uint32(56).uint64(message.security_score_bps);
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
          message.ibc_state_root = reader.bytes();
          break;
        case 3:
          message.accepted_block_hash = reader.string();
          break;
        case 4:
          message.accepted_epoch = reader.uint64();
          break;
        case 5:
          message.unique_pools_count = reader.uint64();
          break;
        case 6:
          message.unique_stake_bps = reader.uint64();
          break;
        case 7:
          message.security_score_bps = reader.uint64();
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
    if (isSet(object.ibc_state_root)) obj.ibc_state_root = bytesFromBase64(object.ibc_state_root);
    if (isSet(object.accepted_block_hash)) obj.accepted_block_hash = String(object.accepted_block_hash);
    if (isSet(object.accepted_epoch)) obj.accepted_epoch = BigInt(object.accepted_epoch.toString());
    if (isSet(object.unique_pools_count))
      obj.unique_pools_count = BigInt(object.unique_pools_count.toString());
    if (isSet(object.unique_stake_bps)) obj.unique_stake_bps = BigInt(object.unique_stake_bps.toString());
    if (isSet(object.security_score_bps))
      obj.security_score_bps = BigInt(object.security_score_bps.toString());
    return obj;
  },
  toJSON(message: ConsensusState): unknown {
    const obj: any = {};
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.ibc_state_root !== undefined &&
      (obj.ibc_state_root = base64FromBytes(
        message.ibc_state_root !== undefined ? message.ibc_state_root : new Uint8Array(),
      ));
    message.accepted_block_hash !== undefined && (obj.accepted_block_hash = message.accepted_block_hash);
    message.accepted_epoch !== undefined &&
      (obj.accepted_epoch = (message.accepted_epoch || BigInt(0)).toString());
    message.unique_pools_count !== undefined &&
      (obj.unique_pools_count = (message.unique_pools_count || BigInt(0)).toString());
    message.unique_stake_bps !== undefined &&
      (obj.unique_stake_bps = (message.unique_stake_bps || BigInt(0)).toString());
    message.security_score_bps !== undefined &&
      (obj.security_score_bps = (message.security_score_bps || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ConsensusState>, I>>(object: I): ConsensusState {
    const message = createBaseConsensusState();
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    message.ibc_state_root = object.ibc_state_root ?? new Uint8Array();
    message.accepted_block_hash = object.accepted_block_hash ?? "";
    if (object.accepted_epoch !== undefined && object.accepted_epoch !== null) {
      message.accepted_epoch = BigInt(object.accepted_epoch.toString());
    }
    if (object.unique_pools_count !== undefined && object.unique_pools_count !== null) {
      message.unique_pools_count = BigInt(object.unique_pools_count.toString());
    }
    if (object.unique_stake_bps !== undefined && object.unique_stake_bps !== null) {
      message.unique_stake_bps = BigInt(object.unique_stake_bps.toString());
    }
    if (object.security_score_bps !== undefined && object.security_score_bps !== null) {
      message.security_score_bps = BigInt(object.security_score_bps.toString());
    }
    return message;
  },
};
function createBaseMisbehaviour(): Misbehaviour {
  return {
    client_id: "",
    stability_header1: undefined,
    stability_header2: undefined,
  };
}
export const Misbehaviour = {
  typeUrl: "/ibc.lightclients.stability.v1.Misbehaviour",
  encode(message: Misbehaviour, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.stability_header1 !== undefined) {
      StabilityHeader.encode(message.stability_header1, writer.uint32(18).fork()).ldelim();
    }
    if (message.stability_header2 !== undefined) {
      StabilityHeader.encode(message.stability_header2, writer.uint32(26).fork()).ldelim();
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
          message.stability_header1 = StabilityHeader.decode(reader, reader.uint32());
          break;
        case 3:
          message.stability_header2 = StabilityHeader.decode(reader, reader.uint32());
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
    if (isSet(object.stability_header1))
      obj.stability_header1 = StabilityHeader.fromJSON(object.stability_header1);
    if (isSet(object.stability_header2))
      obj.stability_header2 = StabilityHeader.fromJSON(object.stability_header2);
    return obj;
  },
  toJSON(message: Misbehaviour): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.stability_header1 !== undefined &&
      (obj.stability_header1 = message.stability_header1
        ? StabilityHeader.toJSON(message.stability_header1)
        : undefined);
    message.stability_header2 !== undefined &&
      (obj.stability_header2 = message.stability_header2
        ? StabilityHeader.toJSON(message.stability_header2)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Misbehaviour>, I>>(object: I): Misbehaviour {
    const message = createBaseMisbehaviour();
    message.client_id = object.client_id ?? "";
    if (object.stability_header1 !== undefined && object.stability_header1 !== null) {
      message.stability_header1 = StabilityHeader.fromPartial(object.stability_header1);
    }
    if (object.stability_header2 !== undefined && object.stability_header2 !== null) {
      message.stability_header2 = StabilityHeader.fromPartial(object.stability_header2);
    }
    return message;
  },
};
function createBaseStabilityBlock(): StabilityBlock {
  return {
    height: undefined,
    slot: BigInt(0),
    hash: "",
    prev_hash: "",
    epoch: BigInt(0),
    timestamp: BigInt(0),
    slot_leader: "",
    block_cbor: new Uint8Array(),
  };
}
export const StabilityBlock = {
  typeUrl: "/ibc.lightclients.stability.v1.StabilityBlock",
  encode(message: StabilityBlock, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
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
    if (message.epoch !== BigInt(0)) {
      writer.uint32(40).uint64(message.epoch);
    }
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(48).uint64(message.timestamp);
    }
    if (message.slot_leader !== "") {
      writer.uint32(58).string(message.slot_leader);
    }
    if (message.block_cbor.length !== 0) {
      writer.uint32(74).bytes(message.block_cbor);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): StabilityBlock {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStabilityBlock();
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
          message.epoch = reader.uint64();
          break;
        case 6:
          message.timestamp = reader.uint64();
          break;
        case 7:
          message.slot_leader = reader.string();
          break;
        case 9:
          message.block_cbor = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): StabilityBlock {
    const obj = createBaseStabilityBlock();
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    if (isSet(object.slot)) obj.slot = BigInt(object.slot.toString());
    if (isSet(object.hash)) obj.hash = String(object.hash);
    if (isSet(object.prev_hash)) obj.prev_hash = String(object.prev_hash);
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    if (isSet(object.slot_leader)) obj.slot_leader = String(object.slot_leader);
    if (isSet(object.block_cbor)) obj.block_cbor = bytesFromBase64(object.block_cbor);
    return obj;
  },
  toJSON(message: StabilityBlock): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    message.slot !== undefined && (obj.slot = (message.slot || BigInt(0)).toString());
    message.hash !== undefined && (obj.hash = message.hash);
    message.prev_hash !== undefined && (obj.prev_hash = message.prev_hash);
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.slot_leader !== undefined && (obj.slot_leader = message.slot_leader);
    message.block_cbor !== undefined &&
      (obj.block_cbor = base64FromBytes(
        message.block_cbor !== undefined ? message.block_cbor : new Uint8Array(),
      ));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<StabilityBlock>, I>>(object: I): StabilityBlock {
    const message = createBaseStabilityBlock();
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    if (object.slot !== undefined && object.slot !== null) {
      message.slot = BigInt(object.slot.toString());
    }
    message.hash = object.hash ?? "";
    message.prev_hash = object.prev_hash ?? "";
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    message.slot_leader = object.slot_leader ?? "";
    message.block_cbor = object.block_cbor ?? new Uint8Array();
    return message;
  },
};
function createBaseStabilityHeader(): StabilityHeader {
  return {
    trusted_height: undefined,
    anchor_block: undefined,
    descendant_blocks: [],
    host_state_tx_hash: "",
    host_state_tx_body_cbor: new Uint8Array(),
    host_state_tx_output_index: 0,
    unique_pools_count: BigInt(0),
    unique_stake_bps: BigInt(0),
    security_score_bps: BigInt(0),
    bridge_blocks: [],
  };
}
export const StabilityHeader = {
  typeUrl: "/ibc.lightclients.stability.v1.StabilityHeader",
  encode(message: StabilityHeader, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.trusted_height !== undefined) {
      Height.encode(message.trusted_height, writer.uint32(10).fork()).ldelim();
    }
    if (message.anchor_block !== undefined) {
      StabilityBlock.encode(message.anchor_block, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.descendant_blocks) {
      StabilityBlock.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    if (message.host_state_tx_hash !== "") {
      writer.uint32(34).string(message.host_state_tx_hash);
    }
    if (message.host_state_tx_body_cbor.length !== 0) {
      writer.uint32(42).bytes(message.host_state_tx_body_cbor);
    }
    if (message.host_state_tx_output_index !== 0) {
      writer.uint32(48).uint32(message.host_state_tx_output_index);
    }
    if (message.unique_pools_count !== BigInt(0)) {
      writer.uint32(56).uint64(message.unique_pools_count);
    }
    if (message.unique_stake_bps !== BigInt(0)) {
      writer.uint32(64).uint64(message.unique_stake_bps);
    }
    if (message.security_score_bps !== BigInt(0)) {
      writer.uint32(72).uint64(message.security_score_bps);
    }
    for (const v of message.bridge_blocks) {
      StabilityBlock.encode(v!, writer.uint32(82).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): StabilityHeader {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStabilityHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.trusted_height = Height.decode(reader, reader.uint32());
          break;
        case 2:
          message.anchor_block = StabilityBlock.decode(reader, reader.uint32());
          break;
        case 3:
          message.descendant_blocks.push(StabilityBlock.decode(reader, reader.uint32()));
          break;
        case 4:
          message.host_state_tx_hash = reader.string();
          break;
        case 5:
          message.host_state_tx_body_cbor = reader.bytes();
          break;
        case 6:
          message.host_state_tx_output_index = reader.uint32();
          break;
        case 7:
          message.unique_pools_count = reader.uint64();
          break;
        case 8:
          message.unique_stake_bps = reader.uint64();
          break;
        case 9:
          message.security_score_bps = reader.uint64();
          break;
        case 10:
          message.bridge_blocks.push(StabilityBlock.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): StabilityHeader {
    const obj = createBaseStabilityHeader();
    if (isSet(object.trusted_height)) obj.trusted_height = Height.fromJSON(object.trusted_height);
    if (isSet(object.anchor_block)) obj.anchor_block = StabilityBlock.fromJSON(object.anchor_block);
    if (Array.isArray(object?.descendant_blocks))
      obj.descendant_blocks = object.descendant_blocks.map((e: any) => StabilityBlock.fromJSON(e));
    if (isSet(object.host_state_tx_hash)) obj.host_state_tx_hash = String(object.host_state_tx_hash);
    if (isSet(object.host_state_tx_body_cbor))
      obj.host_state_tx_body_cbor = bytesFromBase64(object.host_state_tx_body_cbor);
    if (isSet(object.host_state_tx_output_index))
      obj.host_state_tx_output_index = Number(object.host_state_tx_output_index);
    if (isSet(object.unique_pools_count))
      obj.unique_pools_count = BigInt(object.unique_pools_count.toString());
    if (isSet(object.unique_stake_bps)) obj.unique_stake_bps = BigInt(object.unique_stake_bps.toString());
    if (isSet(object.security_score_bps))
      obj.security_score_bps = BigInt(object.security_score_bps.toString());
    if (Array.isArray(object?.bridge_blocks))
      obj.bridge_blocks = object.bridge_blocks.map((e: any) => StabilityBlock.fromJSON(e));
    return obj;
  },
  toJSON(message: StabilityHeader): unknown {
    const obj: any = {};
    message.trusted_height !== undefined &&
      (obj.trusted_height = message.trusted_height ? Height.toJSON(message.trusted_height) : undefined);
    message.anchor_block !== undefined &&
      (obj.anchor_block = message.anchor_block ? StabilityBlock.toJSON(message.anchor_block) : undefined);
    if (message.descendant_blocks) {
      obj.descendant_blocks = message.descendant_blocks.map((e) =>
        e ? StabilityBlock.toJSON(e) : undefined,
      );
    } else {
      obj.descendant_blocks = [];
    }
    message.host_state_tx_hash !== undefined && (obj.host_state_tx_hash = message.host_state_tx_hash);
    message.host_state_tx_body_cbor !== undefined &&
      (obj.host_state_tx_body_cbor = base64FromBytes(
        message.host_state_tx_body_cbor !== undefined ? message.host_state_tx_body_cbor : new Uint8Array(),
      ));
    message.host_state_tx_output_index !== undefined &&
      (obj.host_state_tx_output_index = Math.round(message.host_state_tx_output_index));
    message.unique_pools_count !== undefined &&
      (obj.unique_pools_count = (message.unique_pools_count || BigInt(0)).toString());
    message.unique_stake_bps !== undefined &&
      (obj.unique_stake_bps = (message.unique_stake_bps || BigInt(0)).toString());
    message.security_score_bps !== undefined &&
      (obj.security_score_bps = (message.security_score_bps || BigInt(0)).toString());
    if (message.bridge_blocks) {
      obj.bridge_blocks = message.bridge_blocks.map((e) => (e ? StabilityBlock.toJSON(e) : undefined));
    } else {
      obj.bridge_blocks = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<StabilityHeader>, I>>(object: I): StabilityHeader {
    const message = createBaseStabilityHeader();
    if (object.trusted_height !== undefined && object.trusted_height !== null) {
      message.trusted_height = Height.fromPartial(object.trusted_height);
    }
    if (object.anchor_block !== undefined && object.anchor_block !== null) {
      message.anchor_block = StabilityBlock.fromPartial(object.anchor_block);
    }
    message.descendant_blocks = object.descendant_blocks?.map((e) => StabilityBlock.fromPartial(e)) || [];
    message.host_state_tx_hash = object.host_state_tx_hash ?? "";
    message.host_state_tx_body_cbor = object.host_state_tx_body_cbor ?? new Uint8Array();
    message.host_state_tx_output_index = object.host_state_tx_output_index ?? 0;
    if (object.unique_pools_count !== undefined && object.unique_pools_count !== null) {
      message.unique_pools_count = BigInt(object.unique_pools_count.toString());
    }
    if (object.unique_stake_bps !== undefined && object.unique_stake_bps !== null) {
      message.unique_stake_bps = BigInt(object.unique_stake_bps.toString());
    }
    if (object.security_score_bps !== undefined && object.security_score_bps !== null) {
      message.security_score_bps = BigInt(object.security_score_bps.toString());
    }
    message.bridge_blocks = object.bridge_blocks?.map((e) => StabilityBlock.fromPartial(e)) || [];
    return message;
  },
};
