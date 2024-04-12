/* eslint-disable */
import { Params as Params1 } from "../../controller/v1/controller";
import { Params as Params2 } from "../../host/v1/host";
import { BinaryReader, BinaryWriter } from "../../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../../helpers";
export const protobufPackage = "ibc.applications.interchain_accounts.genesis.v1";
/** GenesisState defines the interchain accounts genesis state */
export interface GenesisState {
  controller_genesis_state: ControllerGenesisState;
  host_genesis_state: HostGenesisState;
}
/** ControllerGenesisState defines the interchain accounts controller genesis state */
export interface ControllerGenesisState {
  active_channels: ActiveChannel[];
  interchain_accounts: RegisteredInterchainAccount[];
  ports: string[];
  params: Params1;
}
/** HostGenesisState defines the interchain accounts host genesis state */
export interface HostGenesisState {
  active_channels: ActiveChannel[];
  interchain_accounts: RegisteredInterchainAccount[];
  port: string;
  params: Params2;
}
/**
 * ActiveChannel contains a connection ID, port ID and associated active channel ID, as well as a boolean flag to
 * indicate if the channel is middleware enabled
 */
export interface ActiveChannel {
  connection_id: string;
  port_id: string;
  channel_id: string;
  is_middleware_enabled: boolean;
}
/** RegisteredInterchainAccount contains a connection ID, port ID and associated interchain account address */
export interface RegisteredInterchainAccount {
  connection_id: string;
  port_id: string;
  account_address: string;
}
function createBaseGenesisState(): GenesisState {
  return {
    controller_genesis_state: ControllerGenesisState.fromPartial({}),
    host_genesis_state: HostGenesisState.fromPartial({})
  };
}
export const GenesisState = {
  typeUrl: "/ibc.applications.interchain_accounts.genesis.v1.GenesisState",
  encode(message: GenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.controller_genesis_state !== undefined) {
      ControllerGenesisState.encode(message.controller_genesis_state, writer.uint32(10).fork()).ldelim();
    }
    if (message.host_genesis_state !== undefined) {
      HostGenesisState.encode(message.host_genesis_state, writer.uint32(18).fork()).ldelim();
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
          message.controller_genesis_state = ControllerGenesisState.decode(reader, reader.uint32());
          break;
        case 2:
          message.host_genesis_state = HostGenesisState.decode(reader, reader.uint32());
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
    if (isSet(object.controller_genesis_state)) obj.controller_genesis_state = ControllerGenesisState.fromJSON(object.controller_genesis_state);
    if (isSet(object.host_genesis_state)) obj.host_genesis_state = HostGenesisState.fromJSON(object.host_genesis_state);
    return obj;
  },
  toJSON(message: GenesisState): unknown {
    const obj: any = {};
    message.controller_genesis_state !== undefined && (obj.controller_genesis_state = message.controller_genesis_state ? ControllerGenesisState.toJSON(message.controller_genesis_state) : undefined);
    message.host_genesis_state !== undefined && (obj.host_genesis_state = message.host_genesis_state ? HostGenesisState.toJSON(message.host_genesis_state) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisState>, I>>(object: I): GenesisState {
    const message = createBaseGenesisState();
    if (object.controller_genesis_state !== undefined && object.controller_genesis_state !== null) {
      message.controller_genesis_state = ControllerGenesisState.fromPartial(object.controller_genesis_state);
    }
    if (object.host_genesis_state !== undefined && object.host_genesis_state !== null) {
      message.host_genesis_state = HostGenesisState.fromPartial(object.host_genesis_state);
    }
    return message;
  }
};
function createBaseControllerGenesisState(): ControllerGenesisState {
  return {
    active_channels: [],
    interchain_accounts: [],
    ports: [],
    params: Params1.fromPartial({})
  };
}
export const ControllerGenesisState = {
  typeUrl: "/ibc.applications.interchain_accounts.genesis.v1.ControllerGenesisState",
  encode(message: ControllerGenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.active_channels) {
      ActiveChannel.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.interchain_accounts) {
      RegisteredInterchainAccount.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.ports) {
      writer.uint32(26).string(v!);
    }
    if (message.params !== undefined) {
      Params1.encode(message.params, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ControllerGenesisState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseControllerGenesisState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.active_channels.push(ActiveChannel.decode(reader, reader.uint32()));
          break;
        case 2:
          message.interchain_accounts.push(RegisteredInterchainAccount.decode(reader, reader.uint32()));
          break;
        case 3:
          message.ports.push(reader.string());
          break;
        case 4:
          message.params = Params1.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ControllerGenesisState {
    const obj = createBaseControllerGenesisState();
    if (Array.isArray(object?.active_channels)) obj.active_channels = object.active_channels.map((e: any) => ActiveChannel.fromJSON(e));
    if (Array.isArray(object?.interchain_accounts)) obj.interchain_accounts = object.interchain_accounts.map((e: any) => RegisteredInterchainAccount.fromJSON(e));
    if (Array.isArray(object?.ports)) obj.ports = object.ports.map((e: any) => String(e));
    if (isSet(object.params)) obj.params = Params1.fromJSON(object.params);
    return obj;
  },
  toJSON(message: ControllerGenesisState): unknown {
    const obj: any = {};
    if (message.active_channels) {
      obj.active_channels = message.active_channels.map(e => e ? ActiveChannel.toJSON(e) : undefined);
    } else {
      obj.active_channels = [];
    }
    if (message.interchain_accounts) {
      obj.interchain_accounts = message.interchain_accounts.map(e => e ? RegisteredInterchainAccount.toJSON(e) : undefined);
    } else {
      obj.interchain_accounts = [];
    }
    if (message.ports) {
      obj.ports = message.ports.map(e => e);
    } else {
      obj.ports = [];
    }
    message.params !== undefined && (obj.params = message.params ? Params1.toJSON(message.params) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ControllerGenesisState>, I>>(object: I): ControllerGenesisState {
    const message = createBaseControllerGenesisState();
    message.active_channels = object.active_channels?.map(e => ActiveChannel.fromPartial(e)) || [];
    message.interchain_accounts = object.interchain_accounts?.map(e => RegisteredInterchainAccount.fromPartial(e)) || [];
    message.ports = object.ports?.map(e => e) || [];
    if (object.params !== undefined && object.params !== null) {
      message.params = Params1.fromPartial(object.params);
    }
    return message;
  }
};
function createBaseHostGenesisState(): HostGenesisState {
  return {
    active_channels: [],
    interchain_accounts: [],
    port: "",
    params: Params2.fromPartial({})
  };
}
export const HostGenesisState = {
  typeUrl: "/ibc.applications.interchain_accounts.genesis.v1.HostGenesisState",
  encode(message: HostGenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.active_channels) {
      ActiveChannel.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.interchain_accounts) {
      RegisteredInterchainAccount.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    if (message.port !== "") {
      writer.uint32(26).string(message.port);
    }
    if (message.params !== undefined) {
      Params2.encode(message.params, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): HostGenesisState {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHostGenesisState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.active_channels.push(ActiveChannel.decode(reader, reader.uint32()));
          break;
        case 2:
          message.interchain_accounts.push(RegisteredInterchainAccount.decode(reader, reader.uint32()));
          break;
        case 3:
          message.port = reader.string();
          break;
        case 4:
          message.params = Params2.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): HostGenesisState {
    const obj = createBaseHostGenesisState();
    if (Array.isArray(object?.active_channels)) obj.active_channels = object.active_channels.map((e: any) => ActiveChannel.fromJSON(e));
    if (Array.isArray(object?.interchain_accounts)) obj.interchain_accounts = object.interchain_accounts.map((e: any) => RegisteredInterchainAccount.fromJSON(e));
    if (isSet(object.port)) obj.port = String(object.port);
    if (isSet(object.params)) obj.params = Params2.fromJSON(object.params);
    return obj;
  },
  toJSON(message: HostGenesisState): unknown {
    const obj: any = {};
    if (message.active_channels) {
      obj.active_channels = message.active_channels.map(e => e ? ActiveChannel.toJSON(e) : undefined);
    } else {
      obj.active_channels = [];
    }
    if (message.interchain_accounts) {
      obj.interchain_accounts = message.interchain_accounts.map(e => e ? RegisteredInterchainAccount.toJSON(e) : undefined);
    } else {
      obj.interchain_accounts = [];
    }
    message.port !== undefined && (obj.port = message.port);
    message.params !== undefined && (obj.params = message.params ? Params2.toJSON(message.params) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<HostGenesisState>, I>>(object: I): HostGenesisState {
    const message = createBaseHostGenesisState();
    message.active_channels = object.active_channels?.map(e => ActiveChannel.fromPartial(e)) || [];
    message.interchain_accounts = object.interchain_accounts?.map(e => RegisteredInterchainAccount.fromPartial(e)) || [];
    message.port = object.port ?? "";
    if (object.params !== undefined && object.params !== null) {
      message.params = Params2.fromPartial(object.params);
    }
    return message;
  }
};
function createBaseActiveChannel(): ActiveChannel {
  return {
    connection_id: "",
    port_id: "",
    channel_id: "",
    is_middleware_enabled: false
  };
}
export const ActiveChannel = {
  typeUrl: "/ibc.applications.interchain_accounts.genesis.v1.ActiveChannel",
  encode(message: ActiveChannel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.connection_id !== "") {
      writer.uint32(10).string(message.connection_id);
    }
    if (message.port_id !== "") {
      writer.uint32(18).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(26).string(message.channel_id);
    }
    if (message.is_middleware_enabled === true) {
      writer.uint32(32).bool(message.is_middleware_enabled);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ActiveChannel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseActiveChannel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.connection_id = reader.string();
          break;
        case 2:
          message.port_id = reader.string();
          break;
        case 3:
          message.channel_id = reader.string();
          break;
        case 4:
          message.is_middleware_enabled = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ActiveChannel {
    const obj = createBaseActiveChannel();
    if (isSet(object.connection_id)) obj.connection_id = String(object.connection_id);
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.is_middleware_enabled)) obj.is_middleware_enabled = Boolean(object.is_middleware_enabled);
    return obj;
  },
  toJSON(message: ActiveChannel): unknown {
    const obj: any = {};
    message.connection_id !== undefined && (obj.connection_id = message.connection_id);
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.is_middleware_enabled !== undefined && (obj.is_middleware_enabled = message.is_middleware_enabled);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ActiveChannel>, I>>(object: I): ActiveChannel {
    const message = createBaseActiveChannel();
    message.connection_id = object.connection_id ?? "";
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.is_middleware_enabled = object.is_middleware_enabled ?? false;
    return message;
  }
};
function createBaseRegisteredInterchainAccount(): RegisteredInterchainAccount {
  return {
    connection_id: "",
    port_id: "",
    account_address: ""
  };
}
export const RegisteredInterchainAccount = {
  typeUrl: "/ibc.applications.interchain_accounts.genesis.v1.RegisteredInterchainAccount",
  encode(message: RegisteredInterchainAccount, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.connection_id !== "") {
      writer.uint32(10).string(message.connection_id);
    }
    if (message.port_id !== "") {
      writer.uint32(18).string(message.port_id);
    }
    if (message.account_address !== "") {
      writer.uint32(26).string(message.account_address);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): RegisteredInterchainAccount {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseRegisteredInterchainAccount();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.connection_id = reader.string();
          break;
        case 2:
          message.port_id = reader.string();
          break;
        case 3:
          message.account_address = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): RegisteredInterchainAccount {
    const obj = createBaseRegisteredInterchainAccount();
    if (isSet(object.connection_id)) obj.connection_id = String(object.connection_id);
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.account_address)) obj.account_address = String(object.account_address);
    return obj;
  },
  toJSON(message: RegisteredInterchainAccount): unknown {
    const obj: any = {};
    message.connection_id !== undefined && (obj.connection_id = message.connection_id);
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.account_address !== undefined && (obj.account_address = message.account_address);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<RegisteredInterchainAccount>, I>>(object: I): RegisteredInterchainAccount {
    const message = createBaseRegisteredInterchainAccount();
    message.connection_id = object.connection_id ?? "";
    message.port_id = object.port_id ?? "";
    message.account_address = object.account_address ?? "";
    return message;
  }
};