/* eslint-disable */
import { IdentifiedClientState, ClientConsensusStates, Params } from "./client";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes } from "../../../../helpers";
export const protobufPackage = "ibc.core.client.v1";
/** GenesisState defines the ibc client submodule's genesis state. */
export interface GenesisState {
  /** client states with their corresponding identifiers */
  clients: IdentifiedClientState[];
  /** consensus states from each client */
  clients_consensus: ClientConsensusStates[];
  /** metadata from each client */
  clients_metadata: IdentifiedGenesisMetadata[];
  params: Params;
  /** create localhost on initialization */
  create_localhost: boolean;
  /** the sequence for the next generated client identifier */
  next_client_sequence: bigint;
}
/**
 * GenesisMetadata defines the genesis type for metadata that clients may return
 * with ExportMetadata
 */
export interface GenesisMetadata {
  /** store key of metadata without clientID-prefix */
  key: Uint8Array;
  /** metadata value */
  value: Uint8Array;
}
/**
 * IdentifiedGenesisMetadata has the client metadata with the corresponding
 * client id.
 */
export interface IdentifiedGenesisMetadata {
  client_id: string;
  client_metadata: GenesisMetadata[];
}
function createBaseGenesisState(): GenesisState {
  return {
    clients: [],
    clients_consensus: [],
    clients_metadata: [],
    params: Params.fromPartial({}),
    create_localhost: false,
    next_client_sequence: BigInt(0),
  };
}
export const GenesisState = {
  typeUrl: "/ibc.core.client.v1.GenesisState",
  encode(message: GenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.clients) {
      IdentifiedClientState.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.clients_consensus) {
      ClientConsensusStates.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.clients_metadata) {
      IdentifiedGenesisMetadata.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    if (message.params !== undefined) {
      Params.encode(message.params, writer.uint32(34).fork()).ldelim();
    }
    if (message.create_localhost === true) {
      writer.uint32(40).bool(message.create_localhost);
    }
    if (message.next_client_sequence !== BigInt(0)) {
      writer.uint32(48).uint64(message.next_client_sequence);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): GenesisState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGenesisState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.clients.push(IdentifiedClientState.decode(reader, reader.uint32()));
          break;
        case 2:
          message.clients_consensus.push(ClientConsensusStates.decode(reader, reader.uint32()));
          break;
        case 3:
          message.clients_metadata.push(IdentifiedGenesisMetadata.decode(reader, reader.uint32()));
          break;
        case 4:
          message.params = Params.decode(reader, reader.uint32());
          break;
        case 5:
          message.create_localhost = reader.bool();
          break;
        case 6:
          message.next_client_sequence = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): GenesisState {
    const obj = createBaseGenesisState();
    if (Array.isArray(object?.clients))
      obj.clients = object.clients.map((e: any) => IdentifiedClientState.fromJSON(e));
    if (Array.isArray(object?.clients_consensus))
      obj.clients_consensus = object.clients_consensus.map((e: any) => ClientConsensusStates.fromJSON(e));
    if (Array.isArray(object?.clients_metadata))
      obj.clients_metadata = object.clients_metadata.map((e: any) => IdentifiedGenesisMetadata.fromJSON(e));
    if (isSet(object.params)) obj.params = Params.fromJSON(object.params);
    if (isSet(object.create_localhost)) obj.create_localhost = Boolean(object.create_localhost);
    if (isSet(object.next_client_sequence))
      obj.next_client_sequence = BigInt(object.next_client_sequence.toString());
    return obj;
  },
  toJSON(message: GenesisState): unknown {
    const obj: any = {};
    if (message.clients) {
      obj.clients = message.clients.map((e) => (e ? IdentifiedClientState.toJSON(e) : undefined));
    } else {
      obj.clients = [];
    }
    if (message.clients_consensus) {
      obj.clients_consensus = message.clients_consensus.map((e) =>
        e ? ClientConsensusStates.toJSON(e) : undefined,
      );
    } else {
      obj.clients_consensus = [];
    }
    if (message.clients_metadata) {
      obj.clients_metadata = message.clients_metadata.map((e) =>
        e ? IdentifiedGenesisMetadata.toJSON(e) : undefined,
      );
    } else {
      obj.clients_metadata = [];
    }
    message.params !== undefined && (obj.params = message.params ? Params.toJSON(message.params) : undefined);
    message.create_localhost !== undefined && (obj.create_localhost = message.create_localhost);
    message.next_client_sequence !== undefined &&
      (obj.next_client_sequence = (message.next_client_sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisState>, I>>(object: I): GenesisState {
    const message = createBaseGenesisState();
    message.clients = object.clients?.map((e) => IdentifiedClientState.fromPartial(e)) || [];
    message.clients_consensus =
      object.clients_consensus?.map((e) => ClientConsensusStates.fromPartial(e)) || [];
    message.clients_metadata =
      object.clients_metadata?.map((e) => IdentifiedGenesisMetadata.fromPartial(e)) || [];
    if (object.params !== undefined && object.params !== null) {
      message.params = Params.fromPartial(object.params);
    }
    message.create_localhost = object.create_localhost ?? false;
    if (object.next_client_sequence !== undefined && object.next_client_sequence !== null) {
      message.next_client_sequence = BigInt(object.next_client_sequence.toString());
    }
    return message;
  },
};
function createBaseGenesisMetadata(): GenesisMetadata {
  return {
    key: new Uint8Array(),
    value: new Uint8Array(),
  };
}
export const GenesisMetadata = {
  typeUrl: "/ibc.core.client.v1.GenesisMetadata",
  encode(message: GenesisMetadata, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.key.length !== 0) {
      writer.uint32(10).bytes(message.key);
    }
    if (message.value.length !== 0) {
      writer.uint32(18).bytes(message.value);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): GenesisMetadata {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGenesisMetadata();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.key = reader.bytes();
          break;
        case 2:
          message.value = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): GenesisMetadata {
    const obj = createBaseGenesisMetadata();
    if (isSet(object.key)) obj.key = bytesFromBase64(object.key);
    if (isSet(object.value)) obj.value = bytesFromBase64(object.value);
    return obj;
  },
  toJSON(message: GenesisMetadata): unknown {
    const obj: any = {};
    message.key !== undefined &&
      (obj.key = base64FromBytes(message.key !== undefined ? message.key : new Uint8Array()));
    message.value !== undefined &&
      (obj.value = base64FromBytes(message.value !== undefined ? message.value : new Uint8Array()));
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisMetadata>, I>>(object: I): GenesisMetadata {
    const message = createBaseGenesisMetadata();
    message.key = object.key ?? new Uint8Array();
    message.value = object.value ?? new Uint8Array();
    return message;
  },
};
function createBaseIdentifiedGenesisMetadata(): IdentifiedGenesisMetadata {
  return {
    client_id: "",
    client_metadata: [],
  };
}
export const IdentifiedGenesisMetadata = {
  typeUrl: "/ibc.core.client.v1.IdentifiedGenesisMetadata",
  encode(message: IdentifiedGenesisMetadata, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    for (const v of message.client_metadata) {
      GenesisMetadata.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): IdentifiedGenesisMetadata {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseIdentifiedGenesisMetadata();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.client_metadata.push(GenesisMetadata.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): IdentifiedGenesisMetadata {
    const obj = createBaseIdentifiedGenesisMetadata();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (Array.isArray(object?.client_metadata))
      obj.client_metadata = object.client_metadata.map((e: any) => GenesisMetadata.fromJSON(e));
    return obj;
  },
  toJSON(message: IdentifiedGenesisMetadata): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    if (message.client_metadata) {
      obj.client_metadata = message.client_metadata.map((e) => (e ? GenesisMetadata.toJSON(e) : undefined));
    } else {
      obj.client_metadata = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<IdentifiedGenesisMetadata>, I>>(
    object: I,
  ): IdentifiedGenesisMetadata {
    const message = createBaseIdentifiedGenesisMetadata();
    message.client_id = object.client_id ?? "";
    message.client_metadata = object.client_metadata?.map((e) => GenesisMetadata.fromPartial(e)) || [];
    return message;
  },
};
