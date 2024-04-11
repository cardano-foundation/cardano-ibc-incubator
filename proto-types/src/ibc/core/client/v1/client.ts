/* eslint-disable */
import { Any } from "../../../../google/protobuf/any";
import { Plan } from "../../../../cosmos/upgrade/v1beta1/upgrade";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.core.client.v1";
/**
 * IdentifiedClientState defines a client state with an additional client
 * identifier field.
 */
export interface IdentifiedClientState {
  /** client identifier */
  client_id: string;
  /** client state */
  client_state?: Any;
}
/**
 * ConsensusStateWithHeight defines a consensus state with an additional height
 * field.
 */
export interface ConsensusStateWithHeight {
  /** consensus state height */
  height: Height;
  /** consensus state */
  consensus_state?: Any;
}
/**
 * ClientConsensusStates defines all the stored consensus states for a given
 * client.
 */
export interface ClientConsensusStates {
  /** client identifier */
  client_id: string;
  /** consensus states and their heights associated with the client */
  consensus_states: ConsensusStateWithHeight[];
}
/**
 * ClientUpdateProposal is a governance proposal. If it passes, the substitute
 * client's latest consensus state is copied over to the subject client. The proposal
 * handler may fail if the subject and the substitute do not match in client and
 * chain parameters (with exception to latest height, frozen height, and chain-id).
 */
export interface ClientUpdateProposal {
  /** the title of the update proposal */
  title: string;
  /** the description of the proposal */
  description: string;
  /** the client identifier for the client to be updated if the proposal passes */
  subject_client_id: string;
  /**
   * the substitute client identifier for the client standing in for the subject
   * client
   */
  substitute_client_id: string;
}
/**
 * UpgradeProposal is a gov Content type for initiating an IBC breaking
 * upgrade.
 */
export interface UpgradeProposal {
  title: string;
  description: string;
  plan: Plan;
  /**
   * An UpgradedClientState must be provided to perform an IBC breaking upgrade.
   * This will make the chain commit to the correct upgraded (self) client state
   * before the upgrade occurs, so that connecting chains can verify that the
   * new upgraded client is valid by verifying a proof on the previous version
   * of the chain. This will allow IBC connections to persist smoothly across
   * planned chain upgrades
   */
  upgraded_client_state?: Any;
}
/**
 * Height is a monotonically increasing data type
 * that can be compared against another Height for the purposes of updating and
 * freezing clients
 * 
 * Normally the RevisionHeight is incremented at each height while keeping
 * RevisionNumber the same. However some consensus algorithms may choose to
 * reset the height in certain conditions e.g. hard forks, state-machine
 * breaking changes In these cases, the RevisionNumber is incremented so that
 * height continues to be monitonically increasing even as the RevisionHeight
 * gets reset
 */
export interface Height {
  /** the revision that the client is currently on */
  revision_number: bigint;
  /** the height within the given revision */
  revision_height: bigint;
}
/** Params defines the set of IBC light client parameters. */
export interface Params {
  /** allowed_clients defines the list of allowed client state types. */
  allowed_clients: string[];
}
function createBaseIdentifiedClientState(): IdentifiedClientState {
  return {
    client_id: "",
    client_state: undefined
  };
}
export const IdentifiedClientState = {
  typeUrl: "/ibc.core.client.v1.IdentifiedClientState",
  encode(message: IdentifiedClientState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.client_state !== undefined) {
      Any.encode(message.client_state, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): IdentifiedClientState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseIdentifiedClientState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.client_state = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): IdentifiedClientState {
    const obj = createBaseIdentifiedClientState();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.client_state)) obj.client_state = Any.fromJSON(object.client_state);
    return obj;
  },
  toJSON(message: IdentifiedClientState): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.client_state !== undefined && (obj.client_state = message.client_state ? Any.toJSON(message.client_state) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<IdentifiedClientState>, I>>(object: I): IdentifiedClientState {
    const message = createBaseIdentifiedClientState();
    message.client_id = object.client_id ?? "";
    if (object.client_state !== undefined && object.client_state !== null) {
      message.client_state = Any.fromPartial(object.client_state);
    }
    return message;
  }
};
function createBaseConsensusStateWithHeight(): ConsensusStateWithHeight {
  return {
    height: Height.fromPartial({}),
    consensus_state: undefined
  };
}
export const ConsensusStateWithHeight = {
  typeUrl: "/ibc.core.client.v1.ConsensusStateWithHeight",
  encode(message: ConsensusStateWithHeight, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.height !== undefined) {
      Height.encode(message.height, writer.uint32(10).fork()).ldelim();
    }
    if (message.consensus_state !== undefined) {
      Any.encode(message.consensus_state, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ConsensusStateWithHeight {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseConsensusStateWithHeight();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.height = Height.decode(reader, reader.uint32());
          break;
        case 2:
          message.consensus_state = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ConsensusStateWithHeight {
    const obj = createBaseConsensusStateWithHeight();
    if (isSet(object.height)) obj.height = Height.fromJSON(object.height);
    if (isSet(object.consensus_state)) obj.consensus_state = Any.fromJSON(object.consensus_state);
    return obj;
  },
  toJSON(message: ConsensusStateWithHeight): unknown {
    const obj: any = {};
    message.height !== undefined && (obj.height = message.height ? Height.toJSON(message.height) : undefined);
    message.consensus_state !== undefined && (obj.consensus_state = message.consensus_state ? Any.toJSON(message.consensus_state) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ConsensusStateWithHeight>, I>>(object: I): ConsensusStateWithHeight {
    const message = createBaseConsensusStateWithHeight();
    if (object.height !== undefined && object.height !== null) {
      message.height = Height.fromPartial(object.height);
    }
    if (object.consensus_state !== undefined && object.consensus_state !== null) {
      message.consensus_state = Any.fromPartial(object.consensus_state);
    }
    return message;
  }
};
function createBaseClientConsensusStates(): ClientConsensusStates {
  return {
    client_id: "",
    consensus_states: []
  };
}
export const ClientConsensusStates = {
  typeUrl: "/ibc.core.client.v1.ClientConsensusStates",
  encode(message: ClientConsensusStates, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    for (const v of message.consensus_states) {
      ConsensusStateWithHeight.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ClientConsensusStates {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseClientConsensusStates();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.consensus_states.push(ConsensusStateWithHeight.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ClientConsensusStates {
    const obj = createBaseClientConsensusStates();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (Array.isArray(object?.consensus_states)) obj.consensus_states = object.consensus_states.map((e: any) => ConsensusStateWithHeight.fromJSON(e));
    return obj;
  },
  toJSON(message: ClientConsensusStates): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    if (message.consensus_states) {
      obj.consensus_states = message.consensus_states.map(e => e ? ConsensusStateWithHeight.toJSON(e) : undefined);
    } else {
      obj.consensus_states = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ClientConsensusStates>, I>>(object: I): ClientConsensusStates {
    const message = createBaseClientConsensusStates();
    message.client_id = object.client_id ?? "";
    message.consensus_states = object.consensus_states?.map(e => ConsensusStateWithHeight.fromPartial(e)) || [];
    return message;
  }
};
function createBaseClientUpdateProposal(): ClientUpdateProposal {
  return {
    title: "",
    description: "",
    subject_client_id: "",
    substitute_client_id: ""
  };
}
export const ClientUpdateProposal = {
  typeUrl: "/ibc.core.client.v1.ClientUpdateProposal",
  encode(message: ClientUpdateProposal, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.title !== "") {
      writer.uint32(10).string(message.title);
    }
    if (message.description !== "") {
      writer.uint32(18).string(message.description);
    }
    if (message.subject_client_id !== "") {
      writer.uint32(26).string(message.subject_client_id);
    }
    if (message.substitute_client_id !== "") {
      writer.uint32(34).string(message.substitute_client_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ClientUpdateProposal {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseClientUpdateProposal();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.title = reader.string();
          break;
        case 2:
          message.description = reader.string();
          break;
        case 3:
          message.subject_client_id = reader.string();
          break;
        case 4:
          message.substitute_client_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ClientUpdateProposal {
    const obj = createBaseClientUpdateProposal();
    if (isSet(object.title)) obj.title = String(object.title);
    if (isSet(object.description)) obj.description = String(object.description);
    if (isSet(object.subject_client_id)) obj.subject_client_id = String(object.subject_client_id);
    if (isSet(object.substitute_client_id)) obj.substitute_client_id = String(object.substitute_client_id);
    return obj;
  },
  toJSON(message: ClientUpdateProposal): unknown {
    const obj: any = {};
    message.title !== undefined && (obj.title = message.title);
    message.description !== undefined && (obj.description = message.description);
    message.subject_client_id !== undefined && (obj.subject_client_id = message.subject_client_id);
    message.substitute_client_id !== undefined && (obj.substitute_client_id = message.substitute_client_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ClientUpdateProposal>, I>>(object: I): ClientUpdateProposal {
    const message = createBaseClientUpdateProposal();
    message.title = object.title ?? "";
    message.description = object.description ?? "";
    message.subject_client_id = object.subject_client_id ?? "";
    message.substitute_client_id = object.substitute_client_id ?? "";
    return message;
  }
};
function createBaseUpgradeProposal(): UpgradeProposal {
  return {
    title: "",
    description: "",
    plan: Plan.fromPartial({}),
    upgraded_client_state: undefined
  };
}
export const UpgradeProposal = {
  typeUrl: "/ibc.core.client.v1.UpgradeProposal",
  encode(message: UpgradeProposal, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.title !== "") {
      writer.uint32(10).string(message.title);
    }
    if (message.description !== "") {
      writer.uint32(18).string(message.description);
    }
    if (message.plan !== undefined) {
      Plan.encode(message.plan, writer.uint32(26).fork()).ldelim();
    }
    if (message.upgraded_client_state !== undefined) {
      Any.encode(message.upgraded_client_state, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): UpgradeProposal {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpgradeProposal();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.title = reader.string();
          break;
        case 2:
          message.description = reader.string();
          break;
        case 3:
          message.plan = Plan.decode(reader, reader.uint32());
          break;
        case 4:
          message.upgraded_client_state = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): UpgradeProposal {
    const obj = createBaseUpgradeProposal();
    if (isSet(object.title)) obj.title = String(object.title);
    if (isSet(object.description)) obj.description = String(object.description);
    if (isSet(object.plan)) obj.plan = Plan.fromJSON(object.plan);
    if (isSet(object.upgraded_client_state)) obj.upgraded_client_state = Any.fromJSON(object.upgraded_client_state);
    return obj;
  },
  toJSON(message: UpgradeProposal): unknown {
    const obj: any = {};
    message.title !== undefined && (obj.title = message.title);
    message.description !== undefined && (obj.description = message.description);
    message.plan !== undefined && (obj.plan = message.plan ? Plan.toJSON(message.plan) : undefined);
    message.upgraded_client_state !== undefined && (obj.upgraded_client_state = message.upgraded_client_state ? Any.toJSON(message.upgraded_client_state) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<UpgradeProposal>, I>>(object: I): UpgradeProposal {
    const message = createBaseUpgradeProposal();
    message.title = object.title ?? "";
    message.description = object.description ?? "";
    if (object.plan !== undefined && object.plan !== null) {
      message.plan = Plan.fromPartial(object.plan);
    }
    if (object.upgraded_client_state !== undefined && object.upgraded_client_state !== null) {
      message.upgraded_client_state = Any.fromPartial(object.upgraded_client_state);
    }
    return message;
  }
};
function createBaseHeight(): Height {
  return {
    revision_number: BigInt(0),
    revision_height: BigInt(0)
  };
}
export const Height = {
  typeUrl: "/ibc.core.client.v1.Height",
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
function createBaseParams(): Params {
  return {
    allowed_clients: []
  };
}
export const Params = {
  typeUrl: "/ibc.core.client.v1.Params",
  encode(message: Params, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.allowed_clients) {
      writer.uint32(10).string(v!);
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
          message.allowed_clients.push(reader.string());
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
    if (Array.isArray(object?.allowed_clients)) obj.allowed_clients = object.allowed_clients.map((e: any) => String(e));
    return obj;
  },
  toJSON(message: Params): unknown {
    const obj: any = {};
    if (message.allowed_clients) {
      obj.allowed_clients = message.allowed_clients.map(e => e);
    } else {
      obj.allowed_clients = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Params>, I>>(object: I): Params {
    const message = createBaseParams();
    message.allowed_clients = object.allowed_clients?.map(e => e) || [];
    return message;
  }
};