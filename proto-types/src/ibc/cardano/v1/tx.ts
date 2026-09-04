/* eslint-disable */
import { Height } from "../../core/client/v1/client";
import { Any } from "../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../helpers";
export const protobufPackage = "ibc.cardano.v1";
/**
 * @name BuildHostStateHeartbeatRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatRequest
 */
export interface BuildHostStateHeartbeatRequest {
  /**
   * Cardano address whose UTxOs fund and sign the heartbeat transaction.
   */
  signer: string;
}
/**
 * @name BuildHostStateHeartbeatResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatResponse
 */
export interface BuildHostStateHeartbeatResponse {
  /**
   * False when an ordinary IBC transaction or heartbeat has already refreshed
   * HostState in the current epoch.
   */
  heartbeat_required: boolean;
  current_epoch: bigint;
  host_state_epoch: bigint;
  /**
   * Present only when heartbeat_required is true. The value contains the
   * unsigned Cardano transaction CBOR encoded as UTF-8 hex.
   */
  unsigned_tx?: Any;
}
/**
 * @name MsgPrunePacketHistory
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistory
 */
export interface MsgPrunePacketHistory {
  /**
   * Cardano address whose UTxOs fund and sign the pruning transaction.
   */
  signer: string;
  /**
   * Local Cardano channel identifiers whose retained history is pruned.
   */
  port_id: string;
  channel_id: string;
  sequence: bigint;
  /**
   * ICS-23 non-membership proof for the corresponding source-chain packet
   * commitment, evaluated at proof_height.
   */
  proof_commitment_absence: Uint8Array;
  proof_height?: Height;
}
/**
 * @name MsgPrunePacketHistoryResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistoryResponse
 */
export interface MsgPrunePacketHistoryResponse {
  /**
   * Unsigned Cardano transaction CBOR encoded as UTF-8 hex.
   */
  unsigned_tx?: Any;
}
/**
 * SubmitSignedTxRequest contains a signed Cardano transaction in CBOR format.
 * @name SubmitSignedTxRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxRequest
 */
export interface SubmitSignedTxRequest {
  /**
   * Signed transaction in CBOR hex format.
   * This is the completed, signed Cardano transaction ready for submission.
   */
  signed_tx_cbor: string;
  /**
   * Optional description for logging/debugging.
   */
  description: string;
  /**
   * When true, return after the node accepts the transaction instead of
   * waiting for history indexing. The Gateway only honors this for
   * structurally tree-neutral staged Tendermint session transactions.
   */
  submit_only: boolean;
  /**
   * Optional bounded confirmation timeout for a non-submit-only transaction.
   * Zero keeps the server default. Values are seconds.
   */
  confirmation_timeout_seconds: number;
  /**
   * Marks a structurally authenticated staged-session transaction as neutral
   * to the HostState commitment tree. This may be true with submit_only=false
   * when a tree-neutral phase boundary must be confirmed before rebuilding.
   */
  tree_neutral: boolean;
  /**
   * True only when this transaction consumes an output produced by an earlier
   * transaction in the same dependency-ordered chain. The Gateway may retry
   * unknown-input errors until the shared validity deadline only in this case.
   */
  has_prior_dependency: boolean;
}
/**
 * TendermintUpdateTxChain carries one dependency-ordered transaction phase.
 * A phase contains tree-neutral session transactions or one final client and
 * HostState update.
 * @name TendermintUpdateTxChain
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.TendermintUpdateTxChain
 */
export interface TendermintUpdateTxChain {
  /**
   * Envelope version. The only currently supported value is 1.
   */
  version: number;
  /**
   * Unsigned Cardano transaction bodies, CBOR-encoded as UTF-8 hex, in
   * dependency order. The protocol limit is 100 entries.
   */
  unsigned_tx_cbor: string[];
  /**
   * True when the last tree-neutral transaction is a confirmed phase boundary.
   * Hermes must rebuild and continue the original MsgUpdateClient after either
   * verification reaches a Complete session or session cleanup finishes.
   */
  rebuild_after_submission: boolean;
}
/**
 * SubmitSignedTxResponse contains the result of submitting a signed transaction.
 * @name SubmitSignedTxResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxResponse
 */
export interface SubmitSignedTxResponse {
  /**
   * Transaction hash (Blake2b-256 hash of the signed transaction).
   */
  tx_hash: string;
  /**
   * Block height at which the transaction was confirmed (if available).
   */
  height: string;
  /**
   * Raw transaction events (for IBC event parsing).
   */
  events: Event[];
}
/**
 * ObserveTxRequest identifies a transaction that Hermes already submitted
 * through its trusted Cardano node connection.
 * @name ObserveTxRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.ObserveTxRequest
 */
export interface ObserveTxRequest {
  /**
   * Blake2b-256 hash of the Cardano transaction body, encoded as 64 hex digits.
   */
  tx_hash: string;
}
/**
 * ObserveTxResponse contains the confirmed inclusion height and IBC events.
 * @name ObserveTxResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.ObserveTxResponse
 */
export interface ObserveTxResponse {
  /**
   * Canonical Blake2b-256 transaction body hash.
   */
  tx_hash: string;
  /**
   * Confirmed block height in IBC revision-number/revision-height form.
   */
  height: string;
  /**
   * Raw transaction events for IBC event parsing.
   */
  events: Event[];
}
/**
 * Event represents a transaction event with type and attributes.
 * @name Event
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.Event
 */
export interface Event {
  type: string;
  attributes: EventAttribute[];
}
/**
 * EventAttribute represents a key-value pair in an event.
 * @name EventAttribute
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.EventAttribute
 */
export interface EventAttribute {
  key: string;
  value: string;
}
function createBaseBuildHostStateHeartbeatRequest(): BuildHostStateHeartbeatRequest {
  return {
    signer: "",
  };
}
/**
 * @name BuildHostStateHeartbeatRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatRequest
 */
export const BuildHostStateHeartbeatRequest = {
  typeUrl: "/ibc.cardano.v1.BuildHostStateHeartbeatRequest",
  encode(
    message: BuildHostStateHeartbeatRequest,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BuildHostStateHeartbeatRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBuildHostStateHeartbeatRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BuildHostStateHeartbeatRequest {
    const obj = createBaseBuildHostStateHeartbeatRequest();
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: BuildHostStateHeartbeatRequest): unknown {
    const obj: any = {};
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BuildHostStateHeartbeatRequest>, I>>(
    object: I,
  ): BuildHostStateHeartbeatRequest {
    const message = createBaseBuildHostStateHeartbeatRequest();
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseBuildHostStateHeartbeatResponse(): BuildHostStateHeartbeatResponse {
  return {
    heartbeat_required: false,
    current_epoch: BigInt(0),
    host_state_epoch: BigInt(0),
    unsigned_tx: undefined,
  };
}
/**
 * @name BuildHostStateHeartbeatResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BuildHostStateHeartbeatResponse
 */
export const BuildHostStateHeartbeatResponse = {
  typeUrl: "/ibc.cardano.v1.BuildHostStateHeartbeatResponse",
  encode(
    message: BuildHostStateHeartbeatResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.heartbeat_required === true) {
      writer.uint32(8).bool(message.heartbeat_required);
    }
    if (message.current_epoch !== BigInt(0)) {
      writer.uint32(16).uint64(message.current_epoch);
    }
    if (message.host_state_epoch !== BigInt(0)) {
      writer.uint32(24).uint64(message.host_state_epoch);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BuildHostStateHeartbeatResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBuildHostStateHeartbeatResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.heartbeat_required = reader.bool();
          break;
        case 2:
          message.current_epoch = reader.uint64();
          break;
        case 3:
          message.host_state_epoch = reader.uint64();
          break;
        case 4:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BuildHostStateHeartbeatResponse {
    const obj = createBaseBuildHostStateHeartbeatResponse();
    if (isSet(object.heartbeat_required)) obj.heartbeat_required = Boolean(object.heartbeat_required);
    if (isSet(object.current_epoch)) obj.current_epoch = BigInt(object.current_epoch.toString());
    if (isSet(object.host_state_epoch)) obj.host_state_epoch = BigInt(object.host_state_epoch.toString());
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: BuildHostStateHeartbeatResponse): unknown {
    const obj: any = {};
    message.heartbeat_required !== undefined && (obj.heartbeat_required = message.heartbeat_required);
    message.current_epoch !== undefined &&
      (obj.current_epoch = (message.current_epoch || BigInt(0)).toString());
    message.host_state_epoch !== undefined &&
      (obj.host_state_epoch = (message.host_state_epoch || BigInt(0)).toString());
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BuildHostStateHeartbeatResponse>, I>>(
    object: I,
  ): BuildHostStateHeartbeatResponse {
    const message = createBaseBuildHostStateHeartbeatResponse();
    message.heartbeat_required = object.heartbeat_required ?? false;
    if (object.current_epoch !== undefined && object.current_epoch !== null) {
      message.current_epoch = BigInt(object.current_epoch.toString());
    }
    if (object.host_state_epoch !== undefined && object.host_state_epoch !== null) {
      message.host_state_epoch = BigInt(object.host_state_epoch.toString());
    }
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgPrunePacketHistory(): MsgPrunePacketHistory {
  return {
    signer: "",
    port_id: "",
    channel_id: "",
    sequence: BigInt(0),
    proof_commitment_absence: new Uint8Array(),
    proof_height: undefined,
  };
}
/**
 * @name MsgPrunePacketHistory
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistory
 */
export const MsgPrunePacketHistory = {
  typeUrl: "/ibc.cardano.v1.MsgPrunePacketHistory",
  encode(message: MsgPrunePacketHistory, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    if (message.port_id !== "") {
      writer.uint32(18).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(26).string(message.channel_id);
    }
    if (message.sequence !== BigInt(0)) {
      writer.uint32(32).uint64(message.sequence);
    }
    if (message.proof_commitment_absence.length !== 0) {
      writer.uint32(42).bytes(message.proof_commitment_absence);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(50).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPrunePacketHistory {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPrunePacketHistory();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signer = reader.string();
          break;
        case 2:
          message.port_id = reader.string();
          break;
        case 3:
          message.channel_id = reader.string();
          break;
        case 4:
          message.sequence = reader.uint64();
          break;
        case 5:
          message.proof_commitment_absence = reader.bytes();
          break;
        case 6:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgPrunePacketHistory {
    const obj = createBaseMsgPrunePacketHistory();
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.sequence)) obj.sequence = BigInt(object.sequence.toString());
    if (isSet(object.proof_commitment_absence))
      obj.proof_commitment_absence = bytesFromBase64(object.proof_commitment_absence);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    return obj;
  },
  toJSON(message: MsgPrunePacketHistory): unknown {
    const obj: any = {};
    message.signer !== undefined && (obj.signer = message.signer);
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.sequence !== undefined && (obj.sequence = (message.sequence || BigInt(0)).toString());
    message.proof_commitment_absence !== undefined &&
      (obj.proof_commitment_absence = base64FromBytes(
        message.proof_commitment_absence !== undefined ? message.proof_commitment_absence : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPrunePacketHistory>, I>>(object: I): MsgPrunePacketHistory {
    const message = createBaseMsgPrunePacketHistory();
    message.signer = object.signer ?? "";
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.sequence !== undefined && object.sequence !== null) {
      message.sequence = BigInt(object.sequence.toString());
    }
    message.proof_commitment_absence = object.proof_commitment_absence ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    return message;
  },
};
function createBaseMsgPrunePacketHistoryResponse(): MsgPrunePacketHistoryResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgPrunePacketHistoryResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.MsgPrunePacketHistoryResponse
 */
export const MsgPrunePacketHistoryResponse = {
  typeUrl: "/ibc.cardano.v1.MsgPrunePacketHistoryResponse",
  encode(message: MsgPrunePacketHistoryResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPrunePacketHistoryResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgPrunePacketHistoryResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgPrunePacketHistoryResponse {
    const obj = createBaseMsgPrunePacketHistoryResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgPrunePacketHistoryResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgPrunePacketHistoryResponse>, I>>(
    object: I,
  ): MsgPrunePacketHistoryResponse {
    const message = createBaseMsgPrunePacketHistoryResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseSubmitSignedTxRequest(): SubmitSignedTxRequest {
  return {
    signed_tx_cbor: "",
    description: "",
    submit_only: false,
    confirmation_timeout_seconds: 0,
    tree_neutral: false,
    has_prior_dependency: false,
  };
}
/**
 * SubmitSignedTxRequest contains a signed Cardano transaction in CBOR format.
 * @name SubmitSignedTxRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxRequest
 */
export const SubmitSignedTxRequest = {
  typeUrl: "/ibc.cardano.v1.SubmitSignedTxRequest",
  encode(message: SubmitSignedTxRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.signed_tx_cbor !== "") {
      writer.uint32(10).string(message.signed_tx_cbor);
    }
    if (message.description !== "") {
      writer.uint32(18).string(message.description);
    }
    if (message.submit_only === true) {
      writer.uint32(24).bool(message.submit_only);
    }
    if (message.confirmation_timeout_seconds !== 0) {
      writer.uint32(32).uint32(message.confirmation_timeout_seconds);
    }
    if (message.tree_neutral === true) {
      writer.uint32(40).bool(message.tree_neutral);
    }
    if (message.has_prior_dependency === true) {
      writer.uint32(48).bool(message.has_prior_dependency);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SubmitSignedTxRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSubmitSignedTxRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.signed_tx_cbor = reader.string();
          break;
        case 2:
          message.description = reader.string();
          break;
        case 3:
          message.submit_only = reader.bool();
          break;
        case 4:
          message.confirmation_timeout_seconds = reader.uint32();
          break;
        case 5:
          message.tree_neutral = reader.bool();
          break;
        case 6:
          message.has_prior_dependency = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SubmitSignedTxRequest {
    const obj = createBaseSubmitSignedTxRequest();
    if (isSet(object.signed_tx_cbor)) obj.signed_tx_cbor = String(object.signed_tx_cbor);
    if (isSet(object.description)) obj.description = String(object.description);
    if (isSet(object.submit_only)) obj.submit_only = Boolean(object.submit_only);
    if (isSet(object.confirmation_timeout_seconds))
      obj.confirmation_timeout_seconds = Number(object.confirmation_timeout_seconds);
    if (isSet(object.tree_neutral)) obj.tree_neutral = Boolean(object.tree_neutral);
    if (isSet(object.has_prior_dependency)) obj.has_prior_dependency = Boolean(object.has_prior_dependency);
    return obj;
  },
  toJSON(message: SubmitSignedTxRequest): unknown {
    const obj: any = {};
    message.signed_tx_cbor !== undefined && (obj.signed_tx_cbor = message.signed_tx_cbor);
    message.description !== undefined && (obj.description = message.description);
    message.submit_only !== undefined && (obj.submit_only = message.submit_only);
    message.confirmation_timeout_seconds !== undefined &&
      (obj.confirmation_timeout_seconds = Math.round(message.confirmation_timeout_seconds));
    message.tree_neutral !== undefined && (obj.tree_neutral = message.tree_neutral);
    message.has_prior_dependency !== undefined && (obj.has_prior_dependency = message.has_prior_dependency);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SubmitSignedTxRequest>, I>>(object: I): SubmitSignedTxRequest {
    const message = createBaseSubmitSignedTxRequest();
    message.signed_tx_cbor = object.signed_tx_cbor ?? "";
    message.description = object.description ?? "";
    message.submit_only = object.submit_only ?? false;
    message.confirmation_timeout_seconds = object.confirmation_timeout_seconds ?? 0;
    message.tree_neutral = object.tree_neutral ?? false;
    message.has_prior_dependency = object.has_prior_dependency ?? false;
    return message;
  },
};
function createBaseTendermintUpdateTxChain(): TendermintUpdateTxChain {
  return {
    version: 0,
    unsigned_tx_cbor: [],
    rebuild_after_submission: false,
  };
}
/**
 * TendermintUpdateTxChain carries one dependency-ordered transaction phase.
 * A phase contains tree-neutral session transactions or one final client and
 * HostState update.
 * @name TendermintUpdateTxChain
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.TendermintUpdateTxChain
 */
export const TendermintUpdateTxChain = {
  typeUrl: "/ibc.cardano.v1.TendermintUpdateTxChain",
  encode(message: TendermintUpdateTxChain, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.version !== 0) {
      writer.uint32(8).uint32(message.version);
    }
    for (const v of message.unsigned_tx_cbor) {
      writer.uint32(18).string(v!);
    }
    if (message.rebuild_after_submission === true) {
      writer.uint32(24).bool(message.rebuild_after_submission);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): TendermintUpdateTxChain {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTendermintUpdateTxChain();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.version = reader.uint32();
          break;
        case 2:
          message.unsigned_tx_cbor.push(reader.string());
          break;
        case 3:
          message.rebuild_after_submission = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): TendermintUpdateTxChain {
    const obj = createBaseTendermintUpdateTxChain();
    if (isSet(object.version)) obj.version = Number(object.version);
    if (Array.isArray(object?.unsigned_tx_cbor))
      obj.unsigned_tx_cbor = object.unsigned_tx_cbor.map((e: any) => String(e));
    if (isSet(object.rebuild_after_submission))
      obj.rebuild_after_submission = Boolean(object.rebuild_after_submission);
    return obj;
  },
  toJSON(message: TendermintUpdateTxChain): unknown {
    const obj: any = {};
    message.version !== undefined && (obj.version = Math.round(message.version));
    if (message.unsigned_tx_cbor) {
      obj.unsigned_tx_cbor = message.unsigned_tx_cbor.map((e) => e);
    } else {
      obj.unsigned_tx_cbor = [];
    }
    message.rebuild_after_submission !== undefined &&
      (obj.rebuild_after_submission = message.rebuild_after_submission);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<TendermintUpdateTxChain>, I>>(object: I): TendermintUpdateTxChain {
    const message = createBaseTendermintUpdateTxChain();
    message.version = object.version ?? 0;
    message.unsigned_tx_cbor = object.unsigned_tx_cbor?.map((e) => e) || [];
    message.rebuild_after_submission = object.rebuild_after_submission ?? false;
    return message;
  },
};
function createBaseSubmitSignedTxResponse(): SubmitSignedTxResponse {
  return {
    tx_hash: "",
    height: "",
    events: [],
  };
}
/**
 * SubmitSignedTxResponse contains the result of submitting a signed transaction.
 * @name SubmitSignedTxResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.SubmitSignedTxResponse
 */
export const SubmitSignedTxResponse = {
  typeUrl: "/ibc.cardano.v1.SubmitSignedTxResponse",
  encode(message: SubmitSignedTxResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.tx_hash !== "") {
      writer.uint32(10).string(message.tx_hash);
    }
    if (message.height !== "") {
      writer.uint32(18).string(message.height);
    }
    for (const v of message.events) {
      Event.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): SubmitSignedTxResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSubmitSignedTxResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.tx_hash = reader.string();
          break;
        case 2:
          message.height = reader.string();
          break;
        case 3:
          message.events.push(Event.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): SubmitSignedTxResponse {
    const obj = createBaseSubmitSignedTxResponse();
    if (isSet(object.tx_hash)) obj.tx_hash = String(object.tx_hash);
    if (isSet(object.height)) obj.height = String(object.height);
    if (Array.isArray(object?.events)) obj.events = object.events.map((e: any) => Event.fromJSON(e));
    return obj;
  },
  toJSON(message: SubmitSignedTxResponse): unknown {
    const obj: any = {};
    message.tx_hash !== undefined && (obj.tx_hash = message.tx_hash);
    message.height !== undefined && (obj.height = message.height);
    if (message.events) {
      obj.events = message.events.map((e) => (e ? Event.toJSON(e) : undefined));
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<SubmitSignedTxResponse>, I>>(object: I): SubmitSignedTxResponse {
    const message = createBaseSubmitSignedTxResponse();
    message.tx_hash = object.tx_hash ?? "";
    message.height = object.height ?? "";
    message.events = object.events?.map((e) => Event.fromPartial(e)) || [];
    return message;
  },
};
function createBaseObserveTxRequest(): ObserveTxRequest {
  return {
    tx_hash: "",
  };
}
/**
 * ObserveTxRequest identifies a transaction that Hermes already submitted
 * through its trusted Cardano node connection.
 * @name ObserveTxRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.ObserveTxRequest
 */
export const ObserveTxRequest = {
  typeUrl: "/ibc.cardano.v1.ObserveTxRequest",
  encode(message: ObserveTxRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.tx_hash !== "") {
      writer.uint32(10).string(message.tx_hash);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ObserveTxRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseObserveTxRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.tx_hash = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ObserveTxRequest {
    const obj = createBaseObserveTxRequest();
    if (isSet(object.tx_hash)) obj.tx_hash = String(object.tx_hash);
    return obj;
  },
  toJSON(message: ObserveTxRequest): unknown {
    const obj: any = {};
    message.tx_hash !== undefined && (obj.tx_hash = message.tx_hash);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ObserveTxRequest>, I>>(object: I): ObserveTxRequest {
    const message = createBaseObserveTxRequest();
    message.tx_hash = object.tx_hash ?? "";
    return message;
  },
};
function createBaseObserveTxResponse(): ObserveTxResponse {
  return {
    tx_hash: "",
    height: "",
    events: [],
  };
}
/**
 * ObserveTxResponse contains the confirmed inclusion height and IBC events.
 * @name ObserveTxResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.ObserveTxResponse
 */
export const ObserveTxResponse = {
  typeUrl: "/ibc.cardano.v1.ObserveTxResponse",
  encode(message: ObserveTxResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.tx_hash !== "") {
      writer.uint32(10).string(message.tx_hash);
    }
    if (message.height !== "") {
      writer.uint32(18).string(message.height);
    }
    for (const v of message.events) {
      Event.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ObserveTxResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseObserveTxResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.tx_hash = reader.string();
          break;
        case 2:
          message.height = reader.string();
          break;
        case 3:
          message.events.push(Event.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ObserveTxResponse {
    const obj = createBaseObserveTxResponse();
    if (isSet(object.tx_hash)) obj.tx_hash = String(object.tx_hash);
    if (isSet(object.height)) obj.height = String(object.height);
    if (Array.isArray(object?.events)) obj.events = object.events.map((e: any) => Event.fromJSON(e));
    return obj;
  },
  toJSON(message: ObserveTxResponse): unknown {
    const obj: any = {};
    message.tx_hash !== undefined && (obj.tx_hash = message.tx_hash);
    message.height !== undefined && (obj.height = message.height);
    if (message.events) {
      obj.events = message.events.map((e) => (e ? Event.toJSON(e) : undefined));
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ObserveTxResponse>, I>>(object: I): ObserveTxResponse {
    const message = createBaseObserveTxResponse();
    message.tx_hash = object.tx_hash ?? "";
    message.height = object.height ?? "";
    message.events = object.events?.map((e) => Event.fromPartial(e)) || [];
    return message;
  },
};
function createBaseEvent(): Event {
  return {
    type: "",
    attributes: [],
  };
}
/**
 * Event represents a transaction event with type and attributes.
 * @name Event
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.Event
 */
export const Event = {
  typeUrl: "/ibc.cardano.v1.Event",
  encode(message: Event, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.type !== "") {
      writer.uint32(10).string(message.type);
    }
    for (const v of message.attributes) {
      EventAttribute.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): Event {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEvent();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.type = reader.string();
          break;
        case 2:
          message.attributes.push(EventAttribute.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): Event {
    const obj = createBaseEvent();
    if (isSet(object.type)) obj.type = String(object.type);
    if (Array.isArray(object?.attributes))
      obj.attributes = object.attributes.map((e: any) => EventAttribute.fromJSON(e));
    return obj;
  },
  toJSON(message: Event): unknown {
    const obj: any = {};
    message.type !== undefined && (obj.type = message.type);
    if (message.attributes) {
      obj.attributes = message.attributes.map((e) => (e ? EventAttribute.toJSON(e) : undefined));
    } else {
      obj.attributes = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Event>, I>>(object: I): Event {
    const message = createBaseEvent();
    message.type = object.type ?? "";
    message.attributes = object.attributes?.map((e) => EventAttribute.fromPartial(e)) || [];
    return message;
  },
};
function createBaseEventAttribute(): EventAttribute {
  return {
    key: "",
    value: "",
  };
}
/**
 * EventAttribute represents a key-value pair in an event.
 * @name EventAttribute
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.EventAttribute
 */
export const EventAttribute = {
  typeUrl: "/ibc.cardano.v1.EventAttribute",
  encode(message: EventAttribute, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key !== "") {
      writer.uint32(10).string(message.key);
    }
    if (message.value !== "") {
      writer.uint32(18).string(message.value);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): EventAttribute {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEventAttribute();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key = reader.string();
          break;
        case 2:
          message.value = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): EventAttribute {
    const obj = createBaseEventAttribute();
    if (isSet(object.key)) obj.key = String(object.key);
    if (isSet(object.value)) obj.value = String(object.value);
    return obj;
  },
  toJSON(message: EventAttribute): unknown {
    const obj: any = {};
    message.key !== undefined && (obj.key = message.key);
    message.value !== undefined && (obj.value = message.value);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<EventAttribute>, I>>(object: I): EventAttribute {
    const message = createBaseEventAttribute();
    message.key = object.key ?? "";
    message.value = object.value ?? "";
    return message;
  },
};
