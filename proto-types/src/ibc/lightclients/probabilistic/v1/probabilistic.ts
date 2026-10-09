/* eslint-disable */
import { Duration } from "../../../../google/protobuf/duration";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../../helpers";
export const protobufPackage = "ibc.lightclients.probabilistic.v1";
/**
 * @name Height
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.Height
 */
export interface Height {
  revision_number: bigint;
  revision_height: bigint;
}
/**
 * @name StakeDistributionEntry
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.StakeDistributionEntry
 */
export interface StakeDistributionEntry {
  pool_id: string;
  stake: bigint;
  /**
   * Compatibility fields. Must match the independent effective registry.
   */
  vrf_key_hash: Uint8Array;
  first_registration_slot: bigint;
  /**
   * Exact relative active stake used for Praos leader eligibility. The
   * existing stake field remains the weight used by settlement scoring.
   */
  relative_stake_numerator: bigint;
  relative_stake_denominator: bigint;
}
/**
 * During updates only stake allocation supplies independently claimed data.
 * Every other field is compared with values derived from accepted state or
 * stored network configuration. A mismatch rejects the update. The starting
 * state and network configuration require authenticated or explicitly trusted
 * bootstrap.
 * @name EpochContext
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.EpochContext
 */
export interface EpochContext {
  /**
   * Must equal the epoch derived from the signed header slot and stored schedule.
   */
  epoch: bigint;
  /**
   * Identities, VRF hashes and ages must match the independently tracked
   * registry for this epoch. Stake amounts remain under the challenge model.
   */
  stake_distribution: StakeDistributionEntry[];
  /**
   * Must equal the nonce derived from checkpoint history. Header verification
   * uses that locally derived nonce.
   */
  epoch_nonce: Uint8Array;
  /**
   * Must equal ClientState.slots_per_kes_period, fixed at bootstrap.
   */
  slots_per_kes_period: bigint;
  /**
   * Must equal the start slot calculated from the client's stored epoch schedule.
   */
  epoch_start_slot: bigint;
  /**
   * Must equal the exclusive end calculated from that same stored schedule.
   */
  epoch_end_slot_exclusive: bigint;
}
/**
 * @name OperationalCertificateCounter
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.OperationalCertificateCounter
 */
export interface OperationalCertificateCounter {
  pool_id: Uint8Array;
  sequence_number: bigint;
}
/**
 * @name ClientState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ClientState
 */
export interface ClientState {
  chain_id: string;
  latest_height?: Height;
  frozen_height?: Height;
  current_epoch: bigint;
  trusting_period: Duration;
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
  epoch_contexts: EpochContext[];
  /**
   * The latest authenticated Cardano block, which may be newer than
   * latest_height when rootless checkpoint updates are used for catch-up.
   */
  latest_checkpoint_height?: Height;
  latest_checkpoint_block_hash: string;
  latest_checkpoint_epoch: bigint;
  max_kes_evolutions: bigint;
  /**
   * Operational-certificate counters at latest_checkpoint_height.
   */
  latest_checkpoint_operational_certificate_counters: OperationalCertificateCounter[];
  /**
   * Oldest height whose counter state can be reconstructed from the current
   * snapshot and the light client's private rollback history.
   */
  operational_certificate_counter_history_start_height?: Height;
  /**
   * Shelley-genesis activeSlotsCoefficient, kept as an exact rational.
   */
  active_slot_coefficient_numerator: bigint;
  active_slot_coefficient_denominator: bigint;
  /**
   * Maximum amount by which an authenticated Cardano block may be ahead of
   * the Cosmos host chain's current block time.
   */
  max_clock_drift: Duration;
  /**
   * Slot and derived Unix-nanosecond timestamp of latest_checkpoint_height.
   * Both are retained because rootless checkpoints do not create an IBC
   * consensus state.
   */
  latest_checkpoint_slot: bigint;
  latest_checkpoint_timestamp: bigint;
  /**
   * Required deployment policy for packet lane identities.
   */
  packet_lane_policy_id: Uint8Array;
  /**
   * Pending epoch roots cannot verify IBC proofs before their deadline.
   * Initialize replaces any caller-supplied values with host-assigned times.
   */
  epoch_context_challenges: EpochContextChallenge[];
  /**
   * Required authenticated running state at latest_checkpoint_height.
   */
  latest_checkpoint_nonce_state?: PraosNonceState;
  /**
   * Established network parameter. Updates cannot redefine this window.
   */
  randomness_stabilisation_window_slots: bigint;
  /**
   * Independently authenticated registration state at the checkpoint.
   */
  latest_checkpoint_pool_registry?: PoolRegistryState;
}
/**
 * Pool identity and VRF binding from the trusted bootstrap or authenticated
 * certificate history. Slot zero is valid for a genesis registration.
 * @name PoolRegistrationBinding
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PoolRegistrationBinding
 */
export interface PoolRegistrationBinding {
  pool_id: string;
  vrf_key_hash: Uint8Array;
  first_registration_slot: bigint;
}
/**
 * The current registration state, separate from frozen election snapshots.
 * Retired records retain their authenticated registration age.
 * @name PoolRegistrationRecord
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PoolRegistrationRecord
 */
export interface PoolRegistrationRecord {
  registration?: PoolRegistrationBinding;
  registered: boolean;
  pending_vrf_key_hash: Uint8Array;
  pending_effective_epoch: bigint;
  /**
   * Zero means no scheduled retirement.
   */
  retirement_epoch: bigint;
}
/**
 * Registration projection of Cardano's current pool state and mark/set
 * snapshots at the associated checkpoint. This contains no stake amounts.
 * Bootstrap must establish all three views independently of the epoch table.
 * @name PoolRegistryState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PoolRegistryState
 */
export interface PoolRegistryState {
  epoch: bigint;
  pools: PoolRegistrationRecord[];
  mark: PoolRegistrationBinding[];
  effective: PoolRegistrationBinding[];
}
/**
 * Babbage/Conway Praos state after applying the checkpoint header.
 * Empty running nonce bytes represent Cardano's NeutralNonce identity. A
 * missing message is unavailable state and must never be filled with defaults.
 * @name PraosNonceState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PraosNonceState
 */
export interface PraosNonceState {
  epoch_nonce: Uint8Array;
  evolving_nonce: Uint8Array;
  candidate_nonce: Uint8Array;
  /**
   * Derived from the previous-block hash in the last applied header,
   * not from that header's own hash.
   */
  last_applied_block_nonce: Uint8Array;
  last_epoch_block_nonce: Uint8Array;
}
/**
 * Host-chain timestamps assigned by the verifier, never by an update header.
 * @name EpochContextChallenge
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.EpochContextChallenge
 */
export interface EpochContextChallenge {
  epoch: bigint;
  usable_after_unix_ns: bigint;
}
/**
 * @name ConsensusState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ConsensusState
 */
export interface ConsensusState {
  timestamp: bigint;
  ibc_state_root: Uint8Array;
  accepted_block_hash: string;
  accepted_epoch: bigint;
  unique_pools_count: bigint;
  unique_stake_bps: bigint;
  security_score_bps: bigint;
  /**
   * Canonical CBOR snapshot of live host and lane outputs at this height.
   */
  packet_state_snapshot: Uint8Array;
  /**
   * Running nonce values at this accepted block, excluding descendants.
   */
  nonce_state?: PraosNonceState;
  /**
   * Registration state at this historical accepted block.
   */
  pool_registry?: PoolRegistryState;
}
/**
 * @name Misbehaviour
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.Misbehaviour
 */
export interface Misbehaviour {
  /**
   * @deprecated
   */
  client_id: string;
  probabilistic_header1?: ProbabilisticHeader;
  probabilistic_header2?: ProbabilisticHeader;
}
/**
 * @name ProbabilisticBlock
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ProbabilisticBlock
 */
export interface ProbabilisticBlock {
  height?: Height;
  slot: bigint;
  hash: string;
  epoch: bigint;
  timestamp: bigint;
  /**
   * Full block CBOR. A root-bearing anchor requires this representation so
   * its HostState transaction can be authenticated against the signed body.
   */
  block_cbor: Uint8Array;
  /**
   * Raw Cardano header CBOR. This compact representation is sufficient for
   * bridge blocks, descendant blocks, and rootless checkpoint anchors.
   */
  header_cbor: Uint8Array;
}
/**
 * @name ProbabilisticHeader
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ProbabilisticHeader
 */
export interface ProbabilisticHeader {
  trusted_height?: Height;
  anchor_block?: ProbabilisticBlock;
  descendant_blocks: ProbabilisticBlock[];
  host_state_tx_hash: string;
  host_state_tx_output_index: number;
  bridge_blocks: ProbabilisticBlock[];
  new_epoch_context?: EpochContext;
  /**
   * Checkpoints authenticate Cardano chain progression without creating an
   * IBC consensus state or renewing the trusting period.
   */
  is_checkpoint: boolean;
}
function createBaseHeight(): Height {
  return {
    revision_number: BigInt(0),
    revision_height: BigInt(0),
  };
}
/**
 * @name Height
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.Height
 */
export const Height = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.Height",
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
function createBaseStakeDistributionEntry(): StakeDistributionEntry {
  return {
    pool_id: "",
    stake: BigInt(0),
    vrf_key_hash: new Uint8Array(),
    first_registration_slot: BigInt(0),
    relative_stake_numerator: BigInt(0),
    relative_stake_denominator: BigInt(0),
  };
}
/**
 * @name StakeDistributionEntry
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.StakeDistributionEntry
 */
export const StakeDistributionEntry = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.StakeDistributionEntry",
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
    if (message.first_registration_slot !== BigInt(0)) {
      writer.uint32(32).uint64(message.first_registration_slot);
    }
    if (message.relative_stake_numerator !== BigInt(0)) {
      writer.uint32(40).uint64(message.relative_stake_numerator);
    }
    if (message.relative_stake_denominator !== BigInt(0)) {
      writer.uint32(48).uint64(message.relative_stake_denominator);
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
        case 4:
          message.first_registration_slot = reader.uint64();
          break;
        case 5:
          message.relative_stake_numerator = reader.uint64();
          break;
        case 6:
          message.relative_stake_denominator = reader.uint64();
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
    if (isSet(object.first_registration_slot))
      obj.first_registration_slot = BigInt(object.first_registration_slot.toString());
    if (isSet(object.relative_stake_numerator))
      obj.relative_stake_numerator = BigInt(object.relative_stake_numerator.toString());
    if (isSet(object.relative_stake_denominator))
      obj.relative_stake_denominator = BigInt(object.relative_stake_denominator.toString());
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
    message.first_registration_slot !== undefined &&
      (obj.first_registration_slot = (message.first_registration_slot || BigInt(0)).toString());
    message.relative_stake_numerator !== undefined &&
      (obj.relative_stake_numerator = (message.relative_stake_numerator || BigInt(0)).toString());
    message.relative_stake_denominator !== undefined &&
      (obj.relative_stake_denominator = (message.relative_stake_denominator || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<StakeDistributionEntry>, I>>(object: I): StakeDistributionEntry {
    const message = createBaseStakeDistributionEntry();
    message.pool_id = object.pool_id ?? "";
    if (object.stake !== undefined && object.stake !== null) {
      message.stake = BigInt(object.stake.toString());
    }
    message.vrf_key_hash = object.vrf_key_hash ?? new Uint8Array();
    if (object.first_registration_slot !== undefined && object.first_registration_slot !== null) {
      message.first_registration_slot = BigInt(object.first_registration_slot.toString());
    }
    if (object.relative_stake_numerator !== undefined && object.relative_stake_numerator !== null) {
      message.relative_stake_numerator = BigInt(object.relative_stake_numerator.toString());
    }
    if (object.relative_stake_denominator !== undefined && object.relative_stake_denominator !== null) {
      message.relative_stake_denominator = BigInt(object.relative_stake_denominator.toString());
    }
    return message;
  },
};
function createBaseEpochContext(): EpochContext {
  return {
    epoch: BigInt(0),
    stake_distribution: [],
    epoch_nonce: new Uint8Array(),
    slots_per_kes_period: BigInt(0),
    epoch_start_slot: BigInt(0),
    epoch_end_slot_exclusive: BigInt(0),
  };
}
/**
 * During updates only stake allocation supplies independently claimed data.
 * Every other field is compared with values derived from accepted state or
 * stored network configuration. A mismatch rejects the update. The starting
 * state and network configuration require authenticated or explicitly trusted
 * bootstrap.
 * @name EpochContext
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.EpochContext
 */
export const EpochContext = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.EpochContext",
  encode(message: EpochContext, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.epoch !== BigInt(0)) {
      writer.uint32(8).uint64(message.epoch);
    }
    for (const v of message.stake_distribution) {
      StakeDistributionEntry.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    if (message.epoch_nonce.length !== 0) {
      writer.uint32(26).bytes(message.epoch_nonce);
    }
    if (message.slots_per_kes_period !== BigInt(0)) {
      writer.uint32(32).uint64(message.slots_per_kes_period);
    }
    if (message.epoch_start_slot !== BigInt(0)) {
      writer.uint32(40).uint64(message.epoch_start_slot);
    }
    if (message.epoch_end_slot_exclusive !== BigInt(0)) {
      writer.uint32(48).uint64(message.epoch_end_slot_exclusive);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): EpochContext {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEpochContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.epoch = reader.uint64();
          break;
        case 2:
          message.stake_distribution.push(StakeDistributionEntry.decode(reader, reader.uint32()));
          break;
        case 3:
          message.epoch_nonce = reader.bytes();
          break;
        case 4:
          message.slots_per_kes_period = reader.uint64();
          break;
        case 5:
          message.epoch_start_slot = reader.uint64();
          break;
        case 6:
          message.epoch_end_slot_exclusive = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): EpochContext {
    const obj = createBaseEpochContext();
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (Array.isArray(object?.stake_distribution))
      obj.stake_distribution = object.stake_distribution.map((e: any) => StakeDistributionEntry.fromJSON(e));
    if (isSet(object.epoch_nonce)) obj.epoch_nonce = bytesFromBase64(object.epoch_nonce);
    if (isSet(object.slots_per_kes_period))
      obj.slots_per_kes_period = BigInt(object.slots_per_kes_period.toString());
    if (isSet(object.epoch_start_slot)) obj.epoch_start_slot = BigInt(object.epoch_start_slot.toString());
    if (isSet(object.epoch_end_slot_exclusive))
      obj.epoch_end_slot_exclusive = BigInt(object.epoch_end_slot_exclusive.toString());
    return obj;
  },
  toJSON(message: EpochContext): unknown {
    const obj: any = {};
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    if (message.stake_distribution) {
      obj.stake_distribution = message.stake_distribution.map((e) =>
        e ? StakeDistributionEntry.toJSON(e) : undefined,
      );
    } else {
      obj.stake_distribution = [];
    }
    message.epoch_nonce !== undefined &&
      (obj.epoch_nonce = base64FromBytes(
        message.epoch_nonce !== undefined ? message.epoch_nonce : new Uint8Array(),
      ));
    message.slots_per_kes_period !== undefined &&
      (obj.slots_per_kes_period = (message.slots_per_kes_period || BigInt(0)).toString());
    message.epoch_start_slot !== undefined &&
      (obj.epoch_start_slot = (message.epoch_start_slot || BigInt(0)).toString());
    message.epoch_end_slot_exclusive !== undefined &&
      (obj.epoch_end_slot_exclusive = (message.epoch_end_slot_exclusive || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<EpochContext>, I>>(object: I): EpochContext {
    const message = createBaseEpochContext();
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    message.stake_distribution =
      object.stake_distribution?.map((e) => StakeDistributionEntry.fromPartial(e)) || [];
    message.epoch_nonce = object.epoch_nonce ?? new Uint8Array();
    if (object.slots_per_kes_period !== undefined && object.slots_per_kes_period !== null) {
      message.slots_per_kes_period = BigInt(object.slots_per_kes_period.toString());
    }
    if (object.epoch_start_slot !== undefined && object.epoch_start_slot !== null) {
      message.epoch_start_slot = BigInt(object.epoch_start_slot.toString());
    }
    if (object.epoch_end_slot_exclusive !== undefined && object.epoch_end_slot_exclusive !== null) {
      message.epoch_end_slot_exclusive = BigInt(object.epoch_end_slot_exclusive.toString());
    }
    return message;
  },
};
function createBaseOperationalCertificateCounter(): OperationalCertificateCounter {
  return {
    pool_id: new Uint8Array(),
    sequence_number: BigInt(0),
  };
}
/**
 * @name OperationalCertificateCounter
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.OperationalCertificateCounter
 */
export const OperationalCertificateCounter = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.OperationalCertificateCounter",
  encode(message: OperationalCertificateCounter, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pool_id.length !== 0) {
      writer.uint32(10).bytes(message.pool_id);
    }
    if (message.sequence_number !== BigInt(0)) {
      writer.uint32(16).uint64(message.sequence_number);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): OperationalCertificateCounter {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseOperationalCertificateCounter();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pool_id = reader.bytes();
          break;
        case 2:
          message.sequence_number = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): OperationalCertificateCounter {
    const obj = createBaseOperationalCertificateCounter();
    if (isSet(object.pool_id)) obj.pool_id = bytesFromBase64(object.pool_id);
    if (isSet(object.sequence_number)) obj.sequence_number = BigInt(object.sequence_number.toString());
    return obj;
  },
  toJSON(message: OperationalCertificateCounter): unknown {
    const obj: any = {};
    message.pool_id !== undefined &&
      (obj.pool_id = base64FromBytes(message.pool_id !== undefined ? message.pool_id : new Uint8Array()));
    message.sequence_number !== undefined &&
      (obj.sequence_number = (message.sequence_number || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<OperationalCertificateCounter>, I>>(
    object: I,
  ): OperationalCertificateCounter {
    const message = createBaseOperationalCertificateCounter();
    message.pool_id = object.pool_id ?? new Uint8Array();
    if (object.sequence_number !== undefined && object.sequence_number !== null) {
      message.sequence_number = BigInt(object.sequence_number.toString());
    }
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
    epoch_contexts: [],
    latest_checkpoint_height: undefined,
    latest_checkpoint_block_hash: "",
    latest_checkpoint_epoch: BigInt(0),
    max_kes_evolutions: BigInt(0),
    latest_checkpoint_operational_certificate_counters: [],
    operational_certificate_counter_history_start_height: undefined,
    active_slot_coefficient_numerator: BigInt(0),
    active_slot_coefficient_denominator: BigInt(0),
    max_clock_drift: Duration.fromPartial({}),
    latest_checkpoint_slot: BigInt(0),
    latest_checkpoint_timestamp: BigInt(0),
    packet_lane_policy_id: new Uint8Array(),
    epoch_context_challenges: [],
    latest_checkpoint_nonce_state: undefined,
    randomness_stabilisation_window_slots: BigInt(0),
    latest_checkpoint_pool_registry: undefined,
  };
}
/**
 * @name ClientState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ClientState
 */
export const ClientState = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.ClientState",
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
    for (const v of message.epoch_contexts) {
      EpochContext.encode(v!, writer.uint32(138).fork()).ldelim();
    }
    if (message.latest_checkpoint_height !== undefined) {
      Height.encode(message.latest_checkpoint_height, writer.uint32(154).fork()).ldelim();
    }
    if (message.latest_checkpoint_block_hash !== "") {
      writer.uint32(162).string(message.latest_checkpoint_block_hash);
    }
    if (message.latest_checkpoint_epoch !== BigInt(0)) {
      writer.uint32(168).uint64(message.latest_checkpoint_epoch);
    }
    if (message.max_kes_evolutions !== BigInt(0)) {
      writer.uint32(176).uint64(message.max_kes_evolutions);
    }
    for (const v of message.latest_checkpoint_operational_certificate_counters) {
      OperationalCertificateCounter.encode(v!, writer.uint32(186).fork()).ldelim();
    }
    if (message.operational_certificate_counter_history_start_height !== undefined) {
      Height.encode(
        message.operational_certificate_counter_history_start_height,
        writer.uint32(194).fork(),
      ).ldelim();
    }
    if (message.active_slot_coefficient_numerator !== BigInt(0)) {
      writer.uint32(200).uint64(message.active_slot_coefficient_numerator);
    }
    if (message.active_slot_coefficient_denominator !== BigInt(0)) {
      writer.uint32(208).uint64(message.active_slot_coefficient_denominator);
    }
    if (message.max_clock_drift !== undefined) {
      Duration.encode(message.max_clock_drift, writer.uint32(218).fork()).ldelim();
    }
    if (message.latest_checkpoint_slot !== BigInt(0)) {
      writer.uint32(224).uint64(message.latest_checkpoint_slot);
    }
    if (message.latest_checkpoint_timestamp !== BigInt(0)) {
      writer.uint32(232).uint64(message.latest_checkpoint_timestamp);
    }
    if (message.packet_lane_policy_id.length !== 0) {
      writer.uint32(242).bytes(message.packet_lane_policy_id);
    }
    for (const v of message.epoch_context_challenges) {
      EpochContextChallenge.encode(v!, writer.uint32(250).fork()).ldelim();
    }
    if (message.latest_checkpoint_nonce_state !== undefined) {
      PraosNonceState.encode(message.latest_checkpoint_nonce_state, writer.uint32(258).fork()).ldelim();
    }
    if (message.randomness_stabilisation_window_slots !== BigInt(0)) {
      writer.uint32(264).uint64(message.randomness_stabilisation_window_slots);
    }
    if (message.latest_checkpoint_pool_registry !== undefined) {
      PoolRegistryState.encode(message.latest_checkpoint_pool_registry, writer.uint32(274).fork()).ldelim();
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
        case 17:
          message.epoch_contexts.push(EpochContext.decode(reader, reader.uint32()));
          break;
        case 19:
          message.latest_checkpoint_height = Height.decode(reader, reader.uint32());
          break;
        case 20:
          message.latest_checkpoint_block_hash = reader.string();
          break;
        case 21:
          message.latest_checkpoint_epoch = reader.uint64();
          break;
        case 22:
          message.max_kes_evolutions = reader.uint64();
          break;
        case 23:
          message.latest_checkpoint_operational_certificate_counters.push(
            OperationalCertificateCounter.decode(reader, reader.uint32()),
          );
          break;
        case 24:
          message.operational_certificate_counter_history_start_height = Height.decode(
            reader,
            reader.uint32(),
          );
          break;
        case 25:
          message.active_slot_coefficient_numerator = reader.uint64();
          break;
        case 26:
          message.active_slot_coefficient_denominator = reader.uint64();
          break;
        case 27:
          message.max_clock_drift = Duration.decode(reader, reader.uint32());
          break;
        case 28:
          message.latest_checkpoint_slot = reader.uint64();
          break;
        case 29:
          message.latest_checkpoint_timestamp = reader.uint64();
          break;
        case 30:
          message.packet_lane_policy_id = reader.bytes();
          break;
        case 31:
          message.epoch_context_challenges.push(EpochContextChallenge.decode(reader, reader.uint32()));
          break;
        case 32:
          message.latest_checkpoint_nonce_state = PraosNonceState.decode(reader, reader.uint32());
          break;
        case 33:
          message.randomness_stabilisation_window_slots = reader.uint64();
          break;
        case 34:
          message.latest_checkpoint_pool_registry = PoolRegistryState.decode(reader, reader.uint32());
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
    if (Array.isArray(object?.epoch_contexts))
      obj.epoch_contexts = object.epoch_contexts.map((e: any) => EpochContext.fromJSON(e));
    if (isSet(object.latest_checkpoint_height))
      obj.latest_checkpoint_height = Height.fromJSON(object.latest_checkpoint_height);
    if (isSet(object.latest_checkpoint_block_hash))
      obj.latest_checkpoint_block_hash = String(object.latest_checkpoint_block_hash);
    if (isSet(object.latest_checkpoint_epoch))
      obj.latest_checkpoint_epoch = BigInt(object.latest_checkpoint_epoch.toString());
    if (isSet(object.max_kes_evolutions))
      obj.max_kes_evolutions = BigInt(object.max_kes_evolutions.toString());
    if (Array.isArray(object?.latest_checkpoint_operational_certificate_counters))
      obj.latest_checkpoint_operational_certificate_counters =
        object.latest_checkpoint_operational_certificate_counters.map((e: any) =>
          OperationalCertificateCounter.fromJSON(e),
        );
    if (isSet(object.operational_certificate_counter_history_start_height))
      obj.operational_certificate_counter_history_start_height = Height.fromJSON(
        object.operational_certificate_counter_history_start_height,
      );
    if (isSet(object.active_slot_coefficient_numerator))
      obj.active_slot_coefficient_numerator = BigInt(object.active_slot_coefficient_numerator.toString());
    if (isSet(object.active_slot_coefficient_denominator))
      obj.active_slot_coefficient_denominator = BigInt(object.active_slot_coefficient_denominator.toString());
    if (isSet(object.max_clock_drift)) obj.max_clock_drift = Duration.fromJSON(object.max_clock_drift);
    if (isSet(object.latest_checkpoint_slot))
      obj.latest_checkpoint_slot = BigInt(object.latest_checkpoint_slot.toString());
    if (isSet(object.latest_checkpoint_timestamp))
      obj.latest_checkpoint_timestamp = BigInt(object.latest_checkpoint_timestamp.toString());
    if (isSet(object.packet_lane_policy_id))
      obj.packet_lane_policy_id = bytesFromBase64(object.packet_lane_policy_id);
    if (Array.isArray(object?.epoch_context_challenges))
      obj.epoch_context_challenges = object.epoch_context_challenges.map((e: any) =>
        EpochContextChallenge.fromJSON(e),
      );
    if (isSet(object.latest_checkpoint_nonce_state))
      obj.latest_checkpoint_nonce_state = PraosNonceState.fromJSON(object.latest_checkpoint_nonce_state);
    if (isSet(object.randomness_stabilisation_window_slots))
      obj.randomness_stabilisation_window_slots = BigInt(
        object.randomness_stabilisation_window_slots.toString(),
      );
    if (isSet(object.latest_checkpoint_pool_registry))
      obj.latest_checkpoint_pool_registry = PoolRegistryState.fromJSON(
        object.latest_checkpoint_pool_registry,
      );
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
    if (message.epoch_contexts) {
      obj.epoch_contexts = message.epoch_contexts.map((e) => (e ? EpochContext.toJSON(e) : undefined));
    } else {
      obj.epoch_contexts = [];
    }
    message.latest_checkpoint_height !== undefined &&
      (obj.latest_checkpoint_height = message.latest_checkpoint_height
        ? Height.toJSON(message.latest_checkpoint_height)
        : undefined);
    message.latest_checkpoint_block_hash !== undefined &&
      (obj.latest_checkpoint_block_hash = message.latest_checkpoint_block_hash);
    message.latest_checkpoint_epoch !== undefined &&
      (obj.latest_checkpoint_epoch = (message.latest_checkpoint_epoch || BigInt(0)).toString());
    message.max_kes_evolutions !== undefined &&
      (obj.max_kes_evolutions = (message.max_kes_evolutions || BigInt(0)).toString());
    if (message.latest_checkpoint_operational_certificate_counters) {
      obj.latest_checkpoint_operational_certificate_counters =
        message.latest_checkpoint_operational_certificate_counters.map((e) =>
          e ? OperationalCertificateCounter.toJSON(e) : undefined,
        );
    } else {
      obj.latest_checkpoint_operational_certificate_counters = [];
    }
    message.operational_certificate_counter_history_start_height !== undefined &&
      (obj.operational_certificate_counter_history_start_height =
        message.operational_certificate_counter_history_start_height
          ? Height.toJSON(message.operational_certificate_counter_history_start_height)
          : undefined);
    message.active_slot_coefficient_numerator !== undefined &&
      (obj.active_slot_coefficient_numerator = (
        message.active_slot_coefficient_numerator || BigInt(0)
      ).toString());
    message.active_slot_coefficient_denominator !== undefined &&
      (obj.active_slot_coefficient_denominator = (
        message.active_slot_coefficient_denominator || BigInt(0)
      ).toString());
    message.max_clock_drift !== undefined &&
      (obj.max_clock_drift = message.max_clock_drift ? Duration.toJSON(message.max_clock_drift) : undefined);
    message.latest_checkpoint_slot !== undefined &&
      (obj.latest_checkpoint_slot = (message.latest_checkpoint_slot || BigInt(0)).toString());
    message.latest_checkpoint_timestamp !== undefined &&
      (obj.latest_checkpoint_timestamp = (message.latest_checkpoint_timestamp || BigInt(0)).toString());
    message.packet_lane_policy_id !== undefined &&
      (obj.packet_lane_policy_id = base64FromBytes(
        message.packet_lane_policy_id !== undefined ? message.packet_lane_policy_id : new Uint8Array(),
      ));
    if (message.epoch_context_challenges) {
      obj.epoch_context_challenges = message.epoch_context_challenges.map((e) =>
        e ? EpochContextChallenge.toJSON(e) : undefined,
      );
    } else {
      obj.epoch_context_challenges = [];
    }
    message.latest_checkpoint_nonce_state !== undefined &&
      (obj.latest_checkpoint_nonce_state = message.latest_checkpoint_nonce_state
        ? PraosNonceState.toJSON(message.latest_checkpoint_nonce_state)
        : undefined);
    message.randomness_stabilisation_window_slots !== undefined &&
      (obj.randomness_stabilisation_window_slots = (
        message.randomness_stabilisation_window_slots || BigInt(0)
      ).toString());
    message.latest_checkpoint_pool_registry !== undefined &&
      (obj.latest_checkpoint_pool_registry = message.latest_checkpoint_pool_registry
        ? PoolRegistryState.toJSON(message.latest_checkpoint_pool_registry)
        : undefined);
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
    message.epoch_contexts = object.epoch_contexts?.map((e) => EpochContext.fromPartial(e)) || [];
    if (object.latest_checkpoint_height !== undefined && object.latest_checkpoint_height !== null) {
      message.latest_checkpoint_height = Height.fromPartial(object.latest_checkpoint_height);
    }
    message.latest_checkpoint_block_hash = object.latest_checkpoint_block_hash ?? "";
    if (object.latest_checkpoint_epoch !== undefined && object.latest_checkpoint_epoch !== null) {
      message.latest_checkpoint_epoch = BigInt(object.latest_checkpoint_epoch.toString());
    }
    if (object.max_kes_evolutions !== undefined && object.max_kes_evolutions !== null) {
      message.max_kes_evolutions = BigInt(object.max_kes_evolutions.toString());
    }
    message.latest_checkpoint_operational_certificate_counters =
      object.latest_checkpoint_operational_certificate_counters?.map((e) =>
        OperationalCertificateCounter.fromPartial(e),
      ) || [];
    if (
      object.operational_certificate_counter_history_start_height !== undefined &&
      object.operational_certificate_counter_history_start_height !== null
    ) {
      message.operational_certificate_counter_history_start_height = Height.fromPartial(
        object.operational_certificate_counter_history_start_height,
      );
    }
    if (
      object.active_slot_coefficient_numerator !== undefined &&
      object.active_slot_coefficient_numerator !== null
    ) {
      message.active_slot_coefficient_numerator = BigInt(object.active_slot_coefficient_numerator.toString());
    }
    if (
      object.active_slot_coefficient_denominator !== undefined &&
      object.active_slot_coefficient_denominator !== null
    ) {
      message.active_slot_coefficient_denominator = BigInt(
        object.active_slot_coefficient_denominator.toString(),
      );
    }
    if (object.max_clock_drift !== undefined && object.max_clock_drift !== null) {
      message.max_clock_drift = Duration.fromPartial(object.max_clock_drift);
    }
    if (object.latest_checkpoint_slot !== undefined && object.latest_checkpoint_slot !== null) {
      message.latest_checkpoint_slot = BigInt(object.latest_checkpoint_slot.toString());
    }
    if (object.latest_checkpoint_timestamp !== undefined && object.latest_checkpoint_timestamp !== null) {
      message.latest_checkpoint_timestamp = BigInt(object.latest_checkpoint_timestamp.toString());
    }
    message.packet_lane_policy_id = object.packet_lane_policy_id ?? new Uint8Array();
    message.epoch_context_challenges =
      object.epoch_context_challenges?.map((e) => EpochContextChallenge.fromPartial(e)) || [];
    if (object.latest_checkpoint_nonce_state !== undefined && object.latest_checkpoint_nonce_state !== null) {
      message.latest_checkpoint_nonce_state = PraosNonceState.fromPartial(
        object.latest_checkpoint_nonce_state,
      );
    }
    if (
      object.randomness_stabilisation_window_slots !== undefined &&
      object.randomness_stabilisation_window_slots !== null
    ) {
      message.randomness_stabilisation_window_slots = BigInt(
        object.randomness_stabilisation_window_slots.toString(),
      );
    }
    if (
      object.latest_checkpoint_pool_registry !== undefined &&
      object.latest_checkpoint_pool_registry !== null
    ) {
      message.latest_checkpoint_pool_registry = PoolRegistryState.fromPartial(
        object.latest_checkpoint_pool_registry,
      );
    }
    return message;
  },
};
function createBasePoolRegistrationBinding(): PoolRegistrationBinding {
  return {
    pool_id: "",
    vrf_key_hash: new Uint8Array(),
    first_registration_slot: BigInt(0),
  };
}
/**
 * Pool identity and VRF binding from the trusted bootstrap or authenticated
 * certificate history. Slot zero is valid for a genesis registration.
 * @name PoolRegistrationBinding
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PoolRegistrationBinding
 */
export const PoolRegistrationBinding = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.PoolRegistrationBinding",
  encode(message: PoolRegistrationBinding, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.pool_id !== "") {
      writer.uint32(10).string(message.pool_id);
    }
    if (message.vrf_key_hash.length !== 0) {
      writer.uint32(18).bytes(message.vrf_key_hash);
    }
    if (message.first_registration_slot !== BigInt(0)) {
      writer.uint32(24).uint64(message.first_registration_slot);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PoolRegistrationBinding {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePoolRegistrationBinding();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pool_id = reader.string();
          break;
        case 2:
          message.vrf_key_hash = reader.bytes();
          break;
        case 3:
          message.first_registration_slot = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PoolRegistrationBinding {
    const obj = createBasePoolRegistrationBinding();
    if (isSet(object.pool_id)) obj.pool_id = String(object.pool_id);
    if (isSet(object.vrf_key_hash)) obj.vrf_key_hash = bytesFromBase64(object.vrf_key_hash);
    if (isSet(object.first_registration_slot))
      obj.first_registration_slot = BigInt(object.first_registration_slot.toString());
    return obj;
  },
  toJSON(message: PoolRegistrationBinding): unknown {
    const obj: any = {};
    message.pool_id !== undefined && (obj.pool_id = message.pool_id);
    message.vrf_key_hash !== undefined &&
      (obj.vrf_key_hash = base64FromBytes(
        message.vrf_key_hash !== undefined ? message.vrf_key_hash : new Uint8Array(),
      ));
    message.first_registration_slot !== undefined &&
      (obj.first_registration_slot = (message.first_registration_slot || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PoolRegistrationBinding>, I>>(object: I): PoolRegistrationBinding {
    const message = createBasePoolRegistrationBinding();
    message.pool_id = object.pool_id ?? "";
    message.vrf_key_hash = object.vrf_key_hash ?? new Uint8Array();
    if (object.first_registration_slot !== undefined && object.first_registration_slot !== null) {
      message.first_registration_slot = BigInt(object.first_registration_slot.toString());
    }
    return message;
  },
};
function createBasePoolRegistrationRecord(): PoolRegistrationRecord {
  return {
    registration: undefined,
    registered: false,
    pending_vrf_key_hash: new Uint8Array(),
    pending_effective_epoch: BigInt(0),
    retirement_epoch: BigInt(0),
  };
}
/**
 * The current registration state, separate from frozen election snapshots.
 * Retired records retain their authenticated registration age.
 * @name PoolRegistrationRecord
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PoolRegistrationRecord
 */
export const PoolRegistrationRecord = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.PoolRegistrationRecord",
  encode(message: PoolRegistrationRecord, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.registration !== undefined) {
      PoolRegistrationBinding.encode(message.registration, writer.uint32(10).fork()).ldelim();
    }
    if (message.registered === true) {
      writer.uint32(16).bool(message.registered);
    }
    if (message.pending_vrf_key_hash.length !== 0) {
      writer.uint32(26).bytes(message.pending_vrf_key_hash);
    }
    if (message.pending_effective_epoch !== BigInt(0)) {
      writer.uint32(32).uint64(message.pending_effective_epoch);
    }
    if (message.retirement_epoch !== BigInt(0)) {
      writer.uint32(40).uint64(message.retirement_epoch);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PoolRegistrationRecord {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePoolRegistrationRecord();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.registration = PoolRegistrationBinding.decode(reader, reader.uint32());
          break;
        case 2:
          message.registered = reader.bool();
          break;
        case 3:
          message.pending_vrf_key_hash = reader.bytes();
          break;
        case 4:
          message.pending_effective_epoch = reader.uint64();
          break;
        case 5:
          message.retirement_epoch = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PoolRegistrationRecord {
    const obj = createBasePoolRegistrationRecord();
    if (isSet(object.registration)) obj.registration = PoolRegistrationBinding.fromJSON(object.registration);
    if (isSet(object.registered)) obj.registered = Boolean(object.registered);
    if (isSet(object.pending_vrf_key_hash))
      obj.pending_vrf_key_hash = bytesFromBase64(object.pending_vrf_key_hash);
    if (isSet(object.pending_effective_epoch))
      obj.pending_effective_epoch = BigInt(object.pending_effective_epoch.toString());
    if (isSet(object.retirement_epoch)) obj.retirement_epoch = BigInt(object.retirement_epoch.toString());
    return obj;
  },
  toJSON(message: PoolRegistrationRecord): unknown {
    const obj: any = {};
    message.registration !== undefined &&
      (obj.registration = message.registration
        ? PoolRegistrationBinding.toJSON(message.registration)
        : undefined);
    message.registered !== undefined && (obj.registered = message.registered);
    message.pending_vrf_key_hash !== undefined &&
      (obj.pending_vrf_key_hash = base64FromBytes(
        message.pending_vrf_key_hash !== undefined ? message.pending_vrf_key_hash : new Uint8Array(),
      ));
    message.pending_effective_epoch !== undefined &&
      (obj.pending_effective_epoch = (message.pending_effective_epoch || BigInt(0)).toString());
    message.retirement_epoch !== undefined &&
      (obj.retirement_epoch = (message.retirement_epoch || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PoolRegistrationRecord>, I>>(object: I): PoolRegistrationRecord {
    const message = createBasePoolRegistrationRecord();
    if (object.registration !== undefined && object.registration !== null) {
      message.registration = PoolRegistrationBinding.fromPartial(object.registration);
    }
    message.registered = object.registered ?? false;
    message.pending_vrf_key_hash = object.pending_vrf_key_hash ?? new Uint8Array();
    if (object.pending_effective_epoch !== undefined && object.pending_effective_epoch !== null) {
      message.pending_effective_epoch = BigInt(object.pending_effective_epoch.toString());
    }
    if (object.retirement_epoch !== undefined && object.retirement_epoch !== null) {
      message.retirement_epoch = BigInt(object.retirement_epoch.toString());
    }
    return message;
  },
};
function createBasePoolRegistryState(): PoolRegistryState {
  return {
    epoch: BigInt(0),
    pools: [],
    mark: [],
    effective: [],
  };
}
/**
 * Registration projection of Cardano's current pool state and mark/set
 * snapshots at the associated checkpoint. This contains no stake amounts.
 * Bootstrap must establish all three views independently of the epoch table.
 * @name PoolRegistryState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PoolRegistryState
 */
export const PoolRegistryState = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.PoolRegistryState",
  encode(message: PoolRegistryState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.epoch !== BigInt(0)) {
      writer.uint32(8).uint64(message.epoch);
    }
    for (const v of message.pools) {
      PoolRegistrationRecord.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.mark) {
      PoolRegistrationBinding.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.effective) {
      PoolRegistrationBinding.encode(v!, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PoolRegistryState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePoolRegistryState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.epoch = reader.uint64();
          break;
        case 2:
          message.pools.push(PoolRegistrationRecord.decode(reader, reader.uint32()));
          break;
        case 3:
          message.mark.push(PoolRegistrationBinding.decode(reader, reader.uint32()));
          break;
        case 4:
          message.effective.push(PoolRegistrationBinding.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PoolRegistryState {
    const obj = createBasePoolRegistryState();
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (Array.isArray(object?.pools))
      obj.pools = object.pools.map((e: any) => PoolRegistrationRecord.fromJSON(e));
    if (Array.isArray(object?.mark))
      obj.mark = object.mark.map((e: any) => PoolRegistrationBinding.fromJSON(e));
    if (Array.isArray(object?.effective))
      obj.effective = object.effective.map((e: any) => PoolRegistrationBinding.fromJSON(e));
    return obj;
  },
  toJSON(message: PoolRegistryState): unknown {
    const obj: any = {};
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    if (message.pools) {
      obj.pools = message.pools.map((e) => (e ? PoolRegistrationRecord.toJSON(e) : undefined));
    } else {
      obj.pools = [];
    }
    if (message.mark) {
      obj.mark = message.mark.map((e) => (e ? PoolRegistrationBinding.toJSON(e) : undefined));
    } else {
      obj.mark = [];
    }
    if (message.effective) {
      obj.effective = message.effective.map((e) => (e ? PoolRegistrationBinding.toJSON(e) : undefined));
    } else {
      obj.effective = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PoolRegistryState>, I>>(object: I): PoolRegistryState {
    const message = createBasePoolRegistryState();
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    message.pools = object.pools?.map((e) => PoolRegistrationRecord.fromPartial(e)) || [];
    message.mark = object.mark?.map((e) => PoolRegistrationBinding.fromPartial(e)) || [];
    message.effective = object.effective?.map((e) => PoolRegistrationBinding.fromPartial(e)) || [];
    return message;
  },
};
function createBasePraosNonceState(): PraosNonceState {
  return {
    epoch_nonce: new Uint8Array(),
    evolving_nonce: new Uint8Array(),
    candidate_nonce: new Uint8Array(),
    last_applied_block_nonce: new Uint8Array(),
    last_epoch_block_nonce: new Uint8Array(),
  };
}
/**
 * Babbage/Conway Praos state after applying the checkpoint header.
 * Empty running nonce bytes represent Cardano's NeutralNonce identity. A
 * missing message is unavailable state and must never be filled with defaults.
 * @name PraosNonceState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.PraosNonceState
 */
export const PraosNonceState = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.PraosNonceState",
  encode(message: PraosNonceState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.epoch_nonce.length !== 0) {
      writer.uint32(10).bytes(message.epoch_nonce);
    }
    if (message.evolving_nonce.length !== 0) {
      writer.uint32(18).bytes(message.evolving_nonce);
    }
    if (message.candidate_nonce.length !== 0) {
      writer.uint32(26).bytes(message.candidate_nonce);
    }
    if (message.last_applied_block_nonce.length !== 0) {
      writer.uint32(34).bytes(message.last_applied_block_nonce);
    }
    if (message.last_epoch_block_nonce.length !== 0) {
      writer.uint32(42).bytes(message.last_epoch_block_nonce);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): PraosNonceState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePraosNonceState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.epoch_nonce = reader.bytes();
          break;
        case 2:
          message.evolving_nonce = reader.bytes();
          break;
        case 3:
          message.candidate_nonce = reader.bytes();
          break;
        case 4:
          message.last_applied_block_nonce = reader.bytes();
          break;
        case 5:
          message.last_epoch_block_nonce = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): PraosNonceState {
    const obj = createBasePraosNonceState();
    if (isSet(object.epoch_nonce)) obj.epoch_nonce = bytesFromBase64(object.epoch_nonce);
    if (isSet(object.evolving_nonce)) obj.evolving_nonce = bytesFromBase64(object.evolving_nonce);
    if (isSet(object.candidate_nonce)) obj.candidate_nonce = bytesFromBase64(object.candidate_nonce);
    if (isSet(object.last_applied_block_nonce))
      obj.last_applied_block_nonce = bytesFromBase64(object.last_applied_block_nonce);
    if (isSet(object.last_epoch_block_nonce))
      obj.last_epoch_block_nonce = bytesFromBase64(object.last_epoch_block_nonce);
    return obj;
  },
  toJSON(message: PraosNonceState): unknown {
    const obj: any = {};
    message.epoch_nonce !== undefined &&
      (obj.epoch_nonce = base64FromBytes(
        message.epoch_nonce !== undefined ? message.epoch_nonce : new Uint8Array(),
      ));
    message.evolving_nonce !== undefined &&
      (obj.evolving_nonce = base64FromBytes(
        message.evolving_nonce !== undefined ? message.evolving_nonce : new Uint8Array(),
      ));
    message.candidate_nonce !== undefined &&
      (obj.candidate_nonce = base64FromBytes(
        message.candidate_nonce !== undefined ? message.candidate_nonce : new Uint8Array(),
      ));
    message.last_applied_block_nonce !== undefined &&
      (obj.last_applied_block_nonce = base64FromBytes(
        message.last_applied_block_nonce !== undefined ? message.last_applied_block_nonce : new Uint8Array(),
      ));
    message.last_epoch_block_nonce !== undefined &&
      (obj.last_epoch_block_nonce = base64FromBytes(
        message.last_epoch_block_nonce !== undefined ? message.last_epoch_block_nonce : new Uint8Array(),
      ));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<PraosNonceState>, I>>(object: I): PraosNonceState {
    const message = createBasePraosNonceState();
    message.epoch_nonce = object.epoch_nonce ?? new Uint8Array();
    message.evolving_nonce = object.evolving_nonce ?? new Uint8Array();
    message.candidate_nonce = object.candidate_nonce ?? new Uint8Array();
    message.last_applied_block_nonce = object.last_applied_block_nonce ?? new Uint8Array();
    message.last_epoch_block_nonce = object.last_epoch_block_nonce ?? new Uint8Array();
    return message;
  },
};
function createBaseEpochContextChallenge(): EpochContextChallenge {
  return {
    epoch: BigInt(0),
    usable_after_unix_ns: BigInt(0),
  };
}
/**
 * Host-chain timestamps assigned by the verifier, never by an update header.
 * @name EpochContextChallenge
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.EpochContextChallenge
 */
export const EpochContextChallenge = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.EpochContextChallenge",
  encode(message: EpochContextChallenge, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.epoch !== BigInt(0)) {
      writer.uint32(8).uint64(message.epoch);
    }
    if (message.usable_after_unix_ns !== BigInt(0)) {
      writer.uint32(16).uint64(message.usable_after_unix_ns);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): EpochContextChallenge {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEpochContextChallenge();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.epoch = reader.uint64();
          break;
        case 2:
          message.usable_after_unix_ns = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): EpochContextChallenge {
    const obj = createBaseEpochContextChallenge();
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (isSet(object.usable_after_unix_ns))
      obj.usable_after_unix_ns = BigInt(object.usable_after_unix_ns.toString());
    return obj;
  },
  toJSON(message: EpochContextChallenge): unknown {
    const obj: any = {};
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    message.usable_after_unix_ns !== undefined &&
      (obj.usable_after_unix_ns = (message.usable_after_unix_ns || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<EpochContextChallenge>, I>>(object: I): EpochContextChallenge {
    const message = createBaseEpochContextChallenge();
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    if (object.usable_after_unix_ns !== undefined && object.usable_after_unix_ns !== null) {
      message.usable_after_unix_ns = BigInt(object.usable_after_unix_ns.toString());
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
    packet_state_snapshot: new Uint8Array(),
    nonce_state: undefined,
    pool_registry: undefined,
  };
}
/**
 * @name ConsensusState
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ConsensusState
 */
export const ConsensusState = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.ConsensusState",
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
    if (message.packet_state_snapshot.length !== 0) {
      writer.uint32(66).bytes(message.packet_state_snapshot);
    }
    if (message.nonce_state !== undefined) {
      PraosNonceState.encode(message.nonce_state, writer.uint32(74).fork()).ldelim();
    }
    if (message.pool_registry !== undefined) {
      PoolRegistryState.encode(message.pool_registry, writer.uint32(82).fork()).ldelim();
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
        case 8:
          message.packet_state_snapshot = reader.bytes();
          break;
        case 9:
          message.nonce_state = PraosNonceState.decode(reader, reader.uint32());
          break;
        case 10:
          message.pool_registry = PoolRegistryState.decode(reader, reader.uint32());
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
    if (isSet(object.packet_state_snapshot))
      obj.packet_state_snapshot = bytesFromBase64(object.packet_state_snapshot);
    if (isSet(object.nonce_state)) obj.nonce_state = PraosNonceState.fromJSON(object.nonce_state);
    if (isSet(object.pool_registry)) obj.pool_registry = PoolRegistryState.fromJSON(object.pool_registry);
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
    message.packet_state_snapshot !== undefined &&
      (obj.packet_state_snapshot = base64FromBytes(
        message.packet_state_snapshot !== undefined ? message.packet_state_snapshot : new Uint8Array(),
      ));
    message.nonce_state !== undefined &&
      (obj.nonce_state = message.nonce_state ? PraosNonceState.toJSON(message.nonce_state) : undefined);
    message.pool_registry !== undefined &&
      (obj.pool_registry = message.pool_registry
        ? PoolRegistryState.toJSON(message.pool_registry)
        : undefined);
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
    message.packet_state_snapshot = object.packet_state_snapshot ?? new Uint8Array();
    if (object.nonce_state !== undefined && object.nonce_state !== null) {
      message.nonce_state = PraosNonceState.fromPartial(object.nonce_state);
    }
    if (object.pool_registry !== undefined && object.pool_registry !== null) {
      message.pool_registry = PoolRegistryState.fromPartial(object.pool_registry);
    }
    return message;
  },
};
function createBaseMisbehaviour(): Misbehaviour {
  return {
    client_id: "",
    probabilistic_header1: undefined,
    probabilistic_header2: undefined,
  };
}
/**
 * @name Misbehaviour
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.Misbehaviour
 */
export const Misbehaviour = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.Misbehaviour",
  encode(message: Misbehaviour, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.probabilistic_header1 !== undefined) {
      ProbabilisticHeader.encode(message.probabilistic_header1, writer.uint32(18).fork()).ldelim();
    }
    if (message.probabilistic_header2 !== undefined) {
      ProbabilisticHeader.encode(message.probabilistic_header2, writer.uint32(26).fork()).ldelim();
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
          message.probabilistic_header1 = ProbabilisticHeader.decode(reader, reader.uint32());
          break;
        case 3:
          message.probabilistic_header2 = ProbabilisticHeader.decode(reader, reader.uint32());
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
    if (isSet(object.probabilistic_header1))
      obj.probabilistic_header1 = ProbabilisticHeader.fromJSON(object.probabilistic_header1);
    if (isSet(object.probabilistic_header2))
      obj.probabilistic_header2 = ProbabilisticHeader.fromJSON(object.probabilistic_header2);
    return obj;
  },
  toJSON(message: Misbehaviour): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.probabilistic_header1 !== undefined &&
      (obj.probabilistic_header1 = message.probabilistic_header1
        ? ProbabilisticHeader.toJSON(message.probabilistic_header1)
        : undefined);
    message.probabilistic_header2 !== undefined &&
      (obj.probabilistic_header2 = message.probabilistic_header2
        ? ProbabilisticHeader.toJSON(message.probabilistic_header2)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Misbehaviour>, I>>(object: I): Misbehaviour {
    const message = createBaseMisbehaviour();
    message.client_id = object.client_id ?? "";
    if (object.probabilistic_header1 !== undefined && object.probabilistic_header1 !== null) {
      message.probabilistic_header1 = ProbabilisticHeader.fromPartial(object.probabilistic_header1);
    }
    if (object.probabilistic_header2 !== undefined && object.probabilistic_header2 !== null) {
      message.probabilistic_header2 = ProbabilisticHeader.fromPartial(object.probabilistic_header2);
    }
    return message;
  },
};
function createBaseProbabilisticBlock(): ProbabilisticBlock {
  return {
    height: undefined,
    slot: BigInt(0),
    hash: "",
    epoch: BigInt(0),
    timestamp: BigInt(0),
    block_cbor: new Uint8Array(),
    header_cbor: new Uint8Array(),
  };
}
/**
 * @name ProbabilisticBlock
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ProbabilisticBlock
 */
export const ProbabilisticBlock = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.ProbabilisticBlock",
  encode(message: ProbabilisticBlock, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(10).fork()).ldelim();
    }
    if (message.slot !== BigInt(0)) {
      writer.uint32(16).uint64(message.slot);
    }
    if (message.hash !== "") {
      writer.uint32(26).string(message.hash);
    }
    if (message.epoch !== BigInt(0)) {
      writer.uint32(40).uint64(message.epoch);
    }
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(48).uint64(message.timestamp);
    }
    if (message.block_cbor.length !== 0) {
      writer.uint32(74).bytes(message.block_cbor);
    }
    if (message.header_cbor.length !== 0) {
      writer.uint32(82).bytes(message.header_cbor);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ProbabilisticBlock {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseProbabilisticBlock();
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
        case 5:
          message.epoch = reader.uint64();
          break;
        case 6:
          message.timestamp = reader.uint64();
          break;
        case 9:
          message.block_cbor = reader.bytes();
          break;
        case 10:
          message.header_cbor = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ProbabilisticBlock {
    const obj = createBaseProbabilisticBlock();
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    if (isSet(object.slot)) obj.slot = BigInt(object.slot.toString());
    if (isSet(object.hash)) obj.hash = String(object.hash);
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (isSet(object.timestamp)) obj.timestamp = BigInt(object.timestamp.toString());
    if (isSet(object.block_cbor)) obj.block_cbor = bytesFromBase64(object.block_cbor);
    if (isSet(object.header_cbor)) obj.header_cbor = bytesFromBase64(object.header_cbor);
    return obj;
  },
  toJSON(message: ProbabilisticBlock): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    message.slot !== undefined && (obj.slot = (message.slot || BigInt(0)).toString());
    message.hash !== undefined && (obj.hash = message.hash);
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.block_cbor !== undefined &&
      (obj.block_cbor = base64FromBytes(
        message.block_cbor !== undefined ? message.block_cbor : new Uint8Array(),
      ));
    message.header_cbor !== undefined &&
      (obj.header_cbor = base64FromBytes(
        message.header_cbor !== undefined ? message.header_cbor : new Uint8Array(),
      ));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ProbabilisticBlock>, I>>(object: I): ProbabilisticBlock {
    const message = createBaseProbabilisticBlock();
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    if (object.slot !== undefined && object.slot !== null) {
      message.slot = BigInt(object.slot.toString());
    }
    message.hash = object.hash ?? "";
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    message.block_cbor = object.block_cbor ?? new Uint8Array();
    message.header_cbor = object.header_cbor ?? new Uint8Array();
    return message;
  },
};
function createBaseProbabilisticHeader(): ProbabilisticHeader {
  return {
    trusted_height: undefined,
    anchor_block: undefined,
    descendant_blocks: [],
    host_state_tx_hash: "",
    host_state_tx_output_index: 0,
    bridge_blocks: [],
    new_epoch_context: undefined,
    is_checkpoint: false,
  };
}
/**
 * @name ProbabilisticHeader
 * @package ibc.lightclients.probabilistic.v1
 * @see proto type: ibc.lightclients.probabilistic.v1.ProbabilisticHeader
 */
export const ProbabilisticHeader = {
  typeUrl: "/ibc.lightclients.probabilistic.v1.ProbabilisticHeader",
  encode(message: ProbabilisticHeader, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.trusted_height !== undefined) {
      Height.encode(message.trusted_height, writer.uint32(10).fork()).ldelim();
    }
    if (message.anchor_block !== undefined) {
      ProbabilisticBlock.encode(message.anchor_block, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.descendant_blocks) {
      ProbabilisticBlock.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    if (message.host_state_tx_hash !== "") {
      writer.uint32(34).string(message.host_state_tx_hash);
    }
    if (message.host_state_tx_output_index !== 0) {
      writer.uint32(48).uint32(message.host_state_tx_output_index);
    }
    for (const v of message.bridge_blocks) {
      ProbabilisticBlock.encode(v!, writer.uint32(82).fork()).ldelim();
    }
    if (message.new_epoch_context !== undefined) {
      EpochContext.encode(message.new_epoch_context, writer.uint32(90).fork()).ldelim();
    }
    if (message.is_checkpoint === true) {
      writer.uint32(96).bool(message.is_checkpoint);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ProbabilisticHeader {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseProbabilisticHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.trusted_height = Height.decode(reader, reader.uint32());
          break;
        case 2:
          message.anchor_block = ProbabilisticBlock.decode(reader, reader.uint32());
          break;
        case 3:
          message.descendant_blocks.push(ProbabilisticBlock.decode(reader, reader.uint32()));
          break;
        case 4:
          message.host_state_tx_hash = reader.string();
          break;
        case 6:
          message.host_state_tx_output_index = reader.uint32();
          break;
        case 10:
          message.bridge_blocks.push(ProbabilisticBlock.decode(reader, reader.uint32()));
          break;
        case 11:
          message.new_epoch_context = EpochContext.decode(reader, reader.uint32());
          break;
        case 12:
          message.is_checkpoint = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ProbabilisticHeader {
    const obj = createBaseProbabilisticHeader();
    if (isSet(object.trusted_height)) obj.trusted_height = Height.fromJSON(object.trusted_height);
    if (isSet(object.anchor_block)) obj.anchor_block = ProbabilisticBlock.fromJSON(object.anchor_block);
    if (Array.isArray(object?.descendant_blocks))
      obj.descendant_blocks = object.descendant_blocks.map((e: any) => ProbabilisticBlock.fromJSON(e));
    if (isSet(object.host_state_tx_hash)) obj.host_state_tx_hash = String(object.host_state_tx_hash);
    if (isSet(object.host_state_tx_output_index))
      obj.host_state_tx_output_index = Number(object.host_state_tx_output_index);
    if (Array.isArray(object?.bridge_blocks))
      obj.bridge_blocks = object.bridge_blocks.map((e: any) => ProbabilisticBlock.fromJSON(e));
    if (isSet(object.new_epoch_context))
      obj.new_epoch_context = EpochContext.fromJSON(object.new_epoch_context);
    if (isSet(object.is_checkpoint)) obj.is_checkpoint = Boolean(object.is_checkpoint);
    return obj;
  },
  toJSON(message: ProbabilisticHeader): unknown {
    const obj: any = {};
    message.trusted_height !== undefined &&
      (obj.trusted_height = message.trusted_height ? Height.toJSON(message.trusted_height) : undefined);
    message.anchor_block !== undefined &&
      (obj.anchor_block = message.anchor_block ? ProbabilisticBlock.toJSON(message.anchor_block) : undefined);
    if (message.descendant_blocks) {
      obj.descendant_blocks = message.descendant_blocks.map((e) =>
        e ? ProbabilisticBlock.toJSON(e) : undefined,
      );
    } else {
      obj.descendant_blocks = [];
    }
    message.host_state_tx_hash !== undefined && (obj.host_state_tx_hash = message.host_state_tx_hash);
    message.host_state_tx_output_index !== undefined &&
      (obj.host_state_tx_output_index = Math.round(message.host_state_tx_output_index));
    if (message.bridge_blocks) {
      obj.bridge_blocks = message.bridge_blocks.map((e) => (e ? ProbabilisticBlock.toJSON(e) : undefined));
    } else {
      obj.bridge_blocks = [];
    }
    message.new_epoch_context !== undefined &&
      (obj.new_epoch_context = message.new_epoch_context
        ? EpochContext.toJSON(message.new_epoch_context)
        : undefined);
    message.is_checkpoint !== undefined && (obj.is_checkpoint = message.is_checkpoint);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ProbabilisticHeader>, I>>(object: I): ProbabilisticHeader {
    const message = createBaseProbabilisticHeader();
    if (object.trusted_height !== undefined && object.trusted_height !== null) {
      message.trusted_height = Height.fromPartial(object.trusted_height);
    }
    if (object.anchor_block !== undefined && object.anchor_block !== null) {
      message.anchor_block = ProbabilisticBlock.fromPartial(object.anchor_block);
    }
    message.descendant_blocks = object.descendant_blocks?.map((e) => ProbabilisticBlock.fromPartial(e)) || [];
    message.host_state_tx_hash = object.host_state_tx_hash ?? "";
    message.host_state_tx_output_index = object.host_state_tx_output_index ?? 0;
    message.bridge_blocks = object.bridge_blocks?.map((e) => ProbabilisticBlock.fromPartial(e)) || [];
    if (object.new_epoch_context !== undefined && object.new_epoch_context !== null) {
      message.new_epoch_context = EpochContext.fromPartial(object.new_epoch_context);
    }
    message.is_checkpoint = object.is_checkpoint ?? false;
    return message;
  },
};
