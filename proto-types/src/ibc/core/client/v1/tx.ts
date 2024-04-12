/* eslint-disable */
import { Any } from "../../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.core.client.v1";
/** MsgCreateClient defines a message to create an IBC client */
export interface MsgCreateClient {
  /** light client state */
  client_state?: Any;
  /**
   * consensus state associated with the client that corresponds to a given
   * height.
   */
  consensus_state?: Any;
  /** signer address */
  signer: string;
}
/** MsgCreateClientResponse defines the Msg/CreateClient response type. */
export interface MsgCreateClientResponse {
  unsigned_tx?: Any;
  client_id: string;
}
/**
 * MsgUpdateClient defines an sdk.Msg to update a IBC client state using
 * the given client message.
 */
export interface MsgUpdateClient {
  /** client unique identifier */
  client_id: string;
  /** client message to update the light client */
  client_message?: Any;
  /** signer address */
  signer: string;
}
/** MsgUpdateClientResponse defines the Msg/UpdateClient response type. */
export interface MsgUpdateClientResponse {
  unsigned_tx?: Any;
}
/**
 * MsgUpgradeClient defines an sdk.Msg to upgrade an IBC client to a new client
 * state
 */
export interface MsgUpgradeClient {
  /** client unique identifier */
  client_id: string;
  /** upgraded client state */
  client_state?: Any;
  /**
   * upgraded consensus state, only contains enough information to serve as a
   * basis of trust in update logic
   */
  consensus_state?: Any;
  /** proof that old chain committed to new client */
  proof_upgrade_client: Uint8Array;
  /** proof that old chain committed to new consensus state */
  proof_upgrade_consensus_state: Uint8Array;
  /** signer address */
  signer: string;
}
/** MsgUpgradeClientResponse defines the Msg/UpgradeClient response type. */
export interface MsgUpgradeClientResponse {}
/**
 * MsgSubmitMisbehaviour defines an sdk.Msg type that submits Evidence for
 * light client misbehaviour.
 * Warning: DEPRECATED
 */
export interface MsgSubmitMisbehaviour {
  /** client unique identifier */
  /** @deprecated */
  client_id: string;
  /** misbehaviour used for freezing the light client */
  /** @deprecated */
  misbehaviour?: Any;
  /** signer address */
  /** @deprecated */
  signer: string;
}
/**
 * MsgSubmitMisbehaviourResponse defines the Msg/SubmitMisbehaviour response
 * type.
 */
export interface MsgSubmitMisbehaviourResponse {}
function createBaseMsgCreateClient(): MsgCreateClient {
  return {
    client_state: undefined,
    consensus_state: undefined,
    signer: ""
  };
}
export const MsgCreateClient = {
  typeUrl: "/ibc.core.client.v1.MsgCreateClient",
  encode(message: MsgCreateClient, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_state !== undefined) {
      Any.encode(message.client_state, writer.uint32(10).fork()).ldelim();
    }
    if (message.consensus_state !== undefined) {
      Any.encode(message.consensus_state, writer.uint32(18).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(26).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateClient {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgCreateClient();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_state = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.consensus_state = Any.decode(reader, reader.uint32());
          break;
        case 3:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgCreateClient {
    const obj = createBaseMsgCreateClient();
    if (isSet(object.client_state)) obj.client_state = Any.fromJSON(object.client_state);
    if (isSet(object.consensus_state)) obj.consensus_state = Any.fromJSON(object.consensus_state);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgCreateClient): unknown {
    const obj: any = {};
    message.client_state !== undefined && (obj.client_state = message.client_state ? Any.toJSON(message.client_state) : undefined);
    message.consensus_state !== undefined && (obj.consensus_state = message.consensus_state ? Any.toJSON(message.consensus_state) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgCreateClient>, I>>(object: I): MsgCreateClient {
    const message = createBaseMsgCreateClient();
    if (object.client_state !== undefined && object.client_state !== null) {
      message.client_state = Any.fromPartial(object.client_state);
    }
    if (object.consensus_state !== undefined && object.consensus_state !== null) {
      message.consensus_state = Any.fromPartial(object.consensus_state);
    }
    message.signer = object.signer ?? "";
    return message;
  }
};
function createBaseMsgCreateClientResponse(): MsgCreateClientResponse {
  return {
    unsigned_tx: undefined,
    client_id: ""
  };
}
export const MsgCreateClientResponse = {
  typeUrl: "/ibc.core.client.v1.MsgCreateClientResponse",
  encode(message: MsgCreateClientResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    if (message.client_id !== "") {
      writer.uint32(18).string(message.client_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateClientResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgCreateClientResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        case 2:
          message.client_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgCreateClientResponse {
    const obj = createBaseMsgCreateClientResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    return obj;
  },
  toJSON(message: MsgCreateClientResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined && (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    message.client_id !== undefined && (obj.client_id = message.client_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgCreateClientResponse>, I>>(object: I): MsgCreateClientResponse {
    const message = createBaseMsgCreateClientResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    message.client_id = object.client_id ?? "";
    return message;
  }
};
function createBaseMsgUpdateClient(): MsgUpdateClient {
  return {
    client_id: "",
    client_message: undefined,
    signer: ""
  };
}
export const MsgUpdateClient = {
  typeUrl: "/ibc.core.client.v1.MsgUpdateClient",
  encode(message: MsgUpdateClient, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.client_message !== undefined) {
      Any.encode(message.client_message, writer.uint32(18).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(26).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateClient {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateClient();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.client_message = Any.decode(reader, reader.uint32());
          break;
        case 3:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgUpdateClient {
    const obj = createBaseMsgUpdateClient();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.client_message)) obj.client_message = Any.fromJSON(object.client_message);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgUpdateClient): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.client_message !== undefined && (obj.client_message = message.client_message ? Any.toJSON(message.client_message) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateClient>, I>>(object: I): MsgUpdateClient {
    const message = createBaseMsgUpdateClient();
    message.client_id = object.client_id ?? "";
    if (object.client_message !== undefined && object.client_message !== null) {
      message.client_message = Any.fromPartial(object.client_message);
    }
    message.signer = object.signer ?? "";
    return message;
  }
};
function createBaseMsgUpdateClientResponse(): MsgUpdateClientResponse {
  return {
    unsigned_tx: undefined
  };
}
export const MsgUpdateClientResponse = {
  typeUrl: "/ibc.core.client.v1.MsgUpdateClientResponse",
  encode(message: MsgUpdateClientResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpdateClientResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpdateClientResponse();
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
  fromJSON(object: any): MsgUpdateClientResponse {
    const obj = createBaseMsgUpdateClientResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgUpdateClientResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined && (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpdateClientResponse>, I>>(object: I): MsgUpdateClientResponse {
    const message = createBaseMsgUpdateClientResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  }
};
function createBaseMsgUpgradeClient(): MsgUpgradeClient {
  return {
    client_id: "",
    client_state: undefined,
    consensus_state: undefined,
    proof_upgrade_client: new Uint8Array(),
    proof_upgrade_consensus_state: new Uint8Array(),
    signer: ""
  };
}
export const MsgUpgradeClient = {
  typeUrl: "/ibc.core.client.v1.MsgUpgradeClient",
  encode(message: MsgUpgradeClient, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.client_state !== undefined) {
      Any.encode(message.client_state, writer.uint32(18).fork()).ldelim();
    }
    if (message.consensus_state !== undefined) {
      Any.encode(message.consensus_state, writer.uint32(26).fork()).ldelim();
    }
    if (message.proof_upgrade_client.length !== 0) {
      writer.uint32(34).bytes(message.proof_upgrade_client);
    }
    if (message.proof_upgrade_consensus_state.length !== 0) {
      writer.uint32(42).bytes(message.proof_upgrade_consensus_state);
    }
    if (message.signer !== "") {
      writer.uint32(50).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpgradeClient {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpgradeClient();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.client_state = Any.decode(reader, reader.uint32());
          break;
        case 3:
          message.consensus_state = Any.decode(reader, reader.uint32());
          break;
        case 4:
          message.proof_upgrade_client = reader.bytes();
          break;
        case 5:
          message.proof_upgrade_consensus_state = reader.bytes();
          break;
        case 6:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgUpgradeClient {
    const obj = createBaseMsgUpgradeClient();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.client_state)) obj.client_state = Any.fromJSON(object.client_state);
    if (isSet(object.consensus_state)) obj.consensus_state = Any.fromJSON(object.consensus_state);
    if (isSet(object.proof_upgrade_client)) obj.proof_upgrade_client = bytesFromBase64(object.proof_upgrade_client);
    if (isSet(object.proof_upgrade_consensus_state)) obj.proof_upgrade_consensus_state = bytesFromBase64(object.proof_upgrade_consensus_state);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgUpgradeClient): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.client_state !== undefined && (obj.client_state = message.client_state ? Any.toJSON(message.client_state) : undefined);
    message.consensus_state !== undefined && (obj.consensus_state = message.consensus_state ? Any.toJSON(message.consensus_state) : undefined);
    message.proof_upgrade_client !== undefined && (obj.proof_upgrade_client = base64FromBytes(message.proof_upgrade_client !== undefined ? message.proof_upgrade_client : new Uint8Array()));
    message.proof_upgrade_consensus_state !== undefined && (obj.proof_upgrade_consensus_state = base64FromBytes(message.proof_upgrade_consensus_state !== undefined ? message.proof_upgrade_consensus_state : new Uint8Array()));
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpgradeClient>, I>>(object: I): MsgUpgradeClient {
    const message = createBaseMsgUpgradeClient();
    message.client_id = object.client_id ?? "";
    if (object.client_state !== undefined && object.client_state !== null) {
      message.client_state = Any.fromPartial(object.client_state);
    }
    if (object.consensus_state !== undefined && object.consensus_state !== null) {
      message.consensus_state = Any.fromPartial(object.consensus_state);
    }
    message.proof_upgrade_client = object.proof_upgrade_client ?? new Uint8Array();
    message.proof_upgrade_consensus_state = object.proof_upgrade_consensus_state ?? new Uint8Array();
    message.signer = object.signer ?? "";
    return message;
  }
};
function createBaseMsgUpgradeClientResponse(): MsgUpgradeClientResponse {
  return {};
}
export const MsgUpgradeClientResponse = {
  typeUrl: "/ibc.core.client.v1.MsgUpgradeClientResponse",
  encode(_: MsgUpgradeClientResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgUpgradeClientResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgUpgradeClientResponse();
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
  fromJSON(_: any): MsgUpgradeClientResponse {
    const obj = createBaseMsgUpgradeClientResponse();
    return obj;
  },
  toJSON(_: MsgUpgradeClientResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgUpgradeClientResponse>, I>>(_: I): MsgUpgradeClientResponse {
    const message = createBaseMsgUpgradeClientResponse();
    return message;
  }
};
function createBaseMsgSubmitMisbehaviour(): MsgSubmitMisbehaviour {
  return {
    client_id: "",
    misbehaviour: undefined,
    signer: ""
  };
}
export const MsgSubmitMisbehaviour = {
  typeUrl: "/ibc.core.client.v1.MsgSubmitMisbehaviour",
  encode(message: MsgSubmitMisbehaviour, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_id !== "") {
      writer.uint32(10).string(message.client_id);
    }
    if (message.misbehaviour !== undefined) {
      Any.encode(message.misbehaviour, writer.uint32(18).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(26).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgSubmitMisbehaviour {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSubmitMisbehaviour();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.client_id = reader.string();
          break;
        case 2:
          message.misbehaviour = Any.decode(reader, reader.uint32());
          break;
        case 3:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgSubmitMisbehaviour {
    const obj = createBaseMsgSubmitMisbehaviour();
    if (isSet(object.client_id)) obj.client_id = String(object.client_id);
    if (isSet(object.misbehaviour)) obj.misbehaviour = Any.fromJSON(object.misbehaviour);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgSubmitMisbehaviour): unknown {
    const obj: any = {};
    message.client_id !== undefined && (obj.client_id = message.client_id);
    message.misbehaviour !== undefined && (obj.misbehaviour = message.misbehaviour ? Any.toJSON(message.misbehaviour) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgSubmitMisbehaviour>, I>>(object: I): MsgSubmitMisbehaviour {
    const message = createBaseMsgSubmitMisbehaviour();
    message.client_id = object.client_id ?? "";
    if (object.misbehaviour !== undefined && object.misbehaviour !== null) {
      message.misbehaviour = Any.fromPartial(object.misbehaviour);
    }
    message.signer = object.signer ?? "";
    return message;
  }
};
function createBaseMsgSubmitMisbehaviourResponse(): MsgSubmitMisbehaviourResponse {
  return {};
}
export const MsgSubmitMisbehaviourResponse = {
  typeUrl: "/ibc.core.client.v1.MsgSubmitMisbehaviourResponse",
  encode(_: MsgSubmitMisbehaviourResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgSubmitMisbehaviourResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSubmitMisbehaviourResponse();
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
  fromJSON(_: any): MsgSubmitMisbehaviourResponse {
    const obj = createBaseMsgSubmitMisbehaviourResponse();
    return obj;
  },
  toJSON(_: MsgSubmitMisbehaviourResponse): unknown {
    const obj: any = {};
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgSubmitMisbehaviourResponse>, I>>(_: I): MsgSubmitMisbehaviourResponse {
    const message = createBaseMsgSubmitMisbehaviourResponse();
    return message;
  }
};
/** Msg defines the ibc/client Msg service. */
export interface Msg {
  /** CreateClient defines a rpc handler method for MsgCreateClient. */
  CreateClient(request: MsgCreateClient): Promise<MsgCreateClientResponse>;
  /** UpdateClient defines a rpc handler method for MsgUpdateClient. */
  UpdateClient(request: MsgUpdateClient): Promise<MsgUpdateClientResponse>;
  /** UpgradeClient defines a rpc handler method for MsgUpgradeClient. */
  UpgradeClient(request: MsgUpgradeClient): Promise<MsgUpgradeClientResponse>;
  /** SubmitMisbehaviour defines a rpc handler method for MsgSubmitMisbehaviour. */
  SubmitMisbehaviour(request: MsgSubmitMisbehaviour): Promise<MsgSubmitMisbehaviourResponse>;
}
export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.CreateClient = this.CreateClient.bind(this);
    this.UpdateClient = this.UpdateClient.bind(this);
    this.UpgradeClient = this.UpgradeClient.bind(this);
    this.SubmitMisbehaviour = this.SubmitMisbehaviour.bind(this);
  }
  CreateClient(request: MsgCreateClient): Promise<MsgCreateClientResponse> {
    const data = MsgCreateClient.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Msg", "CreateClient", data);
    return promise.then(data => MsgCreateClientResponse.decode(new BinaryReader(data)));
  }
  UpdateClient(request: MsgUpdateClient): Promise<MsgUpdateClientResponse> {
    const data = MsgUpdateClient.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Msg", "UpdateClient", data);
    return promise.then(data => MsgUpdateClientResponse.decode(new BinaryReader(data)));
  }
  UpgradeClient(request: MsgUpgradeClient): Promise<MsgUpgradeClientResponse> {
    const data = MsgUpgradeClient.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Msg", "UpgradeClient", data);
    return promise.then(data => MsgUpgradeClientResponse.decode(new BinaryReader(data)));
  }
  SubmitMisbehaviour(request: MsgSubmitMisbehaviour): Promise<MsgSubmitMisbehaviourResponse> {
    const data = MsgSubmitMisbehaviour.encode(request).finish();
    const promise = this.rpc.request("ibc.core.client.v1.Msg", "SubmitMisbehaviour", data);
    return promise.then(data => MsgSubmitMisbehaviourResponse.decode(new BinaryReader(data)));
  }
}