/* eslint-disable */
import { ResponseDeliverTx } from "../../core/types/v1/block";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet, DeepPartial, Exact, Rpc } from "../../../helpers";
export const protobufPackage = "ibc.cardano.v1";
/**
 * QueryEventsRequest is the request type for the Query/Events RPC method.
 * @name QueryEventsRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryEventsRequest
 */
export interface QueryEventsRequest {
  /**
   * Height from which to query events (exclusive - returns events after this height)
   */
  since_height: bigint;
}
/**
 * QueryEventsResponse is the response type for the Query/Events RPC method.
 * @name QueryEventsResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryEventsResponse
 */
export interface QueryEventsResponse {
  /**
   * Current chain height at the time of the query
   */
  current_height: bigint;
  /**
   * Highest block height actually scanned for this response page
   */
  scanned_to_height: bigint;
  /**
   * Events grouped by block height
   */
  events: BlockEvents[];
}
/**
 * BlockEvents contains all IBC events for a specific block
 * @name BlockEvents
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BlockEvents
 */
export interface BlockEvents {
  /**
   * Block height
   */
  height: bigint;
  /**
   * IBC events that occurred in this block
   */
  events: ResponseDeliverTx[];
}
/**
 * @name QueryBridgeManifestRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryBridgeManifestRequest
 */
export interface QueryBridgeManifestRequest {}
/**
 * @name QueryBridgeManifestResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryBridgeManifestResponse
 */
export interface QueryBridgeManifestResponse {
  manifest?: BridgeManifest;
}
/**
 * @name BridgeManifest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifest
 */
export interface BridgeManifest {
  schema_version: number;
  deployment_id: string;
  /**
   * RFC 3339 / ISO-8601 timestamp for when the bridge deployment completed.
   */
  deployed_at: string;
  cardano?: BridgeManifestCardanoInfo;
  host_state_nft?: BridgeManifestAuthToken;
  validators?: BridgeManifestValidators;
  modules?: BridgeManifestModules;
  trace_registry?: BridgeManifestTraceRegistry;
  /**
   * Exact, deduplicated inventory of every reference-script output created by
   * this deployment. Operators use it to prove shutdown reclamation is complete.
   */
  reference_out_refs: BridgeManifestRefUtxo[];
  /**
   * Full, canonical inventory commitment recorded by HostState at launch.
   */
  reference_script_inventory_root: string;
  /**
   * The exact parameterized validator needed to spend reference-script outputs
   * during shutdown. Persisting it keeps reclamation independent of later builds.
   */
  reference_validator?: BridgeManifestReferenceValidator;
}
/**
 * @name BridgeManifestCardanoInfo
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestCardanoInfo
 */
export interface BridgeManifestCardanoInfo {
  chain_id: string;
  network_magic: bigint;
  network: string;
}
/**
 * @name BridgeManifestAuthToken
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestAuthToken
 */
export interface BridgeManifestAuthToken {
  policy_id: string;
  token_name: string;
  /**
   * Serialized HostState minting policy required for the final deployment burn.
   */
  script: string;
}
/**
 * @name BridgeManifestRefUtxo
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestRefUtxo
 */
export interface BridgeManifestRefUtxo {
  tx_hash: string;
  output_index: bigint;
  /**
   * Present for top-level inventory entries; omitted where this message is
   * nested under a validator that already carries its script hash.
   */
  script_hash?: string;
}
/**
 * @name BridgeManifestReferenceValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestReferenceValidator
 */
export interface BridgeManifestReferenceValidator {
  script: string;
  script_hash: string;
  address: string;
}
/**
 * @name BridgeManifestValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestValidator
 */
export interface BridgeManifestValidator {
  script_hash: string;
  address: string;
  ref_utxo?: BridgeManifestRefUtxo;
}
/**
 * @name BridgeManifestReferredValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestReferredValidator
 */
export interface BridgeManifestReferredValidator {
  script_hash: string;
  ref_utxo?: BridgeManifestRefUtxo;
}
/**
 * @name BridgeManifestSpendChannelRefValidators
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestSpendChannelRefValidators
 */
export interface BridgeManifestSpendChannelRefValidators {
  acknowledge_packet?: BridgeManifestReferredValidator;
  chan_close_confirm?: BridgeManifestReferredValidator;
  chan_close_init?: BridgeManifestReferredValidator;
  chan_open_ack?: BridgeManifestReferredValidator;
  chan_open_confirm?: BridgeManifestReferredValidator;
  recv_packet?: BridgeManifestReferredValidator;
  send_packet?: BridgeManifestReferredValidator;
  timeout_packet?: BridgeManifestReferredValidator;
  prune_packet_history?: BridgeManifestReferredValidator;
}
/**
 * @name BridgeManifestSpendChannelValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestSpendChannelValidator
 */
export interface BridgeManifestSpendChannelValidator {
  script_hash: string;
  address: string;
  ref_utxo?: BridgeManifestRefUtxo;
  ref_validator?: BridgeManifestSpendChannelRefValidators;
}
/**
 * @name BridgeManifestValidators
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestValidators
 */
export interface BridgeManifestValidators {
  host_state_stt?: BridgeManifestValidator;
  spend_client?: BridgeManifestValidator;
  spend_connection?: BridgeManifestValidator;
  spend_channel?: BridgeManifestSpendChannelValidator;
  spend_transfer_module?: BridgeManifestValidator;
  verify_proof?: BridgeManifestValidator;
  mint_client_stt?: BridgeManifestValidator;
  mint_connection_stt?: BridgeManifestValidator;
  mint_channel_stt?: BridgeManifestValidator;
  mint_voucher?: BridgeManifestValidator;
  mint_lifecycle_creation_marker?: BridgeManifestValidator;
  mint_lifecycle_reclamation_marker?: BridgeManifestValidator;
  mint_lifecycle_operational_marker?: BridgeManifestValidator;
  mint_lifecycle_packet_marker?: BridgeManifestValidator;
  spend_mock_module?: BridgeManifestValidator;
  spend_trace_registry?: BridgeManifestValidator;
  mint_identifier?: BridgeManifestValidator;
  mint_transfer_escrow_shard?: BridgeManifestValidator;
  mint_port?: BridgeManifestValidator;
  voucher_metadata?: BridgeManifestVoucherMetadata;
  mint_trace_registry_benchmark_voucher?: BridgeManifestValidator;
}
/**
 * @name BridgeManifestVoucherMetadata
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestVoucherMetadata
 */
export interface BridgeManifestVoucherMetadata {
  address: string;
}
/**
 * @name BridgeManifestModule
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestModule
 */
export interface BridgeManifestModule {
  identifier: string;
  address: string;
}
/**
 * @name BridgeManifestModules
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestModules
 */
export interface BridgeManifestModules {
  transfer?: BridgeManifestModule;
  mock?: BridgeManifestModule;
  icq?: BridgeManifestModule;
}
/**
 * @name BridgeManifestTraceRegistryShard
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestTraceRegistryShard
 */
export interface BridgeManifestTraceRegistryShard {
  policy_id: string;
  token_name: string;
}
/**
 * @name BridgeManifestTraceRegistry
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestTraceRegistry
 */
export interface BridgeManifestTraceRegistry {
  address: string;
  shard_policy_id: string;
  directory?: BridgeManifestTraceRegistryShard;
}
function createBaseQueryEventsRequest(): QueryEventsRequest {
  return {
    since_height: BigInt(0),
  };
}
/**
 * QueryEventsRequest is the request type for the Query/Events RPC method.
 * @name QueryEventsRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryEventsRequest
 */
export const QueryEventsRequest = {
  typeUrl: "/ibc.cardano.v1.QueryEventsRequest",
  encode(message: QueryEventsRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.since_height !== BigInt(0)) {
      writer.uint32(8).uint64(message.since_height);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryEventsRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryEventsRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.since_height = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryEventsRequest {
    const obj = createBaseQueryEventsRequest();
    if (isSet(object.since_height)) obj.since_height = BigInt(object.since_height.toString());
    return obj;
  },
  toJSON(message: QueryEventsRequest): unknown {
    const obj: any = {};
    message.since_height !== undefined && (obj.since_height = (message.since_height || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryEventsRequest>, I>>(object: I): QueryEventsRequest {
    const message = createBaseQueryEventsRequest();
    if (object.since_height !== undefined && object.since_height !== null) {
      message.since_height = BigInt(object.since_height.toString());
    }
    return message;
  },
};
function createBaseQueryEventsResponse(): QueryEventsResponse {
  return {
    current_height: BigInt(0),
    scanned_to_height: BigInt(0),
    events: [],
  };
}
/**
 * QueryEventsResponse is the response type for the Query/Events RPC method.
 * @name QueryEventsResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryEventsResponse
 */
export const QueryEventsResponse = {
  typeUrl: "/ibc.cardano.v1.QueryEventsResponse",
  encode(message: QueryEventsResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.current_height !== BigInt(0)) {
      writer.uint32(8).uint64(message.current_height);
    }
    if (message.scanned_to_height !== BigInt(0)) {
      writer.uint32(24).uint64(message.scanned_to_height);
    }
    for (const v of message.events) {
      BlockEvents.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryEventsResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryEventsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.current_height = reader.uint64();
          break;
        case 3:
          message.scanned_to_height = reader.uint64();
          break;
        case 2:
          message.events.push(BlockEvents.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryEventsResponse {
    const obj = createBaseQueryEventsResponse();
    if (isSet(object.current_height)) obj.current_height = BigInt(object.current_height.toString());
    if (isSet(object.scanned_to_height)) obj.scanned_to_height = BigInt(object.scanned_to_height.toString());
    if (Array.isArray(object?.events)) obj.events = object.events.map((e: any) => BlockEvents.fromJSON(e));
    return obj;
  },
  toJSON(message: QueryEventsResponse): unknown {
    const obj: any = {};
    message.current_height !== undefined &&
      (obj.current_height = (message.current_height || BigInt(0)).toString());
    message.scanned_to_height !== undefined &&
      (obj.scanned_to_height = (message.scanned_to_height || BigInt(0)).toString());
    if (message.events) {
      obj.events = message.events.map((e) => (e ? BlockEvents.toJSON(e) : undefined));
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryEventsResponse>, I>>(object: I): QueryEventsResponse {
    const message = createBaseQueryEventsResponse();
    if (object.current_height !== undefined && object.current_height !== null) {
      message.current_height = BigInt(object.current_height.toString());
    }
    if (object.scanned_to_height !== undefined && object.scanned_to_height !== null) {
      message.scanned_to_height = BigInt(object.scanned_to_height.toString());
    }
    message.events = object.events?.map((e) => BlockEvents.fromPartial(e)) || [];
    return message;
  },
};
function createBaseBlockEvents(): BlockEvents {
  return {
    height: BigInt(0),
    events: [],
  };
}
/**
 * BlockEvents contains all IBC events for a specific block
 * @name BlockEvents
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BlockEvents
 */
export const BlockEvents = {
  typeUrl: "/ibc.cardano.v1.BlockEvents",
  encode(message: BlockEvents, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== BigInt(0)) {
      writer.uint32(8).uint64(message.height);
    }
    for (const v of message.events) {
      ResponseDeliverTx.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BlockEvents {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBlockEvents();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = reader.uint64();
          break;
        case 2:
          message.events.push(ResponseDeliverTx.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BlockEvents {
    const obj = createBaseBlockEvents();
    if (isSet(object.height)) obj.height = BigInt(object.height.toString());
    if (Array.isArray(object?.events))
      obj.events = object.events.map((e: any) => ResponseDeliverTx.fromJSON(e));
    return obj;
  },
  toJSON(message: BlockEvents): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = (message.height || BigInt(0)).toString());
    if (message.events) {
      obj.events = message.events.map((e) => (e ? ResponseDeliverTx.toJSON(e) : undefined));
    } else {
      obj.events = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BlockEvents>, I>>(object: I): BlockEvents {
    const message = createBaseBlockEvents();
    if (object.height !== undefined && object.height !== null) {
      message.height = BigInt(object.height.toString());
    }
    message.events = object.events?.map((e) => ResponseDeliverTx.fromPartial(e)) || [];
    return message;
  },
};
function createBaseQueryBridgeManifestRequest(): QueryBridgeManifestRequest {
  return {};
}
/**
 * @name QueryBridgeManifestRequest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryBridgeManifestRequest
 */
export const QueryBridgeManifestRequest = {
  typeUrl: "/ibc.cardano.v1.QueryBridgeManifestRequest",
  encode(_: QueryBridgeManifestRequest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBridgeManifestRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBridgeManifestRequest();
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
  fromJSON(_: any): QueryBridgeManifestRequest {
    const obj = createBaseQueryBridgeManifestRequest();
    return obj;
  },
  toJSON(_: QueryBridgeManifestRequest): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBridgeManifestRequest>, I>>(_: I): QueryBridgeManifestRequest {
    const message = createBaseQueryBridgeManifestRequest();
    return message;
  },
};
function createBaseQueryBridgeManifestResponse(): QueryBridgeManifestResponse {
  return {
    manifest: undefined,
  };
}
/**
 * @name QueryBridgeManifestResponse
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.QueryBridgeManifestResponse
 */
export const QueryBridgeManifestResponse = {
  typeUrl: "/ibc.cardano.v1.QueryBridgeManifestResponse",
  encode(message: QueryBridgeManifestResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.manifest !== undefined) {
      BridgeManifest.encode(message.manifest, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryBridgeManifestResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryBridgeManifestResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.manifest = BridgeManifest.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): QueryBridgeManifestResponse {
    const obj = createBaseQueryBridgeManifestResponse();
    if (isSet(object.manifest)) obj.manifest = BridgeManifest.fromJSON(object.manifest);
    return obj;
  },
  toJSON(message: QueryBridgeManifestResponse): unknown {
    const obj: any = {};
    message.manifest !== undefined &&
      (obj.manifest = message.manifest ? BridgeManifest.toJSON(message.manifest) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<QueryBridgeManifestResponse>, I>>(
    object: I,
  ): QueryBridgeManifestResponse {
    const message = createBaseQueryBridgeManifestResponse();
    if (object.manifest !== undefined && object.manifest !== null) {
      message.manifest = BridgeManifest.fromPartial(object.manifest);
    }
    return message;
  },
};
function createBaseBridgeManifest(): BridgeManifest {
  return {
    schema_version: 0,
    deployment_id: "",
    deployed_at: "",
    cardano: undefined,
    host_state_nft: undefined,
    validators: undefined,
    modules: undefined,
    trace_registry: undefined,
    reference_out_refs: [],
    reference_script_inventory_root: "",
    reference_validator: undefined,
  };
}
/**
 * @name BridgeManifest
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifest
 */
export const BridgeManifest = {
  typeUrl: "/ibc.cardano.v1.BridgeManifest",
  encode(message: BridgeManifest, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.schema_version !== 0) {
      writer.uint32(8).uint32(message.schema_version);
    }
    if (message.deployment_id !== "") {
      writer.uint32(18).string(message.deployment_id);
    }
    if (message.deployed_at !== "") {
      writer.uint32(66).string(message.deployed_at);
    }
    if (message.cardano !== undefined) {
      BridgeManifestCardanoInfo.encode(message.cardano, writer.uint32(26).fork()).ldelim();
    }
    if (message.host_state_nft !== undefined) {
      BridgeManifestAuthToken.encode(message.host_state_nft, writer.uint32(34).fork()).ldelim();
    }
    if (message.validators !== undefined) {
      BridgeManifestValidators.encode(message.validators, writer.uint32(50).fork()).ldelim();
    }
    if (message.modules !== undefined) {
      BridgeManifestModules.encode(message.modules, writer.uint32(58).fork()).ldelim();
    }
    if (message.trace_registry !== undefined) {
      BridgeManifestTraceRegistry.encode(message.trace_registry, writer.uint32(74).fork()).ldelim();
    }
    for (const v of message.reference_out_refs) {
      BridgeManifestRefUtxo.encode(v!, writer.uint32(82).fork()).ldelim();
    }
    if (message.reference_script_inventory_root !== "") {
      writer.uint32(90).string(message.reference_script_inventory_root);
    }
    if (message.reference_validator !== undefined) {
      BridgeManifestReferenceValidator.encode(message.reference_validator, writer.uint32(98).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.schema_version = reader.uint32();
          break;
        case 2:
          message.deployment_id = reader.string();
          break;
        case 8:
          message.deployed_at = reader.string();
          break;
        case 3:
          message.cardano = BridgeManifestCardanoInfo.decode(reader, reader.uint32());
          break;
        case 4:
          message.host_state_nft = BridgeManifestAuthToken.decode(reader, reader.uint32());
          break;
        case 6:
          message.validators = BridgeManifestValidators.decode(reader, reader.uint32());
          break;
        case 7:
          message.modules = BridgeManifestModules.decode(reader, reader.uint32());
          break;
        case 9:
          message.trace_registry = BridgeManifestTraceRegistry.decode(reader, reader.uint32());
          break;
        case 10:
          message.reference_out_refs.push(BridgeManifestRefUtxo.decode(reader, reader.uint32()));
          break;
        case 11:
          message.reference_script_inventory_root = reader.string();
          break;
        case 12:
          message.reference_validator = BridgeManifestReferenceValidator.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifest {
    const obj = createBaseBridgeManifest();
    if (isSet(object.schema_version)) obj.schema_version = Number(object.schema_version);
    if (isSet(object.deployment_id)) obj.deployment_id = String(object.deployment_id);
    if (isSet(object.deployed_at)) obj.deployed_at = String(object.deployed_at);
    if (isSet(object.cardano)) obj.cardano = BridgeManifestCardanoInfo.fromJSON(object.cardano);
    if (isSet(object.host_state_nft))
      obj.host_state_nft = BridgeManifestAuthToken.fromJSON(object.host_state_nft);
    if (isSet(object.validators)) obj.validators = BridgeManifestValidators.fromJSON(object.validators);
    if (isSet(object.modules)) obj.modules = BridgeManifestModules.fromJSON(object.modules);
    if (isSet(object.trace_registry))
      obj.trace_registry = BridgeManifestTraceRegistry.fromJSON(object.trace_registry);
    if (Array.isArray(object?.reference_out_refs))
      obj.reference_out_refs = object.reference_out_refs.map((e: any) => BridgeManifestRefUtxo.fromJSON(e));
    if (isSet(object.reference_script_inventory_root))
      obj.reference_script_inventory_root = String(object.reference_script_inventory_root);
    if (isSet(object.reference_validator))
      obj.reference_validator = BridgeManifestReferenceValidator.fromJSON(object.reference_validator);
    return obj;
  },
  toJSON(message: BridgeManifest): unknown {
    const obj: any = {};
    message.schema_version !== undefined && (obj.schema_version = Math.round(message.schema_version));
    message.deployment_id !== undefined && (obj.deployment_id = message.deployment_id);
    message.deployed_at !== undefined && (obj.deployed_at = message.deployed_at);
    message.cardano !== undefined &&
      (obj.cardano = message.cardano ? BridgeManifestCardanoInfo.toJSON(message.cardano) : undefined);
    message.host_state_nft !== undefined &&
      (obj.host_state_nft = message.host_state_nft
        ? BridgeManifestAuthToken.toJSON(message.host_state_nft)
        : undefined);
    message.validators !== undefined &&
      (obj.validators = message.validators ? BridgeManifestValidators.toJSON(message.validators) : undefined);
    message.modules !== undefined &&
      (obj.modules = message.modules ? BridgeManifestModules.toJSON(message.modules) : undefined);
    message.trace_registry !== undefined &&
      (obj.trace_registry = message.trace_registry
        ? BridgeManifestTraceRegistry.toJSON(message.trace_registry)
        : undefined);
    if (message.reference_out_refs) {
      obj.reference_out_refs = message.reference_out_refs.map((e) =>
        e ? BridgeManifestRefUtxo.toJSON(e) : undefined,
      );
    } else {
      obj.reference_out_refs = [];
    }
    message.reference_script_inventory_root !== undefined &&
      (obj.reference_script_inventory_root = message.reference_script_inventory_root);
    message.reference_validator !== undefined &&
      (obj.reference_validator = message.reference_validator
        ? BridgeManifestReferenceValidator.toJSON(message.reference_validator)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifest>, I>>(object: I): BridgeManifest {
    const message = createBaseBridgeManifest();
    message.schema_version = object.schema_version ?? 0;
    message.deployment_id = object.deployment_id ?? "";
    message.deployed_at = object.deployed_at ?? "";
    if (object.cardano !== undefined && object.cardano !== null) {
      message.cardano = BridgeManifestCardanoInfo.fromPartial(object.cardano);
    }
    if (object.host_state_nft !== undefined && object.host_state_nft !== null) {
      message.host_state_nft = BridgeManifestAuthToken.fromPartial(object.host_state_nft);
    }
    if (object.validators !== undefined && object.validators !== null) {
      message.validators = BridgeManifestValidators.fromPartial(object.validators);
    }
    if (object.modules !== undefined && object.modules !== null) {
      message.modules = BridgeManifestModules.fromPartial(object.modules);
    }
    if (object.trace_registry !== undefined && object.trace_registry !== null) {
      message.trace_registry = BridgeManifestTraceRegistry.fromPartial(object.trace_registry);
    }
    message.reference_out_refs =
      object.reference_out_refs?.map((e) => BridgeManifestRefUtxo.fromPartial(e)) || [];
    message.reference_script_inventory_root = object.reference_script_inventory_root ?? "";
    if (object.reference_validator !== undefined && object.reference_validator !== null) {
      message.reference_validator = BridgeManifestReferenceValidator.fromPartial(object.reference_validator);
    }
    return message;
  },
};
function createBaseBridgeManifestCardanoInfo(): BridgeManifestCardanoInfo {
  return {
    chain_id: "",
    network_magic: BigInt(0),
    network: "",
  };
}
/**
 * @name BridgeManifestCardanoInfo
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestCardanoInfo
 */
export const BridgeManifestCardanoInfo = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestCardanoInfo",
  encode(message: BridgeManifestCardanoInfo, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.chain_id !== "") {
      writer.uint32(10).string(message.chain_id);
    }
    if (message.network_magic !== BigInt(0)) {
      writer.uint32(16).uint64(message.network_magic);
    }
    if (message.network !== "") {
      writer.uint32(26).string(message.network);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestCardanoInfo {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestCardanoInfo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.chain_id = reader.string();
          break;
        case 2:
          message.network_magic = reader.uint64();
          break;
        case 3:
          message.network = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestCardanoInfo {
    const obj = createBaseBridgeManifestCardanoInfo();
    if (isSet(object.chain_id)) obj.chain_id = String(object.chain_id);
    if (isSet(object.network_magic)) obj.network_magic = BigInt(object.network_magic.toString());
    if (isSet(object.network)) obj.network = String(object.network);
    return obj;
  },
  toJSON(message: BridgeManifestCardanoInfo): unknown {
    const obj: any = {};
    message.chain_id !== undefined && (obj.chain_id = message.chain_id);
    message.network_magic !== undefined &&
      (obj.network_magic = (message.network_magic || BigInt(0)).toString());
    message.network !== undefined && (obj.network = message.network);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestCardanoInfo>, I>>(
    object: I,
  ): BridgeManifestCardanoInfo {
    const message = createBaseBridgeManifestCardanoInfo();
    message.chain_id = object.chain_id ?? "";
    if (object.network_magic !== undefined && object.network_magic !== null) {
      message.network_magic = BigInt(object.network_magic.toString());
    }
    message.network = object.network ?? "";
    return message;
  },
};
function createBaseBridgeManifestAuthToken(): BridgeManifestAuthToken {
  return {
    policy_id: "",
    token_name: "",
    script: "",
  };
}
/**
 * @name BridgeManifestAuthToken
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestAuthToken
 */
export const BridgeManifestAuthToken = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestAuthToken",
  encode(message: BridgeManifestAuthToken, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.policy_id !== "") {
      writer.uint32(10).string(message.policy_id);
    }
    if (message.token_name !== "") {
      writer.uint32(18).string(message.token_name);
    }
    if (message.script !== "") {
      writer.uint32(26).string(message.script);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestAuthToken {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestAuthToken();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.policy_id = reader.string();
          break;
        case 2:
          message.token_name = reader.string();
          break;
        case 3:
          message.script = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestAuthToken {
    const obj = createBaseBridgeManifestAuthToken();
    if (isSet(object.policy_id)) obj.policy_id = String(object.policy_id);
    if (isSet(object.token_name)) obj.token_name = String(object.token_name);
    if (isSet(object.script)) obj.script = String(object.script);
    return obj;
  },
  toJSON(message: BridgeManifestAuthToken): unknown {
    const obj: any = {};
    message.policy_id !== undefined && (obj.policy_id = message.policy_id);
    message.token_name !== undefined && (obj.token_name = message.token_name);
    message.script !== undefined && (obj.script = message.script);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestAuthToken>, I>>(object: I): BridgeManifestAuthToken {
    const message = createBaseBridgeManifestAuthToken();
    message.policy_id = object.policy_id ?? "";
    message.token_name = object.token_name ?? "";
    message.script = object.script ?? "";
    return message;
  },
};
function createBaseBridgeManifestRefUtxo(): BridgeManifestRefUtxo {
  return {
    tx_hash: "",
    output_index: BigInt(0),
    script_hash: undefined,
  };
}
/**
 * @name BridgeManifestRefUtxo
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestRefUtxo
 */
export const BridgeManifestRefUtxo = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestRefUtxo",
  encode(message: BridgeManifestRefUtxo, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.tx_hash !== "") {
      writer.uint32(10).string(message.tx_hash);
    }
    if (message.output_index !== BigInt(0)) {
      writer.uint32(16).uint64(message.output_index);
    }
    if (message.script_hash !== undefined) {
      writer.uint32(26).string(message.script_hash);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestRefUtxo {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestRefUtxo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.tx_hash = reader.string();
          break;
        case 2:
          message.output_index = reader.uint64();
          break;
        case 3:
          message.script_hash = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestRefUtxo {
    const obj = createBaseBridgeManifestRefUtxo();
    if (isSet(object.tx_hash)) obj.tx_hash = String(object.tx_hash);
    if (isSet(object.output_index)) obj.output_index = BigInt(object.output_index.toString());
    if (isSet(object.script_hash)) obj.script_hash = String(object.script_hash);
    return obj;
  },
  toJSON(message: BridgeManifestRefUtxo): unknown {
    const obj: any = {};
    message.tx_hash !== undefined && (obj.tx_hash = message.tx_hash);
    message.output_index !== undefined && (obj.output_index = (message.output_index || BigInt(0)).toString());
    message.script_hash !== undefined && (obj.script_hash = message.script_hash);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestRefUtxo>, I>>(object: I): BridgeManifestRefUtxo {
    const message = createBaseBridgeManifestRefUtxo();
    message.tx_hash = object.tx_hash ?? "";
    if (object.output_index !== undefined && object.output_index !== null) {
      message.output_index = BigInt(object.output_index.toString());
    }
    message.script_hash = object.script_hash ?? undefined;
    return message;
  },
};
function createBaseBridgeManifestReferenceValidator(): BridgeManifestReferenceValidator {
  return {
    script: "",
    script_hash: "",
    address: "",
  };
}
/**
 * @name BridgeManifestReferenceValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestReferenceValidator
 */
export const BridgeManifestReferenceValidator = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestReferenceValidator",
  encode(
    message: BridgeManifestReferenceValidator,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.script !== "") {
      writer.uint32(10).string(message.script);
    }
    if (message.script_hash !== "") {
      writer.uint32(18).string(message.script_hash);
    }
    if (message.address !== "") {
      writer.uint32(26).string(message.address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestReferenceValidator {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestReferenceValidator();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.script = reader.string();
          break;
        case 2:
          message.script_hash = reader.string();
          break;
        case 3:
          message.address = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestReferenceValidator {
    const obj = createBaseBridgeManifestReferenceValidator();
    if (isSet(object.script)) obj.script = String(object.script);
    if (isSet(object.script_hash)) obj.script_hash = String(object.script_hash);
    if (isSet(object.address)) obj.address = String(object.address);
    return obj;
  },
  toJSON(message: BridgeManifestReferenceValidator): unknown {
    const obj: any = {};
    message.script !== undefined && (obj.script = message.script);
    message.script_hash !== undefined && (obj.script_hash = message.script_hash);
    message.address !== undefined && (obj.address = message.address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestReferenceValidator>, I>>(
    object: I,
  ): BridgeManifestReferenceValidator {
    const message = createBaseBridgeManifestReferenceValidator();
    message.script = object.script ?? "";
    message.script_hash = object.script_hash ?? "";
    message.address = object.address ?? "";
    return message;
  },
};
function createBaseBridgeManifestValidator(): BridgeManifestValidator {
  return {
    script_hash: "",
    address: "",
    ref_utxo: undefined,
  };
}
/**
 * @name BridgeManifestValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestValidator
 */
export const BridgeManifestValidator = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestValidator",
  encode(message: BridgeManifestValidator, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.script_hash !== "") {
      writer.uint32(10).string(message.script_hash);
    }
    if (message.address !== "") {
      writer.uint32(18).string(message.address);
    }
    if (message.ref_utxo !== undefined) {
      BridgeManifestRefUtxo.encode(message.ref_utxo, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestValidator {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestValidator();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.script_hash = reader.string();
          break;
        case 2:
          message.address = reader.string();
          break;
        case 3:
          message.ref_utxo = BridgeManifestRefUtxo.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestValidator {
    const obj = createBaseBridgeManifestValidator();
    if (isSet(object.script_hash)) obj.script_hash = String(object.script_hash);
    if (isSet(object.address)) obj.address = String(object.address);
    if (isSet(object.ref_utxo)) obj.ref_utxo = BridgeManifestRefUtxo.fromJSON(object.ref_utxo);
    return obj;
  },
  toJSON(message: BridgeManifestValidator): unknown {
    const obj: any = {};
    message.script_hash !== undefined && (obj.script_hash = message.script_hash);
    message.address !== undefined && (obj.address = message.address);
    message.ref_utxo !== undefined &&
      (obj.ref_utxo = message.ref_utxo ? BridgeManifestRefUtxo.toJSON(message.ref_utxo) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestValidator>, I>>(object: I): BridgeManifestValidator {
    const message = createBaseBridgeManifestValidator();
    message.script_hash = object.script_hash ?? "";
    message.address = object.address ?? "";
    if (object.ref_utxo !== undefined && object.ref_utxo !== null) {
      message.ref_utxo = BridgeManifestRefUtxo.fromPartial(object.ref_utxo);
    }
    return message;
  },
};
function createBaseBridgeManifestReferredValidator(): BridgeManifestReferredValidator {
  return {
    script_hash: "",
    ref_utxo: undefined,
  };
}
/**
 * @name BridgeManifestReferredValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestReferredValidator
 */
export const BridgeManifestReferredValidator = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestReferredValidator",
  encode(
    message: BridgeManifestReferredValidator,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.script_hash !== "") {
      writer.uint32(10).string(message.script_hash);
    }
    if (message.ref_utxo !== undefined) {
      BridgeManifestRefUtxo.encode(message.ref_utxo, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestReferredValidator {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestReferredValidator();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.script_hash = reader.string();
          break;
        case 2:
          message.ref_utxo = BridgeManifestRefUtxo.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestReferredValidator {
    const obj = createBaseBridgeManifestReferredValidator();
    if (isSet(object.script_hash)) obj.script_hash = String(object.script_hash);
    if (isSet(object.ref_utxo)) obj.ref_utxo = BridgeManifestRefUtxo.fromJSON(object.ref_utxo);
    return obj;
  },
  toJSON(message: BridgeManifestReferredValidator): unknown {
    const obj: any = {};
    message.script_hash !== undefined && (obj.script_hash = message.script_hash);
    message.ref_utxo !== undefined &&
      (obj.ref_utxo = message.ref_utxo ? BridgeManifestRefUtxo.toJSON(message.ref_utxo) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestReferredValidator>, I>>(
    object: I,
  ): BridgeManifestReferredValidator {
    const message = createBaseBridgeManifestReferredValidator();
    message.script_hash = object.script_hash ?? "";
    if (object.ref_utxo !== undefined && object.ref_utxo !== null) {
      message.ref_utxo = BridgeManifestRefUtxo.fromPartial(object.ref_utxo);
    }
    return message;
  },
};
function createBaseBridgeManifestSpendChannelRefValidators(): BridgeManifestSpendChannelRefValidators {
  return {
    acknowledge_packet: undefined,
    chan_close_confirm: undefined,
    chan_close_init: undefined,
    chan_open_ack: undefined,
    chan_open_confirm: undefined,
    recv_packet: undefined,
    send_packet: undefined,
    timeout_packet: undefined,
    prune_packet_history: undefined,
  };
}
/**
 * @name BridgeManifestSpendChannelRefValidators
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestSpendChannelRefValidators
 */
export const BridgeManifestSpendChannelRefValidators = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestSpendChannelRefValidators",
  encode(
    message: BridgeManifestSpendChannelRefValidators,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.acknowledge_packet !== undefined) {
      BridgeManifestReferredValidator.encode(message.acknowledge_packet, writer.uint32(10).fork()).ldelim();
    }
    if (message.chan_close_confirm !== undefined) {
      BridgeManifestReferredValidator.encode(message.chan_close_confirm, writer.uint32(18).fork()).ldelim();
    }
    if (message.chan_close_init !== undefined) {
      BridgeManifestReferredValidator.encode(message.chan_close_init, writer.uint32(26).fork()).ldelim();
    }
    if (message.chan_open_ack !== undefined) {
      BridgeManifestReferredValidator.encode(message.chan_open_ack, writer.uint32(34).fork()).ldelim();
    }
    if (message.chan_open_confirm !== undefined) {
      BridgeManifestReferredValidator.encode(message.chan_open_confirm, writer.uint32(42).fork()).ldelim();
    }
    if (message.recv_packet !== undefined) {
      BridgeManifestReferredValidator.encode(message.recv_packet, writer.uint32(50).fork()).ldelim();
    }
    if (message.send_packet !== undefined) {
      BridgeManifestReferredValidator.encode(message.send_packet, writer.uint32(58).fork()).ldelim();
    }
    if (message.timeout_packet !== undefined) {
      BridgeManifestReferredValidator.encode(message.timeout_packet, writer.uint32(66).fork()).ldelim();
    }
    if (message.prune_packet_history !== undefined) {
      BridgeManifestReferredValidator.encode(message.prune_packet_history, writer.uint32(74).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestSpendChannelRefValidators {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestSpendChannelRefValidators();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.acknowledge_packet = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 2:
          message.chan_close_confirm = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 3:
          message.chan_close_init = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 4:
          message.chan_open_ack = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 5:
          message.chan_open_confirm = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 6:
          message.recv_packet = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 7:
          message.send_packet = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 8:
          message.timeout_packet = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        case 9:
          message.prune_packet_history = BridgeManifestReferredValidator.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestSpendChannelRefValidators {
    const obj = createBaseBridgeManifestSpendChannelRefValidators();
    if (isSet(object.acknowledge_packet))
      obj.acknowledge_packet = BridgeManifestReferredValidator.fromJSON(object.acknowledge_packet);
    if (isSet(object.chan_close_confirm))
      obj.chan_close_confirm = BridgeManifestReferredValidator.fromJSON(object.chan_close_confirm);
    if (isSet(object.chan_close_init))
      obj.chan_close_init = BridgeManifestReferredValidator.fromJSON(object.chan_close_init);
    if (isSet(object.chan_open_ack))
      obj.chan_open_ack = BridgeManifestReferredValidator.fromJSON(object.chan_open_ack);
    if (isSet(object.chan_open_confirm))
      obj.chan_open_confirm = BridgeManifestReferredValidator.fromJSON(object.chan_open_confirm);
    if (isSet(object.recv_packet))
      obj.recv_packet = BridgeManifestReferredValidator.fromJSON(object.recv_packet);
    if (isSet(object.send_packet))
      obj.send_packet = BridgeManifestReferredValidator.fromJSON(object.send_packet);
    if (isSet(object.timeout_packet))
      obj.timeout_packet = BridgeManifestReferredValidator.fromJSON(object.timeout_packet);
    if (isSet(object.prune_packet_history))
      obj.prune_packet_history = BridgeManifestReferredValidator.fromJSON(object.prune_packet_history);
    return obj;
  },
  toJSON(message: BridgeManifestSpendChannelRefValidators): unknown {
    const obj: any = {};
    message.acknowledge_packet !== undefined &&
      (obj.acknowledge_packet = message.acknowledge_packet
        ? BridgeManifestReferredValidator.toJSON(message.acknowledge_packet)
        : undefined);
    message.chan_close_confirm !== undefined &&
      (obj.chan_close_confirm = message.chan_close_confirm
        ? BridgeManifestReferredValidator.toJSON(message.chan_close_confirm)
        : undefined);
    message.chan_close_init !== undefined &&
      (obj.chan_close_init = message.chan_close_init
        ? BridgeManifestReferredValidator.toJSON(message.chan_close_init)
        : undefined);
    message.chan_open_ack !== undefined &&
      (obj.chan_open_ack = message.chan_open_ack
        ? BridgeManifestReferredValidator.toJSON(message.chan_open_ack)
        : undefined);
    message.chan_open_confirm !== undefined &&
      (obj.chan_open_confirm = message.chan_open_confirm
        ? BridgeManifestReferredValidator.toJSON(message.chan_open_confirm)
        : undefined);
    message.recv_packet !== undefined &&
      (obj.recv_packet = message.recv_packet
        ? BridgeManifestReferredValidator.toJSON(message.recv_packet)
        : undefined);
    message.send_packet !== undefined &&
      (obj.send_packet = message.send_packet
        ? BridgeManifestReferredValidator.toJSON(message.send_packet)
        : undefined);
    message.timeout_packet !== undefined &&
      (obj.timeout_packet = message.timeout_packet
        ? BridgeManifestReferredValidator.toJSON(message.timeout_packet)
        : undefined);
    message.prune_packet_history !== undefined &&
      (obj.prune_packet_history = message.prune_packet_history
        ? BridgeManifestReferredValidator.toJSON(message.prune_packet_history)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestSpendChannelRefValidators>, I>>(
    object: I,
  ): BridgeManifestSpendChannelRefValidators {
    const message = createBaseBridgeManifestSpendChannelRefValidators();
    if (object.acknowledge_packet !== undefined && object.acknowledge_packet !== null) {
      message.acknowledge_packet = BridgeManifestReferredValidator.fromPartial(object.acknowledge_packet);
    }
    if (object.chan_close_confirm !== undefined && object.chan_close_confirm !== null) {
      message.chan_close_confirm = BridgeManifestReferredValidator.fromPartial(object.chan_close_confirm);
    }
    if (object.chan_close_init !== undefined && object.chan_close_init !== null) {
      message.chan_close_init = BridgeManifestReferredValidator.fromPartial(object.chan_close_init);
    }
    if (object.chan_open_ack !== undefined && object.chan_open_ack !== null) {
      message.chan_open_ack = BridgeManifestReferredValidator.fromPartial(object.chan_open_ack);
    }
    if (object.chan_open_confirm !== undefined && object.chan_open_confirm !== null) {
      message.chan_open_confirm = BridgeManifestReferredValidator.fromPartial(object.chan_open_confirm);
    }
    if (object.recv_packet !== undefined && object.recv_packet !== null) {
      message.recv_packet = BridgeManifestReferredValidator.fromPartial(object.recv_packet);
    }
    if (object.send_packet !== undefined && object.send_packet !== null) {
      message.send_packet = BridgeManifestReferredValidator.fromPartial(object.send_packet);
    }
    if (object.timeout_packet !== undefined && object.timeout_packet !== null) {
      message.timeout_packet = BridgeManifestReferredValidator.fromPartial(object.timeout_packet);
    }
    if (object.prune_packet_history !== undefined && object.prune_packet_history !== null) {
      message.prune_packet_history = BridgeManifestReferredValidator.fromPartial(object.prune_packet_history);
    }
    return message;
  },
};
function createBaseBridgeManifestSpendChannelValidator(): BridgeManifestSpendChannelValidator {
  return {
    script_hash: "",
    address: "",
    ref_utxo: undefined,
    ref_validator: undefined,
  };
}
/**
 * @name BridgeManifestSpendChannelValidator
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestSpendChannelValidator
 */
export const BridgeManifestSpendChannelValidator = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestSpendChannelValidator",
  encode(
    message: BridgeManifestSpendChannelValidator,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.script_hash !== "") {
      writer.uint32(10).string(message.script_hash);
    }
    if (message.address !== "") {
      writer.uint32(18).string(message.address);
    }
    if (message.ref_utxo !== undefined) {
      BridgeManifestRefUtxo.encode(message.ref_utxo, writer.uint32(26).fork()).ldelim();
    }
    if (message.ref_validator !== undefined) {
      BridgeManifestSpendChannelRefValidators.encode(
        message.ref_validator,
        writer.uint32(34).fork(),
      ).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestSpendChannelValidator {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestSpendChannelValidator();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.script_hash = reader.string();
          break;
        case 2:
          message.address = reader.string();
          break;
        case 3:
          message.ref_utxo = BridgeManifestRefUtxo.decode(reader, reader.uint32());
          break;
        case 4:
          message.ref_validator = BridgeManifestSpendChannelRefValidators.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestSpendChannelValidator {
    const obj = createBaseBridgeManifestSpendChannelValidator();
    if (isSet(object.script_hash)) obj.script_hash = String(object.script_hash);
    if (isSet(object.address)) obj.address = String(object.address);
    if (isSet(object.ref_utxo)) obj.ref_utxo = BridgeManifestRefUtxo.fromJSON(object.ref_utxo);
    if (isSet(object.ref_validator))
      obj.ref_validator = BridgeManifestSpendChannelRefValidators.fromJSON(object.ref_validator);
    return obj;
  },
  toJSON(message: BridgeManifestSpendChannelValidator): unknown {
    const obj: any = {};
    message.script_hash !== undefined && (obj.script_hash = message.script_hash);
    message.address !== undefined && (obj.address = message.address);
    message.ref_utxo !== undefined &&
      (obj.ref_utxo = message.ref_utxo ? BridgeManifestRefUtxo.toJSON(message.ref_utxo) : undefined);
    message.ref_validator !== undefined &&
      (obj.ref_validator = message.ref_validator
        ? BridgeManifestSpendChannelRefValidators.toJSON(message.ref_validator)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestSpendChannelValidator>, I>>(
    object: I,
  ): BridgeManifestSpendChannelValidator {
    const message = createBaseBridgeManifestSpendChannelValidator();
    message.script_hash = object.script_hash ?? "";
    message.address = object.address ?? "";
    if (object.ref_utxo !== undefined && object.ref_utxo !== null) {
      message.ref_utxo = BridgeManifestRefUtxo.fromPartial(object.ref_utxo);
    }
    if (object.ref_validator !== undefined && object.ref_validator !== null) {
      message.ref_validator = BridgeManifestSpendChannelRefValidators.fromPartial(object.ref_validator);
    }
    return message;
  },
};
function createBaseBridgeManifestValidators(): BridgeManifestValidators {
  return {
    host_state_stt: undefined,
    spend_client: undefined,
    spend_connection: undefined,
    spend_channel: undefined,
    spend_transfer_module: undefined,
    verify_proof: undefined,
    mint_client_stt: undefined,
    mint_connection_stt: undefined,
    mint_channel_stt: undefined,
    mint_voucher: undefined,
    mint_lifecycle_creation_marker: undefined,
    mint_lifecycle_reclamation_marker: undefined,
    mint_lifecycle_operational_marker: undefined,
    mint_lifecycle_packet_marker: undefined,
    spend_mock_module: undefined,
    spend_trace_registry: undefined,
    mint_identifier: undefined,
    mint_transfer_escrow_shard: undefined,
    mint_port: undefined,
    voucher_metadata: undefined,
    mint_trace_registry_benchmark_voucher: undefined,
  };
}
/**
 * @name BridgeManifestValidators
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestValidators
 */
export const BridgeManifestValidators = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestValidators",
  encode(message: BridgeManifestValidators, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.host_state_stt !== undefined) {
      BridgeManifestValidator.encode(message.host_state_stt, writer.uint32(10).fork()).ldelim();
    }
    if (message.spend_client !== undefined) {
      BridgeManifestValidator.encode(message.spend_client, writer.uint32(26).fork()).ldelim();
    }
    if (message.spend_connection !== undefined) {
      BridgeManifestValidator.encode(message.spend_connection, writer.uint32(34).fork()).ldelim();
    }
    if (message.spend_channel !== undefined) {
      BridgeManifestSpendChannelValidator.encode(message.spend_channel, writer.uint32(42).fork()).ldelim();
    }
    if (message.spend_transfer_module !== undefined) {
      BridgeManifestValidator.encode(message.spend_transfer_module, writer.uint32(50).fork()).ldelim();
    }
    if (message.verify_proof !== undefined) {
      BridgeManifestValidator.encode(message.verify_proof, writer.uint32(58).fork()).ldelim();
    }
    if (message.mint_client_stt !== undefined) {
      BridgeManifestValidator.encode(message.mint_client_stt, writer.uint32(66).fork()).ldelim();
    }
    if (message.mint_connection_stt !== undefined) {
      BridgeManifestValidator.encode(message.mint_connection_stt, writer.uint32(74).fork()).ldelim();
    }
    if (message.mint_channel_stt !== undefined) {
      BridgeManifestValidator.encode(message.mint_channel_stt, writer.uint32(82).fork()).ldelim();
    }
    if (message.mint_voucher !== undefined) {
      BridgeManifestValidator.encode(message.mint_voucher, writer.uint32(90).fork()).ldelim();
    }
    if (message.mint_lifecycle_creation_marker !== undefined) {
      BridgeManifestValidator.encode(
        message.mint_lifecycle_creation_marker,
        writer.uint32(98).fork(),
      ).ldelim();
    }
    if (message.mint_lifecycle_reclamation_marker !== undefined) {
      BridgeManifestValidator.encode(
        message.mint_lifecycle_reclamation_marker,
        writer.uint32(106).fork(),
      ).ldelim();
    }
    if (message.mint_lifecycle_operational_marker !== undefined) {
      BridgeManifestValidator.encode(
        message.mint_lifecycle_operational_marker,
        writer.uint32(114).fork(),
      ).ldelim();
    }
    if (message.mint_lifecycle_packet_marker !== undefined) {
      BridgeManifestValidator.encode(
        message.mint_lifecycle_packet_marker,
        writer.uint32(122).fork(),
      ).ldelim();
    }
    if (message.spend_mock_module !== undefined) {
      BridgeManifestValidator.encode(message.spend_mock_module, writer.uint32(130).fork()).ldelim();
    }
    if (message.spend_trace_registry !== undefined) {
      BridgeManifestValidator.encode(message.spend_trace_registry, writer.uint32(138).fork()).ldelim();
    }
    if (message.mint_identifier !== undefined) {
      BridgeManifestValidator.encode(message.mint_identifier, writer.uint32(146).fork()).ldelim();
    }
    if (message.mint_transfer_escrow_shard !== undefined) {
      BridgeManifestValidator.encode(message.mint_transfer_escrow_shard, writer.uint32(154).fork()).ldelim();
    }
    if (message.mint_port !== undefined) {
      BridgeManifestValidator.encode(message.mint_port, writer.uint32(162).fork()).ldelim();
    }
    if (message.voucher_metadata !== undefined) {
      BridgeManifestVoucherMetadata.encode(message.voucher_metadata, writer.uint32(170).fork()).ldelim();
    }
    if (message.mint_trace_registry_benchmark_voucher !== undefined) {
      BridgeManifestValidator.encode(
        message.mint_trace_registry_benchmark_voucher,
        writer.uint32(178).fork(),
      ).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestValidators {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestValidators();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.host_state_stt = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 3:
          message.spend_client = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 4:
          message.spend_connection = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 5:
          message.spend_channel = BridgeManifestSpendChannelValidator.decode(reader, reader.uint32());
          break;
        case 6:
          message.spend_transfer_module = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 7:
          message.verify_proof = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 8:
          message.mint_client_stt = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 9:
          message.mint_connection_stt = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 10:
          message.mint_channel_stt = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 11:
          message.mint_voucher = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 12:
          message.mint_lifecycle_creation_marker = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 13:
          message.mint_lifecycle_reclamation_marker = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 14:
          message.mint_lifecycle_operational_marker = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 15:
          message.mint_lifecycle_packet_marker = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 16:
          message.spend_mock_module = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 17:
          message.spend_trace_registry = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 18:
          message.mint_identifier = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 19:
          message.mint_transfer_escrow_shard = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 20:
          message.mint_port = BridgeManifestValidator.decode(reader, reader.uint32());
          break;
        case 21:
          message.voucher_metadata = BridgeManifestVoucherMetadata.decode(reader, reader.uint32());
          break;
        case 22:
          message.mint_trace_registry_benchmark_voucher = BridgeManifestValidator.decode(
            reader,
            reader.uint32(),
          );
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestValidators {
    const obj = createBaseBridgeManifestValidators();
    if (isSet(object.host_state_stt))
      obj.host_state_stt = BridgeManifestValidator.fromJSON(object.host_state_stt);
    if (isSet(object.spend_client)) obj.spend_client = BridgeManifestValidator.fromJSON(object.spend_client);
    if (isSet(object.spend_connection))
      obj.spend_connection = BridgeManifestValidator.fromJSON(object.spend_connection);
    if (isSet(object.spend_channel))
      obj.spend_channel = BridgeManifestSpendChannelValidator.fromJSON(object.spend_channel);
    if (isSet(object.spend_transfer_module))
      obj.spend_transfer_module = BridgeManifestValidator.fromJSON(object.spend_transfer_module);
    if (isSet(object.verify_proof)) obj.verify_proof = BridgeManifestValidator.fromJSON(object.verify_proof);
    if (isSet(object.mint_client_stt))
      obj.mint_client_stt = BridgeManifestValidator.fromJSON(object.mint_client_stt);
    if (isSet(object.mint_connection_stt))
      obj.mint_connection_stt = BridgeManifestValidator.fromJSON(object.mint_connection_stt);
    if (isSet(object.mint_channel_stt))
      obj.mint_channel_stt = BridgeManifestValidator.fromJSON(object.mint_channel_stt);
    if (isSet(object.mint_voucher)) obj.mint_voucher = BridgeManifestValidator.fromJSON(object.mint_voucher);
    if (isSet(object.mint_lifecycle_creation_marker))
      obj.mint_lifecycle_creation_marker = BridgeManifestValidator.fromJSON(
        object.mint_lifecycle_creation_marker,
      );
    if (isSet(object.mint_lifecycle_reclamation_marker))
      obj.mint_lifecycle_reclamation_marker = BridgeManifestValidator.fromJSON(
        object.mint_lifecycle_reclamation_marker,
      );
    if (isSet(object.mint_lifecycle_operational_marker))
      obj.mint_lifecycle_operational_marker = BridgeManifestValidator.fromJSON(
        object.mint_lifecycle_operational_marker,
      );
    if (isSet(object.mint_lifecycle_packet_marker))
      obj.mint_lifecycle_packet_marker = BridgeManifestValidator.fromJSON(
        object.mint_lifecycle_packet_marker,
      );
    if (isSet(object.spend_mock_module))
      obj.spend_mock_module = BridgeManifestValidator.fromJSON(object.spend_mock_module);
    if (isSet(object.spend_trace_registry))
      obj.spend_trace_registry = BridgeManifestValidator.fromJSON(object.spend_trace_registry);
    if (isSet(object.mint_identifier))
      obj.mint_identifier = BridgeManifestValidator.fromJSON(object.mint_identifier);
    if (isSet(object.mint_transfer_escrow_shard))
      obj.mint_transfer_escrow_shard = BridgeManifestValidator.fromJSON(object.mint_transfer_escrow_shard);
    if (isSet(object.mint_port)) obj.mint_port = BridgeManifestValidator.fromJSON(object.mint_port);
    if (isSet(object.voucher_metadata))
      obj.voucher_metadata = BridgeManifestVoucherMetadata.fromJSON(object.voucher_metadata);
    if (isSet(object.mint_trace_registry_benchmark_voucher))
      obj.mint_trace_registry_benchmark_voucher = BridgeManifestValidator.fromJSON(
        object.mint_trace_registry_benchmark_voucher,
      );
    return obj;
  },
  toJSON(message: BridgeManifestValidators): unknown {
    const obj: any = {};
    message.host_state_stt !== undefined &&
      (obj.host_state_stt = message.host_state_stt
        ? BridgeManifestValidator.toJSON(message.host_state_stt)
        : undefined);
    message.spend_client !== undefined &&
      (obj.spend_client = message.spend_client
        ? BridgeManifestValidator.toJSON(message.spend_client)
        : undefined);
    message.spend_connection !== undefined &&
      (obj.spend_connection = message.spend_connection
        ? BridgeManifestValidator.toJSON(message.spend_connection)
        : undefined);
    message.spend_channel !== undefined &&
      (obj.spend_channel = message.spend_channel
        ? BridgeManifestSpendChannelValidator.toJSON(message.spend_channel)
        : undefined);
    message.spend_transfer_module !== undefined &&
      (obj.spend_transfer_module = message.spend_transfer_module
        ? BridgeManifestValidator.toJSON(message.spend_transfer_module)
        : undefined);
    message.verify_proof !== undefined &&
      (obj.verify_proof = message.verify_proof
        ? BridgeManifestValidator.toJSON(message.verify_proof)
        : undefined);
    message.mint_client_stt !== undefined &&
      (obj.mint_client_stt = message.mint_client_stt
        ? BridgeManifestValidator.toJSON(message.mint_client_stt)
        : undefined);
    message.mint_connection_stt !== undefined &&
      (obj.mint_connection_stt = message.mint_connection_stt
        ? BridgeManifestValidator.toJSON(message.mint_connection_stt)
        : undefined);
    message.mint_channel_stt !== undefined &&
      (obj.mint_channel_stt = message.mint_channel_stt
        ? BridgeManifestValidator.toJSON(message.mint_channel_stt)
        : undefined);
    message.mint_voucher !== undefined &&
      (obj.mint_voucher = message.mint_voucher
        ? BridgeManifestValidator.toJSON(message.mint_voucher)
        : undefined);
    message.mint_lifecycle_creation_marker !== undefined &&
      (obj.mint_lifecycle_creation_marker = message.mint_lifecycle_creation_marker
        ? BridgeManifestValidator.toJSON(message.mint_lifecycle_creation_marker)
        : undefined);
    message.mint_lifecycle_reclamation_marker !== undefined &&
      (obj.mint_lifecycle_reclamation_marker = message.mint_lifecycle_reclamation_marker
        ? BridgeManifestValidator.toJSON(message.mint_lifecycle_reclamation_marker)
        : undefined);
    message.mint_lifecycle_operational_marker !== undefined &&
      (obj.mint_lifecycle_operational_marker = message.mint_lifecycle_operational_marker
        ? BridgeManifestValidator.toJSON(message.mint_lifecycle_operational_marker)
        : undefined);
    message.mint_lifecycle_packet_marker !== undefined &&
      (obj.mint_lifecycle_packet_marker = message.mint_lifecycle_packet_marker
        ? BridgeManifestValidator.toJSON(message.mint_lifecycle_packet_marker)
        : undefined);
    message.spend_mock_module !== undefined &&
      (obj.spend_mock_module = message.spend_mock_module
        ? BridgeManifestValidator.toJSON(message.spend_mock_module)
        : undefined);
    message.spend_trace_registry !== undefined &&
      (obj.spend_trace_registry = message.spend_trace_registry
        ? BridgeManifestValidator.toJSON(message.spend_trace_registry)
        : undefined);
    message.mint_identifier !== undefined &&
      (obj.mint_identifier = message.mint_identifier
        ? BridgeManifestValidator.toJSON(message.mint_identifier)
        : undefined);
    message.mint_transfer_escrow_shard !== undefined &&
      (obj.mint_transfer_escrow_shard = message.mint_transfer_escrow_shard
        ? BridgeManifestValidator.toJSON(message.mint_transfer_escrow_shard)
        : undefined);
    message.mint_port !== undefined &&
      (obj.mint_port = message.mint_port ? BridgeManifestValidator.toJSON(message.mint_port) : undefined);
    message.voucher_metadata !== undefined &&
      (obj.voucher_metadata = message.voucher_metadata
        ? BridgeManifestVoucherMetadata.toJSON(message.voucher_metadata)
        : undefined);
    message.mint_trace_registry_benchmark_voucher !== undefined &&
      (obj.mint_trace_registry_benchmark_voucher = message.mint_trace_registry_benchmark_voucher
        ? BridgeManifestValidator.toJSON(message.mint_trace_registry_benchmark_voucher)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestValidators>, I>>(
    object: I,
  ): BridgeManifestValidators {
    const message = createBaseBridgeManifestValidators();
    if (object.host_state_stt !== undefined && object.host_state_stt !== null) {
      message.host_state_stt = BridgeManifestValidator.fromPartial(object.host_state_stt);
    }
    if (object.spend_client !== undefined && object.spend_client !== null) {
      message.spend_client = BridgeManifestValidator.fromPartial(object.spend_client);
    }
    if (object.spend_connection !== undefined && object.spend_connection !== null) {
      message.spend_connection = BridgeManifestValidator.fromPartial(object.spend_connection);
    }
    if (object.spend_channel !== undefined && object.spend_channel !== null) {
      message.spend_channel = BridgeManifestSpendChannelValidator.fromPartial(object.spend_channel);
    }
    if (object.spend_transfer_module !== undefined && object.spend_transfer_module !== null) {
      message.spend_transfer_module = BridgeManifestValidator.fromPartial(object.spend_transfer_module);
    }
    if (object.verify_proof !== undefined && object.verify_proof !== null) {
      message.verify_proof = BridgeManifestValidator.fromPartial(object.verify_proof);
    }
    if (object.mint_client_stt !== undefined && object.mint_client_stt !== null) {
      message.mint_client_stt = BridgeManifestValidator.fromPartial(object.mint_client_stt);
    }
    if (object.mint_connection_stt !== undefined && object.mint_connection_stt !== null) {
      message.mint_connection_stt = BridgeManifestValidator.fromPartial(object.mint_connection_stt);
    }
    if (object.mint_channel_stt !== undefined && object.mint_channel_stt !== null) {
      message.mint_channel_stt = BridgeManifestValidator.fromPartial(object.mint_channel_stt);
    }
    if (object.mint_voucher !== undefined && object.mint_voucher !== null) {
      message.mint_voucher = BridgeManifestValidator.fromPartial(object.mint_voucher);
    }
    if (
      object.mint_lifecycle_creation_marker !== undefined &&
      object.mint_lifecycle_creation_marker !== null
    ) {
      message.mint_lifecycle_creation_marker = BridgeManifestValidator.fromPartial(
        object.mint_lifecycle_creation_marker,
      );
    }
    if (
      object.mint_lifecycle_reclamation_marker !== undefined &&
      object.mint_lifecycle_reclamation_marker !== null
    ) {
      message.mint_lifecycle_reclamation_marker = BridgeManifestValidator.fromPartial(
        object.mint_lifecycle_reclamation_marker,
      );
    }
    if (
      object.mint_lifecycle_operational_marker !== undefined &&
      object.mint_lifecycle_operational_marker !== null
    ) {
      message.mint_lifecycle_operational_marker = BridgeManifestValidator.fromPartial(
        object.mint_lifecycle_operational_marker,
      );
    }
    if (object.mint_lifecycle_packet_marker !== undefined && object.mint_lifecycle_packet_marker !== null) {
      message.mint_lifecycle_packet_marker = BridgeManifestValidator.fromPartial(
        object.mint_lifecycle_packet_marker,
      );
    }
    if (object.spend_mock_module !== undefined && object.spend_mock_module !== null) {
      message.spend_mock_module = BridgeManifestValidator.fromPartial(object.spend_mock_module);
    }
    if (object.spend_trace_registry !== undefined && object.spend_trace_registry !== null) {
      message.spend_trace_registry = BridgeManifestValidator.fromPartial(object.spend_trace_registry);
    }
    if (object.mint_identifier !== undefined && object.mint_identifier !== null) {
      message.mint_identifier = BridgeManifestValidator.fromPartial(object.mint_identifier);
    }
    if (object.mint_transfer_escrow_shard !== undefined && object.mint_transfer_escrow_shard !== null) {
      message.mint_transfer_escrow_shard = BridgeManifestValidator.fromPartial(
        object.mint_transfer_escrow_shard,
      );
    }
    if (object.mint_port !== undefined && object.mint_port !== null) {
      message.mint_port = BridgeManifestValidator.fromPartial(object.mint_port);
    }
    if (object.voucher_metadata !== undefined && object.voucher_metadata !== null) {
      message.voucher_metadata = BridgeManifestVoucherMetadata.fromPartial(object.voucher_metadata);
    }
    if (
      object.mint_trace_registry_benchmark_voucher !== undefined &&
      object.mint_trace_registry_benchmark_voucher !== null
    ) {
      message.mint_trace_registry_benchmark_voucher = BridgeManifestValidator.fromPartial(
        object.mint_trace_registry_benchmark_voucher,
      );
    }
    return message;
  },
};
function createBaseBridgeManifestVoucherMetadata(): BridgeManifestVoucherMetadata {
  return {
    address: "",
  };
}
/**
 * @name BridgeManifestVoucherMetadata
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestVoucherMetadata
 */
export const BridgeManifestVoucherMetadata = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestVoucherMetadata",
  encode(message: BridgeManifestVoucherMetadata, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestVoucherMetadata {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestVoucherMetadata();
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
  fromJSON(object: any): BridgeManifestVoucherMetadata {
    const obj = createBaseBridgeManifestVoucherMetadata();
    if (isSet(object.address)) obj.address = String(object.address);
    return obj;
  },
  toJSON(message: BridgeManifestVoucherMetadata): unknown {
    const obj: any = {};
    message.address !== undefined && (obj.address = message.address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestVoucherMetadata>, I>>(
    object: I,
  ): BridgeManifestVoucherMetadata {
    const message = createBaseBridgeManifestVoucherMetadata();
    message.address = object.address ?? "";
    return message;
  },
};
function createBaseBridgeManifestModule(): BridgeManifestModule {
  return {
    identifier: "",
    address: "",
  };
}
/**
 * @name BridgeManifestModule
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestModule
 */
export const BridgeManifestModule = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestModule",
  encode(message: BridgeManifestModule, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.identifier !== "") {
      writer.uint32(10).string(message.identifier);
    }
    if (message.address !== "") {
      writer.uint32(18).string(message.address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestModule {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestModule();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.identifier = reader.string();
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
  fromJSON(object: any): BridgeManifestModule {
    const obj = createBaseBridgeManifestModule();
    if (isSet(object.identifier)) obj.identifier = String(object.identifier);
    if (isSet(object.address)) obj.address = String(object.address);
    return obj;
  },
  toJSON(message: BridgeManifestModule): unknown {
    const obj: any = {};
    message.identifier !== undefined && (obj.identifier = message.identifier);
    message.address !== undefined && (obj.address = message.address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestModule>, I>>(object: I): BridgeManifestModule {
    const message = createBaseBridgeManifestModule();
    message.identifier = object.identifier ?? "";
    message.address = object.address ?? "";
    return message;
  },
};
function createBaseBridgeManifestModules(): BridgeManifestModules {
  return {
    transfer: undefined,
    mock: undefined,
    icq: undefined,
  };
}
/**
 * @name BridgeManifestModules
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestModules
 */
export const BridgeManifestModules = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestModules",
  encode(message: BridgeManifestModules, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.transfer !== undefined) {
      BridgeManifestModule.encode(message.transfer, writer.uint32(18).fork()).ldelim();
    }
    if (message.mock !== undefined) {
      BridgeManifestModule.encode(message.mock, writer.uint32(26).fork()).ldelim();
    }
    if (message.icq !== undefined) {
      BridgeManifestModule.encode(message.icq, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestModules {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestModules();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 2:
          message.transfer = BridgeManifestModule.decode(reader, reader.uint32());
          break;
        case 3:
          message.mock = BridgeManifestModule.decode(reader, reader.uint32());
          break;
        case 4:
          message.icq = BridgeManifestModule.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestModules {
    const obj = createBaseBridgeManifestModules();
    if (isSet(object.transfer)) obj.transfer = BridgeManifestModule.fromJSON(object.transfer);
    if (isSet(object.mock)) obj.mock = BridgeManifestModule.fromJSON(object.mock);
    if (isSet(object.icq)) obj.icq = BridgeManifestModule.fromJSON(object.icq);
    return obj;
  },
  toJSON(message: BridgeManifestModules): unknown {
    const obj: any = {};
    message.transfer !== undefined &&
      (obj.transfer = message.transfer ? BridgeManifestModule.toJSON(message.transfer) : undefined);
    message.mock !== undefined &&
      (obj.mock = message.mock ? BridgeManifestModule.toJSON(message.mock) : undefined);
    message.icq !== undefined &&
      (obj.icq = message.icq ? BridgeManifestModule.toJSON(message.icq) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestModules>, I>>(object: I): BridgeManifestModules {
    const message = createBaseBridgeManifestModules();
    if (object.transfer !== undefined && object.transfer !== null) {
      message.transfer = BridgeManifestModule.fromPartial(object.transfer);
    }
    if (object.mock !== undefined && object.mock !== null) {
      message.mock = BridgeManifestModule.fromPartial(object.mock);
    }
    if (object.icq !== undefined && object.icq !== null) {
      message.icq = BridgeManifestModule.fromPartial(object.icq);
    }
    return message;
  },
};
function createBaseBridgeManifestTraceRegistryShard(): BridgeManifestTraceRegistryShard {
  return {
    policy_id: "",
    token_name: "",
  };
}
/**
 * @name BridgeManifestTraceRegistryShard
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestTraceRegistryShard
 */
export const BridgeManifestTraceRegistryShard = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestTraceRegistryShard",
  encode(
    message: BridgeManifestTraceRegistryShard,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.policy_id !== "") {
      writer.uint32(10).string(message.policy_id);
    }
    if (message.token_name !== "") {
      writer.uint32(18).string(message.token_name);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestTraceRegistryShard {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestTraceRegistryShard();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.policy_id = reader.string();
          break;
        case 2:
          message.token_name = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestTraceRegistryShard {
    const obj = createBaseBridgeManifestTraceRegistryShard();
    if (isSet(object.policy_id)) obj.policy_id = String(object.policy_id);
    if (isSet(object.token_name)) obj.token_name = String(object.token_name);
    return obj;
  },
  toJSON(message: BridgeManifestTraceRegistryShard): unknown {
    const obj: any = {};
    message.policy_id !== undefined && (obj.policy_id = message.policy_id);
    message.token_name !== undefined && (obj.token_name = message.token_name);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestTraceRegistryShard>, I>>(
    object: I,
  ): BridgeManifestTraceRegistryShard {
    const message = createBaseBridgeManifestTraceRegistryShard();
    message.policy_id = object.policy_id ?? "";
    message.token_name = object.token_name ?? "";
    return message;
  },
};
function createBaseBridgeManifestTraceRegistry(): BridgeManifestTraceRegistry {
  return {
    address: "",
    shard_policy_id: "",
    directory: undefined,
  };
}
/**
 * @name BridgeManifestTraceRegistry
 * @package ibc.cardano.v1
 * @see proto type: ibc.cardano.v1.BridgeManifestTraceRegistry
 */
export const BridgeManifestTraceRegistry = {
  typeUrl: "/ibc.cardano.v1.BridgeManifestTraceRegistry",
  encode(message: BridgeManifestTraceRegistry, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    if (message.shard_policy_id !== "") {
      writer.uint32(18).string(message.shard_policy_id);
    }
    if (message.directory !== undefined) {
      BridgeManifestTraceRegistryShard.encode(message.directory, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): BridgeManifestTraceRegistry {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseBridgeManifestTraceRegistry();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.address = reader.string();
          break;
        case 2:
          message.shard_policy_id = reader.string();
          break;
        case 3:
          message.directory = BridgeManifestTraceRegistryShard.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): BridgeManifestTraceRegistry {
    const obj = createBaseBridgeManifestTraceRegistry();
    if (isSet(object.address)) obj.address = String(object.address);
    if (isSet(object.shard_policy_id)) obj.shard_policy_id = String(object.shard_policy_id);
    if (isSet(object.directory)) obj.directory = BridgeManifestTraceRegistryShard.fromJSON(object.directory);
    return obj;
  },
  toJSON(message: BridgeManifestTraceRegistry): unknown {
    const obj: any = {};
    message.address !== undefined && (obj.address = message.address);
    message.shard_policy_id !== undefined && (obj.shard_policy_id = message.shard_policy_id);
    message.directory !== undefined &&
      (obj.directory = message.directory
        ? BridgeManifestTraceRegistryShard.toJSON(message.directory)
        : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<BridgeManifestTraceRegistry>, I>>(
    object: I,
  ): BridgeManifestTraceRegistry {
    const message = createBaseBridgeManifestTraceRegistry();
    message.address = object.address ?? "";
    message.shard_policy_id = object.shard_policy_id ?? "";
    if (object.directory !== undefined && object.directory !== null) {
      message.directory = BridgeManifestTraceRegistryShard.fromPartial(object.directory);
    }
    return message;
  },
};
/** Query provides defines the gRPC querier service for Cardano-specific queries */
export interface Query {
  /** Events queries IBC events from Cardano blocks since a given height */
  Events(request: QueryEventsRequest): Promise<QueryEventsResponse>;
  /**
   * BridgeManifest returns the public deployment manifest required to bootstrap
   * an independent Gateway/relayer stack against this Cardano bridge deployment.
   */
  BridgeManifest(request?: QueryBridgeManifestRequest): Promise<QueryBridgeManifestResponse>;
}
export class QueryClientImpl implements Query {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.Events = this.Events.bind(this);
    this.BridgeManifest = this.BridgeManifest.bind(this);
  }
  Events(request: QueryEventsRequest): Promise<QueryEventsResponse> {
    const data = QueryEventsRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.cardano.v1.Query", "Events", data);
    return promise.then((data) => QueryEventsResponse.decode(new BinaryReader(data)));
  }
  BridgeManifest(request: QueryBridgeManifestRequest = {}): Promise<QueryBridgeManifestResponse> {
    const data = QueryBridgeManifestRequest.encode(request).finish();
    const promise = this.rpc.request("ibc.cardano.v1.Query", "BridgeManifest", data);
    return promise.then((data) => QueryBridgeManifestResponse.decode(new BinaryReader(data)));
  }
}
export const createClientImpl = (rpc: Rpc) => {
  return new QueryClientImpl(rpc);
};
