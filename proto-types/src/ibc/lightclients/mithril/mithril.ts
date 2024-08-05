/* eslint-disable */
import { Duration } from "../../../google/protobuf/duration";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../helpers";
export const protobufPackage = "ibc.clients.mithril.v1";
/** Protocol Message Part Key */
export enum ProtocolMessagePartKey {
  /** PROTOCOL_MESSAGE_PART_KEY_UNSPECIFIED - Invalid message part key */
  PROTOCOL_MESSAGE_PART_KEY_UNSPECIFIED = 0,
  /** PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST - key "snapshot_digest" */
  PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST = 1,
  /** PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT - key "cardano_transactions_merkle_root" */
  PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT = 2,
  /** PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY - key "next_aggregate_verification_key" */
  PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY = 3,
  /** PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER - key "latest_immutable_file_number" */
  PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER = 4,
  /** PROTOCOL_MESSAGE_PART_KEY_LATEST_BLOCK_NUMBER - key "latest_block_number" */
  PROTOCOL_MESSAGE_PART_KEY_LATEST_BLOCK_NUMBER = 5,
  UNRECOGNIZED = -1,
}
export function protocolMessagePartKeyFromJSON(object: any): ProtocolMessagePartKey {
  switch (object) {
    case 0:
    case "PROTOCOL_MESSAGE_PART_KEY_UNSPECIFIED":
      return ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_UNSPECIFIED;
    case 1:
    case "PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST":
      return ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST;
    case 2:
    case "PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT":
      return ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT;
    case 3:
    case "PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY":
      return ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY;
    case 4:
    case "PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER":
      return ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER;
    case 5:
    case "PROTOCOL_MESSAGE_PART_KEY_LATEST_BLOCK_NUMBER":
      return ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_LATEST_BLOCK_NUMBER;
    case -1:
    case "UNRECOGNIZED":
    default:
      return ProtocolMessagePartKey.UNRECOGNIZED;
  }
}
export function protocolMessagePartKeyToJSON(object: ProtocolMessagePartKey): string {
  switch (object) {
    case ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_UNSPECIFIED:
      return "PROTOCOL_MESSAGE_PART_KEY_UNSPECIFIED";
    case ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST:
      return "PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST";
    case ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT:
      return "PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT";
    case ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY:
      return "PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY";
    case ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER:
      return "PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER";
    case ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_LATEST_BLOCK_NUMBER:
      return "PROTOCOL_MESSAGE_PART_KEY_LATEST_BLOCK_NUMBER";
    case ProtocolMessagePartKey.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}
/**
 * Currently, the height of the certificate corresponds to the immutable file number in Cardano node
 * However, it is possible to have two certificates on the same immutable file.
 * This needs to be fixed in the future by using something unique like block height.
 */
export interface Height {
  /** the revision that the client is currently on */
  revision_number: bigint;
  /** the height within the given revision */
  revision_height: bigint;
}
/**
 * MithrilClientState represents the client state in the Mithril system.
 * Currently, this message includes protocol parameters.
 * However, these protocol parameters might be removed in the future,
 * as they can change across different epochs in Mithril.
 */
export interface ClientState {
  /** Chain id */
  chain_id: string;
  /** Latest height the client was updated to */
  latest_height?: Height;
  /** Block height when the client was frozen due to a misbehaviour */
  frozen_height?: Height;
  /** Epoch number of current chain state */
  current_epoch: bigint;
  trusting_period: Duration;
  protocol_parameters?: MithrilProtocolParameters;
  /** Path at which next upgraded client will be committed. */
  upgrade_path: string[];
}
/**
 * MithrilConsensusState represents the consensus state in the Mithril system.
 * This message stores the latest transaction snapshot hash and the first certificate hash of the latest epoch.
 * These are used to verify the latest transaction snapshot.
 */
export interface ConsensusState {
  timestamp: bigint;
  first_cert_hash_latest_epoch: string;
  latest_cert_hash_tx_snapshot: string;
}
/** Misbehavior represents a conflict between two headers. */
export interface Misbehaviour {
  /** ClientID is deprecated */
  /** @deprecated */
  client_id: string;
  mithril_header1?: MithrilHeader;
  mithril_header2?: MithrilHeader;
}
/** Mithril Header */
export interface MithrilHeader {
  mithril_stake_distribution?: MithrilStakeDistribution;
  mithril_stake_distribution_certificate?: MithrilCertificate;
  transaction_snapshot?: CardanoTransactionSnapshot;
  transaction_snapshot_certificate?: MithrilCertificate;
}
/** Mithril Stake Distribution */
export interface MithrilStakeDistribution {
  epoch: bigint;
  signers_with_stake: SignerWithStake[];
  hash: string;
  certificate_hash: string;
  created_at: bigint;
  protocol_parameter?: MithrilProtocolParameters;
}
/** Cardano Transaction Snapshot */
export interface CardanoTransactionSnapshot {
  merkle_root: string;
  epoch: bigint;
  block_number: bigint;
  hash: string;
  certificate_hash: string;
  created_at: string;
}
/** Mithril Certificate */
export interface MithrilCertificate {
  hash: string;
  previous_hash: string;
  epoch: bigint;
  signed_entity_type?: SignedEntityType;
  metadata?: CertificateMetadata;
  protocol_message?: ProtocolMessage;
  signed_message: string;
  aggregate_verification_key: string;
  multi_signature: string;
  genesis_signature: string;
}
/** Certificate Metadata */
export interface CertificateMetadata {
  network: string;
  protocol_version: string;
  protocol_parameters?: MithrilProtocolParameters;
  initiated_at: string;
  sealed_at: string;
  signers: SignerWithStake[];
}
/** Signer With Stake */
export interface SignerWithStake {
  party_id: string;
  stake: bigint;
}
/** Protocol Message */
export interface ProtocolMessage {
  message_parts: MessagePart[];
}
/** Message Part */
export interface MessagePart {
  protocol_message_part_key: ProtocolMessagePartKey;
  protocol_message_part_value: string;
}
/** Mithril Protocol Parameters */
export interface MithrilProtocolParameters {
  /** Quorum parameter */
  k: bigint;
  /** Security parameter (number of lotteries) */
  m: bigint;
  /** f in phi(w) = 1 - (1 - f)^w, where w is the stake of a participant */
  phi_f: Fraction;
}
/** ProtocolGenesisSignature wraps a cryptographic signature. */
export interface ProtocolGenesisSignature {
  signature: Uint8Array;
}
/** An entity type associated with the signature. */
export interface SignedEntityType {
  mithril_stake_distribution?: MithrilStakeDistribution;
  cardano_stake_distribution?: CardanoStakeDistribution;
  cardano_immutable_files_full?: CardanoImmutableFilesFull;
  cardano_transactions?: CardanoTransactions;
}
/** Cardano stake distribution */
export interface CardanoStakeDistribution {
  epoch: bigint;
}
/** Cardano immutable files full */
export interface CardanoImmutableFilesFull {
  beacon?: CardanoDbBeacon;
}
/** Cardano transactions */
export interface CardanoTransactions {
  epoch: bigint;
  block_number: bigint;
}
/** Cardano db beacon */
export interface CardanoDbBeacon {
  network: string;
  epoch: bigint;
  immutable_file_number: bigint;
}
/**
 * Fraction defines the protobuf message type for tmmath.Fraction that only
 * supports positive values.
 */
export interface Fraction {
  numerator: bigint;
  denominator: bigint;
}
function createBaseHeight(): Height {
  return {
    revision_number: BigInt(0),
    revision_height: BigInt(0)
  };
}
export const Height = {
  typeUrl: "/ibc.clients.mithril.v1.Height",
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
    message.revision_number !== undefined && (obj.revision_number = (message.revision_number || BigInt(0)).toString());
    message.revision_height !== undefined && (obj.revision_height = (message.revision_height || BigInt(0)).toString());
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
  }
};
function createBaseClientState(): ClientState {
  return {
    chain_id: "",
    latest_height: undefined,
    frozen_height: undefined,
    current_epoch: BigInt(0),
    trusting_period: Duration.fromPartial({}),
    protocol_parameters: undefined,
    upgrade_path: []
  };
}
export const ClientState = {
  typeUrl: "/ibc.clients.mithril.v1.ClientState",
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
    if (message.protocol_parameters !== undefined) {
      MithrilProtocolParameters.encode(message.protocol_parameters, writer.uint32(50).fork()).ldelim();
    }
    for (const v of message.upgrade_path) {
      writer.uint32(58).string(v!);
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
          message.protocol_parameters = MithrilProtocolParameters.decode(reader, reader.uint32());
          break;
        case 7:
          message.upgrade_path.push(reader.string());
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
    if (isSet(object.protocol_parameters)) obj.protocol_parameters = MithrilProtocolParameters.fromJSON(object.protocol_parameters);
    if (Array.isArray(object?.upgrade_path)) obj.upgrade_path = object.upgrade_path.map((e: any) => String(e));
    return obj;
  },
  toJSON(message: ClientState): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.latest_height !== undefined && (obj.latest_height = message.latest_height ? Height.toJSON(message.latest_height) : undefined);
    message.frozen_height !== undefined && (obj.frozen_height = message.frozen_height ? Height.toJSON(message.frozen_height) : undefined);
    message.current_epoch !== undefined && (obj.current_epoch = (message.current_epoch || BigInt(0)).toString());
    message.trusting_period !== undefined && (obj.trusting_period = message.trusting_period ? Duration.toJSON(message.trusting_period) : undefined);
    message.protocol_parameters !== undefined && (obj.protocol_parameters = message.protocol_parameters ? MithrilProtocolParameters.toJSON(message.protocol_parameters) : undefined);
    if (message.upgrade_path) {
      obj.upgrade_path = message.upgrade_path.map(e => e);
    } else {
      obj.upgrade_path = [];
    }
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
    if (object.protocol_parameters !== undefined && object.protocol_parameters !== null) {
      message.protocol_parameters = MithrilProtocolParameters.fromPartial(object.protocol_parameters);
    }
    message.upgrade_path = object.upgrade_path?.map(e => e) || [];
    return message;
  }
};
function createBaseConsensusState(): ConsensusState {
  return {
    timestamp: BigInt(0),
    first_cert_hash_latest_epoch: "",
    latest_cert_hash_tx_snapshot: ""
  };
}
export const ConsensusState = {
  typeUrl: "/ibc.clients.mithril.v1.ConsensusState",
  encode(message: ConsensusState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.timestamp !== BigInt(0)) {
      writer.uint32(8).uint64(message.timestamp);
    }
    if (message.first_cert_hash_latest_epoch !== "") {
      writer.uint32(18).string(message.first_cert_hash_latest_epoch);
    }
    if (message.latest_cert_hash_tx_snapshot !== "") {
      writer.uint32(26).string(message.latest_cert_hash_tx_snapshot);
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
          message.first_cert_hash_latest_epoch = reader.string();
          break;
        case 3:
          message.latest_cert_hash_tx_snapshot = reader.string();
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
    if (isSet(object.first_cert_hash_latest_epoch)) obj.first_cert_hash_latest_epoch = String(object.first_cert_hash_latest_epoch);
    if (isSet(object.latest_cert_hash_tx_snapshot)) obj.latest_cert_hash_tx_snapshot = String(object.latest_cert_hash_tx_snapshot);
    return obj;
  },
  toJSON(message: ConsensusState): unknown {
    const obj: any = {};
    message.timestamp !== undefined && (obj.timestamp = (message.timestamp || BigInt(0)).toString());
    message.first_cert_hash_latest_epoch !== undefined && (obj.first_cert_hash_latest_epoch = message.first_cert_hash_latest_epoch);
    message.latest_cert_hash_tx_snapshot !== undefined && (obj.latest_cert_hash_tx_snapshot = message.latest_cert_hash_tx_snapshot);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ConsensusState>, I>>(object: I): ConsensusState {
    const message = createBaseConsensusState();
    if (object.timestamp !== undefined && object.timestamp !== null) {
      message.timestamp = BigInt(object.timestamp.toString());
    }
    message.first_cert_hash_latest_epoch = object.first_cert_hash_latest_epoch ?? "";
    message.latest_cert_hash_tx_snapshot = object.latest_cert_hash_tx_snapshot ?? "";
    return message;
  }
};
function createBaseMisbehaviour(): Misbehaviour {
  return {
    client_id: "",
    mithril_header1: undefined,
    mithril_header2: undefined
  };
}
export const Misbehaviour = {
  typeUrl: "/ibc.clients.mithril.v1.Misbehaviour",
  encode(message: Misbehaviour, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.mithril_header1 !== undefined) {
      MithrilHeader.encode(message.mithril_header1, writer.uint32(18).fork()).ldelim();
    }
    if (message.mithril_header2 !== undefined) {
      MithrilHeader.encode(message.mithril_header2, writer.uint32(26).fork()).ldelim();
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
          message.mithril_header1 = MithrilHeader.decode(reader, reader.uint32());
          break;
        case 3:
          message.mithril_header2 = MithrilHeader.decode(reader, reader.uint32());
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
    if (isSet(object.mithril_header1)) obj.mithril_header1 = MithrilHeader.fromJSON(object.mithril_header1);
    if (isSet(object.mithril_header2)) obj.mithril_header2 = MithrilHeader.fromJSON(object.mithril_header2);
    return obj;
  },
  toJSON(message: Misbehaviour): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.mithril_header1 !== undefined && (obj.mithril_header1 = message.mithril_header1 ? MithrilHeader.toJSON(message.mithril_header1) : undefined);
    message.mithril_header2 !== undefined && (obj.mithril_header2 = message.mithril_header2 ? MithrilHeader.toJSON(message.mithril_header2) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Misbehaviour>, I>>(object: I): Misbehaviour {
    const message = createBaseMisbehaviour();
    message.client_id = object.client_id ?? "";
    if (object.mithril_header1 !== undefined && object.mithril_header1 !== null) {
      message.mithril_header1 = MithrilHeader.fromPartial(object.mithril_header1);
    }
    if (object.mithril_header2 !== undefined && object.mithril_header2 !== null) {
      message.mithril_header2 = MithrilHeader.fromPartial(object.mithril_header2);
    }
    return message;
  }
};
function createBaseMithrilHeader(): MithrilHeader {
  return {
    mithril_stake_distribution: undefined,
    mithril_stake_distribution_certificate: undefined,
    transaction_snapshot: undefined,
    transaction_snapshot_certificate: undefined
  };
}
export const MithrilHeader = {
  typeUrl: "/ibc.clients.mithril.v1.MithrilHeader",
  encode(message: MithrilHeader, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.mithril_stake_distribution !== undefined) {
      MithrilStakeDistribution.encode(message.mithril_stake_distribution, writer.uint32(10).fork()).ldelim();
    }
    if (message.mithril_stake_distribution_certificate !== undefined) {
      MithrilCertificate.encode(message.mithril_stake_distribution_certificate, writer.uint32(18).fork()).ldelim();
    }
    if (message.transaction_snapshot !== undefined) {
      CardanoTransactionSnapshot.encode(message.transaction_snapshot, writer.uint32(26).fork()).ldelim();
    }
    if (message.transaction_snapshot_certificate !== undefined) {
      MithrilCertificate.encode(message.transaction_snapshot_certificate, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MithrilHeader {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMithrilHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.mithril_stake_distribution = MithrilStakeDistribution.decode(reader, reader.uint32());
          break;
        case 2:
          message.mithril_stake_distribution_certificate = MithrilCertificate.decode(reader, reader.uint32());
          break;
        case 3:
          message.transaction_snapshot = CardanoTransactionSnapshot.decode(reader, reader.uint32());
          break;
        case 4:
          message.transaction_snapshot_certificate = MithrilCertificate.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MithrilHeader {
    const obj = createBaseMithrilHeader();
    if (isSet(object.mithril_stake_distribution)) obj.mithril_stake_distribution = MithrilStakeDistribution.fromJSON(object.mithril_stake_distribution);
    if (isSet(object.mithril_stake_distribution_certificate)) obj.mithril_stake_distribution_certificate = MithrilCertificate.fromJSON(object.mithril_stake_distribution_certificate);
    if (isSet(object.transaction_snapshot)) obj.transaction_snapshot = CardanoTransactionSnapshot.fromJSON(object.transaction_snapshot);
    if (isSet(object.transaction_snapshot_certificate)) obj.transaction_snapshot_certificate = MithrilCertificate.fromJSON(object.transaction_snapshot_certificate);
    return obj;
  },
  toJSON(message: MithrilHeader): unknown {
    const obj: any = {};
    message.mithril_stake_distribution !== undefined && (obj.mithril_stake_distribution = message.mithril_stake_distribution ? MithrilStakeDistribution.toJSON(message.mithril_stake_distribution) : undefined);
    message.mithril_stake_distribution_certificate !== undefined && (obj.mithril_stake_distribution_certificate = message.mithril_stake_distribution_certificate ? MithrilCertificate.toJSON(message.mithril_stake_distribution_certificate) : undefined);
    message.transaction_snapshot !== undefined && (obj.transaction_snapshot = message.transaction_snapshot ? CardanoTransactionSnapshot.toJSON(message.transaction_snapshot) : undefined);
    message.transaction_snapshot_certificate !== undefined && (obj.transaction_snapshot_certificate = message.transaction_snapshot_certificate ? MithrilCertificate.toJSON(message.transaction_snapshot_certificate) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MithrilHeader>, I>>(object: I): MithrilHeader {
    const message = createBaseMithrilHeader();
    if (object.mithril_stake_distribution !== undefined && object.mithril_stake_distribution !== null) {
      message.mithril_stake_distribution = MithrilStakeDistribution.fromPartial(object.mithril_stake_distribution);
    }
    if (object.mithril_stake_distribution_certificate !== undefined && object.mithril_stake_distribution_certificate !== null) {
      message.mithril_stake_distribution_certificate = MithrilCertificate.fromPartial(object.mithril_stake_distribution_certificate);
    }
    if (object.transaction_snapshot !== undefined && object.transaction_snapshot !== null) {
      message.transaction_snapshot = CardanoTransactionSnapshot.fromPartial(object.transaction_snapshot);
    }
    if (object.transaction_snapshot_certificate !== undefined && object.transaction_snapshot_certificate !== null) {
      message.transaction_snapshot_certificate = MithrilCertificate.fromPartial(object.transaction_snapshot_certificate);
    }
    return message;
  }
};
function createBaseMithrilStakeDistribution(): MithrilStakeDistribution {
  return {
    epoch: BigInt(0),
    signers_with_stake: [],
    hash: "",
    certificate_hash: "",
    created_at: BigInt(0),
    protocol_parameter: undefined
  };
}
export const MithrilStakeDistribution = {
  typeUrl: "/ibc.clients.mithril.v1.MithrilStakeDistribution",
  encode(message: MithrilStakeDistribution, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.epoch !== BigInt(0)) {
      writer.uint32(8).uint64(message.epoch);
    }
    for (const v of message.signers_with_stake) {
      SignerWithStake.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    if (message.hash !== "") {
      writer.uint32(26).string(message.hash);
    }
    if (message.certificate_hash !== "") {
      writer.uint32(34).string(message.certificate_hash);
    }
    if (message.created_at !== BigInt(0)) {
      writer.uint32(40).uint64(message.created_at);
    }
    if (message.protocol_parameter !== undefined) {
      MithrilProtocolParameters.encode(message.protocol_parameter, writer.uint32(50).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MithrilStakeDistribution {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMithrilStakeDistribution();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.epoch = reader.uint64();
          break;
        case 2:
          message.signers_with_stake.push(SignerWithStake.decode(reader, reader.uint32()));
          break;
        case 3:
          message.hash = reader.string();
          break;
        case 4:
          message.certificate_hash = reader.string();
          break;
        case 5:
          message.created_at = reader.uint64();
          break;
        case 6:
          message.protocol_parameter = MithrilProtocolParameters.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MithrilStakeDistribution {
    const obj = createBaseMithrilStakeDistribution();
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (Array.isArray(object?.signers_with_stake)) obj.signers_with_stake = object.signers_with_stake.map((e: any) => SignerWithStake.fromJSON(e));
    if (isSet(object.hash)) obj.hash = String(object.hash);
    if (isSet(object.certificate_hash)) obj.certificate_hash = String(object.certificate_hash);
    if (isSet(object.created_at)) obj.created_at = BigInt(object.created_at.toString());
    if (isSet(object.protocol_parameter)) obj.protocol_parameter = MithrilProtocolParameters.fromJSON(object.protocol_parameter);
    return obj;
  },
  toJSON(message: MithrilStakeDistribution): unknown {
    const obj: any = {};
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    if (message.signers_with_stake) {
      obj.signers_with_stake = message.signers_with_stake.map(e => e ? SignerWithStake.toJSON(e) : undefined);
    } else {
      obj.signers_with_stake = [];
    }
    message.hash !== undefined && (obj.hash = message.hash);
    message.certificate_hash !== undefined && (obj.certificate_hash = message.certificate_hash);
    message.created_at !== undefined && (obj.created_at = (message.created_at || BigInt(0)).toString());
    message.protocol_parameter !== undefined && (obj.protocol_parameter = message.protocol_parameter ? MithrilProtocolParameters.toJSON(message.protocol_parameter) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MithrilStakeDistribution>, I>>(object: I): MithrilStakeDistribution {
    const message = createBaseMithrilStakeDistribution();
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    message.signers_with_stake = object.signers_with_stake?.map(e => SignerWithStake.fromPartial(e)) || [];
    message.hash = object.hash ?? "";
    message.certificate_hash = object.certificate_hash ?? "";
    if (object.created_at !== undefined && object.created_at !== null) {
      message.created_at = BigInt(object.created_at.toString());
    }
    if (object.protocol_parameter !== undefined && object.protocol_parameter !== null) {
      message.protocol_parameter = MithrilProtocolParameters.fromPartial(object.protocol_parameter);
    }
    return message;
  }
};
function createBaseCardanoTransactionSnapshot(): CardanoTransactionSnapshot {
  return {
    merkle_root: "",
    epoch: BigInt(0),
    block_number: BigInt(0),
    hash: "",
    certificate_hash: "",
    created_at: ""
  };
}
export const CardanoTransactionSnapshot = {
  typeUrl: "/ibc.clients.mithril.v1.CardanoTransactionSnapshot",
  encode(message: CardanoTransactionSnapshot, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.merkle_root !== "") {
      writer.uint32(10).string(message.merkle_root);
    }
    if (message.epoch !== BigInt(0)) {
      writer.uint32(16).uint64(message.epoch);
    }
    if (message.block_number !== BigInt(0)) {
      writer.uint32(24).uint64(message.block_number);
    }
    if (message.hash !== "") {
      writer.uint32(34).string(message.hash);
    }
    if (message.certificate_hash !== "") {
      writer.uint32(42).string(message.certificate_hash);
    }
    if (message.created_at !== "") {
      writer.uint32(50).string(message.created_at);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): CardanoTransactionSnapshot {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCardanoTransactionSnapshot();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.merkle_root = reader.string();
          break;
        case 2:
          message.epoch = reader.uint64();
          break;
        case 3:
          message.block_number = reader.uint64();
          break;
        case 4:
          message.hash = reader.string();
          break;
        case 5:
          message.certificate_hash = reader.string();
          break;
        case 6:
          message.created_at = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): CardanoTransactionSnapshot {
    const obj = createBaseCardanoTransactionSnapshot();
    if (isSet(object.merkle_root)) obj.merkle_root = String(object.merkle_root);
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (isSet(object.block_number)) obj.block_number = BigInt(object.block_number.toString());
    if (isSet(object.hash)) obj.hash = String(object.hash);
    if (isSet(object.certificate_hash)) obj.certificate_hash = String(object.certificate_hash);
    if (isSet(object.created_at)) obj.created_at = String(object.created_at);
    return obj;
  },
  toJSON(message: CardanoTransactionSnapshot): unknown {
    const obj: any = {};
    message.merkle_root !== undefined && (obj.merkle_root = message.merkle_root);
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    message.block_number !== undefined && (obj.block_number = (message.block_number || BigInt(0)).toString());
    message.hash !== undefined && (obj.hash = message.hash);
    message.certificate_hash !== undefined && (obj.certificate_hash = message.certificate_hash);
    message.created_at !== undefined && (obj.created_at = message.created_at);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<CardanoTransactionSnapshot>, I>>(object: I): CardanoTransactionSnapshot {
    const message = createBaseCardanoTransactionSnapshot();
    message.merkle_root = object.merkle_root ?? "";
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    if (object.block_number !== undefined && object.block_number !== null) {
      message.block_number = BigInt(object.block_number.toString());
    }
    message.hash = object.hash ?? "";
    message.certificate_hash = object.certificate_hash ?? "";
    message.created_at = object.created_at ?? "";
    return message;
  }
};
function createBaseMithrilCertificate(): MithrilCertificate {
  return {
    hash: "",
    previous_hash: "",
    epoch: BigInt(0),
    signed_entity_type: undefined,
    metadata: undefined,
    protocol_message: undefined,
    signed_message: "",
    aggregate_verification_key: "",
    multi_signature: "",
    genesis_signature: ""
  };
}
export const MithrilCertificate = {
  typeUrl: "/ibc.clients.mithril.v1.MithrilCertificate",
  encode(message: MithrilCertificate, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.hash !== "") {
      writer.uint32(10).string(message.hash);
    }
    if (message.previous_hash !== "") {
      writer.uint32(18).string(message.previous_hash);
    }
    if (message.epoch !== BigInt(0)) {
      writer.uint32(24).uint64(message.epoch);
    }
    if (message.signed_entity_type !== undefined) {
      SignedEntityType.encode(message.signed_entity_type, writer.uint32(34).fork()).ldelim();
    }
    if (message.metadata !== undefined) {
      CertificateMetadata.encode(message.metadata, writer.uint32(42).fork()).ldelim();
    }
    if (message.protocol_message !== undefined) {
      ProtocolMessage.encode(message.protocol_message, writer.uint32(50).fork()).ldelim();
    }
    if (message.signed_message !== "") {
      writer.uint32(58).string(message.signed_message);
    }
    if (message.aggregate_verification_key !== "") {
      writer.uint32(66).string(message.aggregate_verification_key);
    }
    if (message.multi_signature !== "") {
      writer.uint32(74).string(message.multi_signature);
    }
    if (message.genesis_signature !== "") {
      writer.uint32(82).string(message.genesis_signature);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MithrilCertificate {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMithrilCertificate();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.hash = reader.string();
          break;
        case 2:
          message.previous_hash = reader.string();
          break;
        case 3:
          message.epoch = reader.uint64();
          break;
        case 4:
          message.signed_entity_type = SignedEntityType.decode(reader, reader.uint32());
          break;
        case 5:
          message.metadata = CertificateMetadata.decode(reader, reader.uint32());
          break;
        case 6:
          message.protocol_message = ProtocolMessage.decode(reader, reader.uint32());
          break;
        case 7:
          message.signed_message = reader.string();
          break;
        case 8:
          message.aggregate_verification_key = reader.string();
          break;
        case 9:
          message.multi_signature = reader.string();
          break;
        case 10:
          message.genesis_signature = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MithrilCertificate {
    const obj = createBaseMithrilCertificate();
    if (isSet(object.hash)) obj.hash = String(object.hash);
    if (isSet(object.previous_hash)) obj.previous_hash = String(object.previous_hash);
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (isSet(object.signed_entity_type)) obj.signed_entity_type = SignedEntityType.fromJSON(object.signed_entity_type);
    if (isSet(object.metadata)) obj.metadata = CertificateMetadata.fromJSON(object.metadata);
    if (isSet(object.protocol_message)) obj.protocol_message = ProtocolMessage.fromJSON(object.protocol_message);
    if (isSet(object.signed_message)) obj.signed_message = String(object.signed_message);
    if (isSet(object.aggregate_verification_key)) obj.aggregate_verification_key = String(object.aggregate_verification_key);
    if (isSet(object.multi_signature)) obj.multi_signature = String(object.multi_signature);
    if (isSet(object.genesis_signature)) obj.genesis_signature = String(object.genesis_signature);
    return obj;
  },
  toJSON(message: MithrilCertificate): unknown {
    const obj: any = {};
    message.hash !== undefined && (obj.hash = message.hash);
    message.previous_hash !== undefined && (obj.previous_hash = message.previous_hash);
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    message.signed_entity_type !== undefined && (obj.signed_entity_type = message.signed_entity_type ? SignedEntityType.toJSON(message.signed_entity_type) : undefined);
    message.metadata !== undefined && (obj.metadata = message.metadata ? CertificateMetadata.toJSON(message.metadata) : undefined);
    message.protocol_message !== undefined && (obj.protocol_message = message.protocol_message ? ProtocolMessage.toJSON(message.protocol_message) : undefined);
    message.signed_message !== undefined && (obj.signed_message = message.signed_message);
    message.aggregate_verification_key !== undefined && (obj.aggregate_verification_key = message.aggregate_verification_key);
    message.multi_signature !== undefined && (obj.multi_signature = message.multi_signature);
    message.genesis_signature !== undefined && (obj.genesis_signature = message.genesis_signature);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MithrilCertificate>, I>>(object: I): MithrilCertificate {
    const message = createBaseMithrilCertificate();
    message.hash = object.hash ?? "";
    message.previous_hash = object.previous_hash ?? "";
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    if (object.signed_entity_type !== undefined && object.signed_entity_type !== null) {
      message.signed_entity_type = SignedEntityType.fromPartial(object.signed_entity_type);
    }
    if (object.metadata !== undefined && object.metadata !== null) {
      message.metadata = CertificateMetadata.fromPartial(object.metadata);
    }
    if (object.protocol_message !== undefined && object.protocol_message !== null) {
      message.protocol_message = ProtocolMessage.fromPartial(object.protocol_message);
    }
    message.signed_message = object.signed_message ?? "";
    message.aggregate_verification_key = object.aggregate_verification_key ?? "";
    message.multi_signature = object.multi_signature ?? "";
    message.genesis_signature = object.genesis_signature ?? "";
    return message;
  }
};
function createBaseCertificateMetadata(): CertificateMetadata {
  return {
    network: "",
    protocol_version: "",
    protocol_parameters: undefined,
    initiated_at: "",
    sealed_at: "",
    signers: []
  };
}
export const CertificateMetadata = {
  typeUrl: "/ibc.clients.mithril.v1.CertificateMetadata",
  encode(message: CertificateMetadata, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.network !== "") {
      writer.uint32(10).string(message.network);
    }
    if (message.protocol_version !== "") {
      writer.uint32(18).string(message.protocol_version);
    }
    if (message.protocol_parameters !== undefined) {
      MithrilProtocolParameters.encode(message.protocol_parameters, writer.uint32(26).fork()).ldelim();
    }
    if (message.initiated_at !== "") {
      writer.uint32(34).string(message.initiated_at);
    }
    if (message.sealed_at !== "") {
      writer.uint32(42).string(message.sealed_at);
    }
    for (const v of message.signers) {
      SignerWithStake.encode(v!, writer.uint32(50).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): CertificateMetadata {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCertificateMetadata();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.network = reader.string();
          break;
        case 2:
          message.protocol_version = reader.string();
          break;
        case 3:
          message.protocol_parameters = MithrilProtocolParameters.decode(reader, reader.uint32());
          break;
        case 4:
          message.initiated_at = reader.string();
          break;
        case 5:
          message.sealed_at = reader.string();
          break;
        case 6:
          message.signers.push(SignerWithStake.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): CertificateMetadata {
    const obj = createBaseCertificateMetadata();
    if (isSet(object.network)) obj.network = String(object.network);
    if (isSet(object.protocol_version)) obj.protocol_version = String(object.protocol_version);
    if (isSet(object.protocol_parameters)) obj.protocol_parameters = MithrilProtocolParameters.fromJSON(object.protocol_parameters);
    if (isSet(object.initiated_at)) obj.initiated_at = String(object.initiated_at);
    if (isSet(object.sealed_at)) obj.sealed_at = String(object.sealed_at);
    if (Array.isArray(object?.signers)) obj.signers = object.signers.map((e: any) => SignerWithStake.fromJSON(e));
    return obj;
  },
  toJSON(message: CertificateMetadata): unknown {
    const obj: any = {};
    message.network !== undefined && (obj.network = message.network);
    message.protocol_version !== undefined && (obj.protocol_version = message.protocol_version);
    message.protocol_parameters !== undefined && (obj.protocol_parameters = message.protocol_parameters ? MithrilProtocolParameters.toJSON(message.protocol_parameters) : undefined);
    message.initiated_at !== undefined && (obj.initiated_at = message.initiated_at);
    message.sealed_at !== undefined && (obj.sealed_at = message.sealed_at);
    if (message.signers) {
      obj.signers = message.signers.map(e => e ? SignerWithStake.toJSON(e) : undefined);
    } else {
      obj.signers = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<CertificateMetadata>, I>>(object: I): CertificateMetadata {
    const message = createBaseCertificateMetadata();
    message.network = object.network ?? "";
    message.protocol_version = object.protocol_version ?? "";
    if (object.protocol_parameters !== undefined && object.protocol_parameters !== null) {
      message.protocol_parameters = MithrilProtocolParameters.fromPartial(object.protocol_parameters);
    }
    message.initiated_at = object.initiated_at ?? "";
    message.sealed_at = object.sealed_at ?? "";
    message.signers = object.signers?.map(e => SignerWithStake.fromPartial(e)) || [];
    return message;
  }
};
function createBaseSignerWithStake(): SignerWithStake {
  return {
    party_id: "",
    stake: BigInt(0)
  };
}
export const SignerWithStake = {
  typeUrl: "/ibc.clients.mithril.v1.SignerWithStake",
  encode(message: SignerWithStake, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.party_id !== "") {
      writer.uint32(10).string(message.party_id);
    }
    if (message.stake !== BigInt(0)) {
      writer.uint32(16).uint64(message.stake);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SignerWithStake {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSignerWithStake();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.party_id = reader.string();
          break;
        case 2:
          message.stake = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SignerWithStake {
    const obj = createBaseSignerWithStake();
    if (isSet(object.party_id)) obj.party_id = String(object.party_id);
    if (isSet(object.stake)) obj.stake = BigInt(object.stake.toString());
    return obj;
  },
  toJSON(message: SignerWithStake): unknown {
    const obj: any = {};
    message.party_id !== undefined && (obj.party_id = message.party_id);
    message.stake !== undefined && (obj.stake = (message.stake || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SignerWithStake>, I>>(object: I): SignerWithStake {
    const message = createBaseSignerWithStake();
    message.party_id = object.party_id ?? "";
    if (object.stake !== undefined && object.stake !== null) {
      message.stake = BigInt(object.stake.toString());
    }
    return message;
  }
};
function createBaseProtocolMessage(): ProtocolMessage {
  return {
    message_parts: []
  };
}
export const ProtocolMessage = {
  typeUrl: "/ibc.clients.mithril.v1.ProtocolMessage",
  encode(message: ProtocolMessage, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.message_parts) {
      MessagePart.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ProtocolMessage {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseProtocolMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.message_parts.push(MessagePart.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ProtocolMessage {
    const obj = createBaseProtocolMessage();
    if (Array.isArray(object?.message_parts)) obj.message_parts = object.message_parts.map((e: any) => MessagePart.fromJSON(e));
    return obj;
  },
  toJSON(message: ProtocolMessage): unknown {
    const obj: any = {};
    if (message.message_parts) {
      obj.message_parts = message.message_parts.map(e => e ? MessagePart.toJSON(e) : undefined);
    } else {
      obj.message_parts = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ProtocolMessage>, I>>(object: I): ProtocolMessage {
    const message = createBaseProtocolMessage();
    message.message_parts = object.message_parts?.map(e => MessagePart.fromPartial(e)) || [];
    return message;
  }
};
function createBaseMessagePart(): MessagePart {
  return {
    protocol_message_part_key: 0,
    protocol_message_part_value: ""
  };
}
export const MessagePart = {
  typeUrl: "/ibc.clients.mithril.v1.MessagePart",
  encode(message: MessagePart, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.protocol_message_part_key !== 0) {
      writer.uint32(8).int32(message.protocol_message_part_key);
    }
    if (message.protocol_message_part_value !== "") {
      writer.uint32(18).string(message.protocol_message_part_value);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MessagePart {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMessagePart();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.protocol_message_part_key = (reader.int32() as any);
          break;
        case 2:
          message.protocol_message_part_value = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MessagePart {
    const obj = createBaseMessagePart();
    if (isSet(object.protocol_message_part_key)) obj.protocol_message_part_key = protocolMessagePartKeyFromJSON(object.protocol_message_part_key);
    if (isSet(object.protocol_message_part_value)) obj.protocol_message_part_value = String(object.protocol_message_part_value);
    return obj;
  },
  toJSON(message: MessagePart): unknown {
    const obj: any = {};
    message.protocol_message_part_key !== undefined && (obj.protocol_message_part_key = protocolMessagePartKeyToJSON(message.protocol_message_part_key));
    message.protocol_message_part_value !== undefined && (obj.protocol_message_part_value = message.protocol_message_part_value);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MessagePart>, I>>(object: I): MessagePart {
    const message = createBaseMessagePart();
    message.protocol_message_part_key = object.protocol_message_part_key ?? 0;
    message.protocol_message_part_value = object.protocol_message_part_value ?? "";
    return message;
  }
};
function createBaseMithrilProtocolParameters(): MithrilProtocolParameters {
  return {
    k: BigInt(0),
    m: BigInt(0),
    phi_f: Fraction.fromPartial({})
  };
}
export const MithrilProtocolParameters = {
  typeUrl: "/ibc.clients.mithril.v1.MithrilProtocolParameters",
  encode(message: MithrilProtocolParameters, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.k !== BigInt(0)) {
      writer.uint32(8).uint64(message.k);
    }
    if (message.m !== BigInt(0)) {
      writer.uint32(16).uint64(message.m);
    }
    if (message.phi_f !== undefined) {
      Fraction.encode(message.phi_f, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MithrilProtocolParameters {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMithrilProtocolParameters();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.k = reader.uint64();
          break;
        case 2:
          message.m = reader.uint64();
          break;
        case 3:
          message.phi_f = Fraction.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MithrilProtocolParameters {
    const obj = createBaseMithrilProtocolParameters();
    if (isSet(object.k)) obj.k = BigInt(object.k.toString());
    if (isSet(object.m)) obj.m = BigInt(object.m.toString());
    if (isSet(object.phi_f)) obj.phi_f = Fraction.fromJSON(object.phi_f);
    return obj;
  },
  toJSON(message: MithrilProtocolParameters): unknown {
    const obj: any = {};
    message.k !== undefined && (obj.k = (message.k || BigInt(0)).toString());
    message.m !== undefined && (obj.m = (message.m || BigInt(0)).toString());
    message.phi_f !== undefined && (obj.phi_f = message.phi_f ? Fraction.toJSON(message.phi_f) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MithrilProtocolParameters>, I>>(object: I): MithrilProtocolParameters {
    const message = createBaseMithrilProtocolParameters();
    if (object.k !== undefined && object.k !== null) {
      message.k = BigInt(object.k.toString());
    }
    if (object.m !== undefined && object.m !== null) {
      message.m = BigInt(object.m.toString());
    }
    if (object.phi_f !== undefined && object.phi_f !== null) {
      message.phi_f = Fraction.fromPartial(object.phi_f);
    }
    return message;
  }
};
function createBaseProtocolGenesisSignature(): ProtocolGenesisSignature {
  return {
    signature: new Uint8Array()
  };
}
export const ProtocolGenesisSignature = {
  typeUrl: "/ibc.clients.mithril.v1.ProtocolGenesisSignature",
  encode(message: ProtocolGenesisSignature, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signature.length !== 0) {
      writer.uint32(10).bytes(message.signature);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ProtocolGenesisSignature {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseProtocolGenesisSignature();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signature = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ProtocolGenesisSignature {
    const obj = createBaseProtocolGenesisSignature();
    if (isSet(object.signature)) obj.signature = bytesFromBase64(object.signature);
    return obj;
  },
  toJSON(message: ProtocolGenesisSignature): unknown {
    const obj: any = {};
    message.signature !== undefined && (obj.signature = base64FromBytes(message.signature !== undefined ? message.signature : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ProtocolGenesisSignature>, I>>(object: I): ProtocolGenesisSignature {
    const message = createBaseProtocolGenesisSignature();
    message.signature = object.signature ?? new Uint8Array();
    return message;
  }
};
function createBaseSignedEntityType(): SignedEntityType {
  return {
    mithril_stake_distribution: undefined,
    cardano_stake_distribution: undefined,
    cardano_immutable_files_full: undefined,
    cardano_transactions: undefined
  };
}
export const SignedEntityType = {
  typeUrl: "/ibc.clients.mithril.v1.SignedEntityType",
  encode(message: SignedEntityType, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.mithril_stake_distribution !== undefined) {
      MithrilStakeDistribution.encode(message.mithril_stake_distribution, writer.uint32(10).fork()).ldelim();
    }
    if (message.cardano_stake_distribution !== undefined) {
      CardanoStakeDistribution.encode(message.cardano_stake_distribution, writer.uint32(18).fork()).ldelim();
    }
    if (message.cardano_immutable_files_full !== undefined) {
      CardanoImmutableFilesFull.encode(message.cardano_immutable_files_full, writer.uint32(26).fork()).ldelim();
    }
    if (message.cardano_transactions !== undefined) {
      CardanoTransactions.encode(message.cardano_transactions, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SignedEntityType {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSignedEntityType();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.mithril_stake_distribution = MithrilStakeDistribution.decode(reader, reader.uint32());
          break;
        case 2:
          message.cardano_stake_distribution = CardanoStakeDistribution.decode(reader, reader.uint32());
          break;
        case 3:
          message.cardano_immutable_files_full = CardanoImmutableFilesFull.decode(reader, reader.uint32());
          break;
        case 4:
          message.cardano_transactions = CardanoTransactions.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SignedEntityType {
    const obj = createBaseSignedEntityType();
    if (isSet(object.mithril_stake_distribution)) obj.mithril_stake_distribution = MithrilStakeDistribution.fromJSON(object.mithril_stake_distribution);
    if (isSet(object.cardano_stake_distribution)) obj.cardano_stake_distribution = CardanoStakeDistribution.fromJSON(object.cardano_stake_distribution);
    if (isSet(object.cardano_immutable_files_full)) obj.cardano_immutable_files_full = CardanoImmutableFilesFull.fromJSON(object.cardano_immutable_files_full);
    if (isSet(object.cardano_transactions)) obj.cardano_transactions = CardanoTransactions.fromJSON(object.cardano_transactions);
    return obj;
  },
  toJSON(message: SignedEntityType): unknown {
    const obj: any = {};
    message.mithril_stake_distribution !== undefined && (obj.mithril_stake_distribution = message.mithril_stake_distribution ? MithrilStakeDistribution.toJSON(message.mithril_stake_distribution) : undefined);
    message.cardano_stake_distribution !== undefined && (obj.cardano_stake_distribution = message.cardano_stake_distribution ? CardanoStakeDistribution.toJSON(message.cardano_stake_distribution) : undefined);
    message.cardano_immutable_files_full !== undefined && (obj.cardano_immutable_files_full = message.cardano_immutable_files_full ? CardanoImmutableFilesFull.toJSON(message.cardano_immutable_files_full) : undefined);
    message.cardano_transactions !== undefined && (obj.cardano_transactions = message.cardano_transactions ? CardanoTransactions.toJSON(message.cardano_transactions) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SignedEntityType>, I>>(object: I): SignedEntityType {
    const message = createBaseSignedEntityType();
    if (object.mithril_stake_distribution !== undefined && object.mithril_stake_distribution !== null) {
      message.mithril_stake_distribution = MithrilStakeDistribution.fromPartial(object.mithril_stake_distribution);
    }
    if (object.cardano_stake_distribution !== undefined && object.cardano_stake_distribution !== null) {
      message.cardano_stake_distribution = CardanoStakeDistribution.fromPartial(object.cardano_stake_distribution);
    }
    if (object.cardano_immutable_files_full !== undefined && object.cardano_immutable_files_full !== null) {
      message.cardano_immutable_files_full = CardanoImmutableFilesFull.fromPartial(object.cardano_immutable_files_full);
    }
    if (object.cardano_transactions !== undefined && object.cardano_transactions !== null) {
      message.cardano_transactions = CardanoTransactions.fromPartial(object.cardano_transactions);
    }
    return message;
  }
};
function createBaseCardanoStakeDistribution(): CardanoStakeDistribution {
  return {
    epoch: BigInt(0)
  };
}
export const CardanoStakeDistribution = {
  typeUrl: "/ibc.clients.mithril.v1.CardanoStakeDistribution",
  encode(message: CardanoStakeDistribution, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.epoch !== BigInt(0)) {
      writer.uint32(8).uint64(message.epoch);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): CardanoStakeDistribution {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCardanoStakeDistribution();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.epoch = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): CardanoStakeDistribution {
    const obj = createBaseCardanoStakeDistribution();
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    return obj;
  },
  toJSON(message: CardanoStakeDistribution): unknown {
    const obj: any = {};
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<CardanoStakeDistribution>, I>>(object: I): CardanoStakeDistribution {
    const message = createBaseCardanoStakeDistribution();
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    return message;
  }
};
function createBaseCardanoImmutableFilesFull(): CardanoImmutableFilesFull {
  return {
    beacon: undefined
  };
}
export const CardanoImmutableFilesFull = {
  typeUrl: "/ibc.clients.mithril.v1.CardanoImmutableFilesFull",
  encode(message: CardanoImmutableFilesFull, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.beacon !== undefined) {
      CardanoDbBeacon.encode(message.beacon, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): CardanoImmutableFilesFull {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCardanoImmutableFilesFull();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.beacon = CardanoDbBeacon.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): CardanoImmutableFilesFull {
    const obj = createBaseCardanoImmutableFilesFull();
    if (isSet(object.beacon)) obj.beacon = CardanoDbBeacon.fromJSON(object.beacon);
    return obj;
  },
  toJSON(message: CardanoImmutableFilesFull): unknown {
    const obj: any = {};
    message.beacon !== undefined && (obj.beacon = message.beacon ? CardanoDbBeacon.toJSON(message.beacon) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<CardanoImmutableFilesFull>, I>>(object: I): CardanoImmutableFilesFull {
    const message = createBaseCardanoImmutableFilesFull();
    if (object.beacon !== undefined && object.beacon !== null) {
      message.beacon = CardanoDbBeacon.fromPartial(object.beacon);
    }
    return message;
  }
};
function createBaseCardanoTransactions(): CardanoTransactions {
  return {
    epoch: BigInt(0),
    block_number: BigInt(0)
  };
}
export const CardanoTransactions = {
  typeUrl: "/ibc.clients.mithril.v1.CardanoTransactions",
  encode(message: CardanoTransactions, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.epoch !== BigInt(0)) {
      writer.uint32(8).uint64(message.epoch);
    }
    if (message.block_number !== BigInt(0)) {
      writer.uint32(16).uint64(message.block_number);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): CardanoTransactions {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCardanoTransactions();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.epoch = reader.uint64();
          break;
        case 2:
          message.block_number = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): CardanoTransactions {
    const obj = createBaseCardanoTransactions();
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (isSet(object.block_number)) obj.block_number = BigInt(object.block_number.toString());
    return obj;
  },
  toJSON(message: CardanoTransactions): unknown {
    const obj: any = {};
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    message.block_number !== undefined && (obj.block_number = (message.block_number || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<CardanoTransactions>, I>>(object: I): CardanoTransactions {
    const message = createBaseCardanoTransactions();
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    if (object.block_number !== undefined && object.block_number !== null) {
      message.block_number = BigInt(object.block_number.toString());
    }
    return message;
  }
};
function createBaseCardanoDbBeacon(): CardanoDbBeacon {
  return {
    network: "",
    epoch: BigInt(0),
    immutable_file_number: BigInt(0)
  };
}
export const CardanoDbBeacon = {
  typeUrl: "/ibc.clients.mithril.v1.CardanoDbBeacon",
  encode(message: CardanoDbBeacon, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.network !== "") {
      writer.uint32(10).string(message.network);
    }
    if (message.epoch !== BigInt(0)) {
      writer.uint32(16).uint64(message.epoch);
    }
    if (message.immutable_file_number !== BigInt(0)) {
      writer.uint32(24).uint64(message.immutable_file_number);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): CardanoDbBeacon {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCardanoDbBeacon();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.network = reader.string();
          break;
        case 2:
          message.epoch = reader.uint64();
          break;
        case 3:
          message.immutable_file_number = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): CardanoDbBeacon {
    const obj = createBaseCardanoDbBeacon();
    if (isSet(object.network)) obj.network = String(object.network);
    if (isSet(object.epoch)) obj.epoch = BigInt(object.epoch.toString());
    if (isSet(object.immutable_file_number)) obj.immutable_file_number = BigInt(object.immutable_file_number.toString());
    return obj;
  },
  toJSON(message: CardanoDbBeacon): unknown {
    const obj: any = {};
    message.network !== undefined && (obj.network = message.network);
    message.epoch !== undefined && (obj.epoch = (message.epoch || BigInt(0)).toString());
    message.immutable_file_number !== undefined && (obj.immutable_file_number = (message.immutable_file_number || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<CardanoDbBeacon>, I>>(object: I): CardanoDbBeacon {
    const message = createBaseCardanoDbBeacon();
    message.network = object.network ?? "";
    if (object.epoch !== undefined && object.epoch !== null) {
      message.epoch = BigInt(object.epoch.toString());
    }
    if (object.immutable_file_number !== undefined && object.immutable_file_number !== null) {
      message.immutable_file_number = BigInt(object.immutable_file_number.toString());
    }
    return message;
  }
};
function createBaseFraction(): Fraction {
  return {
    numerator: BigInt(0),
    denominator: BigInt(0)
  };
}
export const Fraction = {
  typeUrl: "/ibc.clients.mithril.v1.Fraction",
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
  }
};