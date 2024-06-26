/* eslint-disable */
import { IdentifiedPacketFees } from "./fee";
import { PacketId } from "../../../core/channel/v1/channel";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { DeepPartial, Exact, isSet } from "../../../../helpers";
export const protobufPackage = "ibc.applications.fee.v1";
/** GenesisState defines the ICS29 fee middleware genesis state */
export interface GenesisState {
  /** list of identified packet fees */
  identified_fees: IdentifiedPacketFees[];
  /** list of fee enabled channels */
  fee_enabled_channels: FeeEnabledChannel[];
  /** list of registered payees */
  registered_payees: RegisteredPayee[];
  /** list of registered counterparty payees */
  registered_counterparty_payees: RegisteredCounterpartyPayee[];
  /** list of forward relayer addresses */
  forward_relayers: ForwardRelayerAddress[];
}
/** FeeEnabledChannel contains the PortID & ChannelID for a fee enabled channel */
export interface FeeEnabledChannel {
  /** unique port identifier */
  port_id: string;
  /** unique channel identifier */
  channel_id: string;
}
/** RegisteredPayee contains the relayer address and payee address for a specific channel */
export interface RegisteredPayee {
  /** unique channel identifier */
  channel_id: string;
  /** the relayer address */
  relayer: string;
  /** the payee address */
  payee: string;
}
/**
 * RegisteredCounterpartyPayee contains the relayer address and counterparty payee address for a specific channel (used
 * for recv fee distribution)
 */
export interface RegisteredCounterpartyPayee {
  /** unique channel identifier */
  channel_id: string;
  /** the relayer address */
  relayer: string;
  /** the counterparty payee address */
  counterparty_payee: string;
}
/** ForwardRelayerAddress contains the forward relayer address and PacketId used for async acknowledgements */
export interface ForwardRelayerAddress {
  /** the forward relayer address */
  address: string;
  /** unique packet identifer comprised of the channel ID, port ID and sequence */
  packet_id: PacketId;
}
function createBaseGenesisState(): GenesisState {
  return {
    identified_fees: [],
    fee_enabled_channels: [],
    registered_payees: [],
    registered_counterparty_payees: [],
    forward_relayers: []
  };
}
export const GenesisState = {
  typeUrl: "/ibc.applications.fee.v1.GenesisState",
  encode(message: GenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.identified_fees) {
      IdentifiedPacketFees.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    for (const v of message.fee_enabled_channels) {
      FeeEnabledChannel.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    for (const v of message.registered_payees) {
      RegisteredPayee.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.registered_counterparty_payees) {
      RegisteredCounterpartyPayee.encode(v!, writer.uint32(34).fork()).ldelim();
    }
    for (const v of message.forward_relayers) {
      ForwardRelayerAddress.encode(v!, writer.uint32(42).fork()).ldelim();
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
          message.identified_fees.push(IdentifiedPacketFees.decode(reader, reader.uint32()));
          break;
        case 2:
          message.fee_enabled_channels.push(FeeEnabledChannel.decode(reader, reader.uint32()));
          break;
        case 3:
          message.registered_payees.push(RegisteredPayee.decode(reader, reader.uint32()));
          break;
        case 4:
          message.registered_counterparty_payees.push(RegisteredCounterpartyPayee.decode(reader, reader.uint32()));
          break;
        case 5:
          message.forward_relayers.push(ForwardRelayerAddress.decode(reader, reader.uint32()));
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
    if (Array.isArray(object?.identified_fees)) obj.identified_fees = object.identified_fees.map((e: any) => IdentifiedPacketFees.fromJSON(e));
    if (Array.isArray(object?.fee_enabled_channels)) obj.fee_enabled_channels = object.fee_enabled_channels.map((e: any) => FeeEnabledChannel.fromJSON(e));
    if (Array.isArray(object?.registered_payees)) obj.registered_payees = object.registered_payees.map((e: any) => RegisteredPayee.fromJSON(e));
    if (Array.isArray(object?.registered_counterparty_payees)) obj.registered_counterparty_payees = object.registered_counterparty_payees.map((e: any) => RegisteredCounterpartyPayee.fromJSON(e));
    if (Array.isArray(object?.forward_relayers)) obj.forward_relayers = object.forward_relayers.map((e: any) => ForwardRelayerAddress.fromJSON(e));
    return obj;
  },
  toJSON(message: GenesisState): unknown {
    const obj: any = {};
    if (message.identified_fees) {
      obj.identified_fees = message.identified_fees.map(e => e ? IdentifiedPacketFees.toJSON(e) : undefined);
    } else {
      obj.identified_fees = [];
    }
    if (message.fee_enabled_channels) {
      obj.fee_enabled_channels = message.fee_enabled_channels.map(e => e ? FeeEnabledChannel.toJSON(e) : undefined);
    } else {
      obj.fee_enabled_channels = [];
    }
    if (message.registered_payees) {
      obj.registered_payees = message.registered_payees.map(e => e ? RegisteredPayee.toJSON(e) : undefined);
    } else {
      obj.registered_payees = [];
    }
    if (message.registered_counterparty_payees) {
      obj.registered_counterparty_payees = message.registered_counterparty_payees.map(e => e ? RegisteredCounterpartyPayee.toJSON(e) : undefined);
    } else {
      obj.registered_counterparty_payees = [];
    }
    if (message.forward_relayers) {
      obj.forward_relayers = message.forward_relayers.map(e => e ? ForwardRelayerAddress.toJSON(e) : undefined);
    } else {
      obj.forward_relayers = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisState>, I>>(object: I): GenesisState {
    const message = createBaseGenesisState();
    message.identified_fees = object.identified_fees?.map(e => IdentifiedPacketFees.fromPartial(e)) || [];
    message.fee_enabled_channels = object.fee_enabled_channels?.map(e => FeeEnabledChannel.fromPartial(e)) || [];
    message.registered_payees = object.registered_payees?.map(e => RegisteredPayee.fromPartial(e)) || [];
    message.registered_counterparty_payees = object.registered_counterparty_payees?.map(e => RegisteredCounterpartyPayee.fromPartial(e)) || [];
    message.forward_relayers = object.forward_relayers?.map(e => ForwardRelayerAddress.fromPartial(e)) || [];
    return message;
  }
};
function createBaseFeeEnabledChannel(): FeeEnabledChannel {
  return {
    port_id: "",
    channel_id: ""
  };
}
export const FeeEnabledChannel = {
  typeUrl: "/ibc.applications.fee.v1.FeeEnabledChannel",
  encode(message: FeeEnabledChannel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): FeeEnabledChannel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseFeeEnabledChannel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): FeeEnabledChannel {
    const obj = createBaseFeeEnabledChannel();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    return obj;
  },
  toJSON(message: FeeEnabledChannel): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<FeeEnabledChannel>, I>>(object: I): FeeEnabledChannel {
    const message = createBaseFeeEnabledChannel();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    return message;
  }
};
function createBaseRegisteredPayee(): RegisteredPayee {
  return {
    channel_id: "",
    relayer: "",
    payee: ""
  };
}
export const RegisteredPayee = {
  typeUrl: "/ibc.applications.fee.v1.RegisteredPayee",
  encode(message: RegisteredPayee, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.channel_id !== "") {
      writer.uint32(10).string(message.channel_id);
    }
    if (message.relayer !== "") {
      writer.uint32(18).string(message.relayer);
    }
    if (message.payee !== "") {
      writer.uint32(26).string(message.payee);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): RegisteredPayee {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseRegisteredPayee();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channel_id = reader.string();
          break;
        case 2:
          message.relayer = reader.string();
          break;
        case 3:
          message.payee = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): RegisteredPayee {
    const obj = createBaseRegisteredPayee();
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.relayer)) obj.relayer = String(object.relayer);
    if (isSet(object.payee)) obj.payee = String(object.payee);
    return obj;
  },
  toJSON(message: RegisteredPayee): unknown {
    const obj: any = {};
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.relayer !== undefined && (obj.relayer = message.relayer);
    message.payee !== undefined && (obj.payee = message.payee);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<RegisteredPayee>, I>>(object: I): RegisteredPayee {
    const message = createBaseRegisteredPayee();
    message.channel_id = object.channel_id ?? "";
    message.relayer = object.relayer ?? "";
    message.payee = object.payee ?? "";
    return message;
  }
};
function createBaseRegisteredCounterpartyPayee(): RegisteredCounterpartyPayee {
  return {
    channel_id: "",
    relayer: "",
    counterparty_payee: ""
  };
}
export const RegisteredCounterpartyPayee = {
  typeUrl: "/ibc.applications.fee.v1.RegisteredCounterpartyPayee",
  encode(message: RegisteredCounterpartyPayee, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.channel_id !== "") {
      writer.uint32(10).string(message.channel_id);
    }
    if (message.relayer !== "") {
      writer.uint32(18).string(message.relayer);
    }
    if (message.counterparty_payee !== "") {
      writer.uint32(26).string(message.counterparty_payee);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): RegisteredCounterpartyPayee {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseRegisteredCounterpartyPayee();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channel_id = reader.string();
          break;
        case 2:
          message.relayer = reader.string();
          break;
        case 3:
          message.counterparty_payee = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): RegisteredCounterpartyPayee {
    const obj = createBaseRegisteredCounterpartyPayee();
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.relayer)) obj.relayer = String(object.relayer);
    if (isSet(object.counterparty_payee)) obj.counterparty_payee = String(object.counterparty_payee);
    return obj;
  },
  toJSON(message: RegisteredCounterpartyPayee): unknown {
    const obj: any = {};
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.relayer !== undefined && (obj.relayer = message.relayer);
    message.counterparty_payee !== undefined && (obj.counterparty_payee = message.counterparty_payee);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<RegisteredCounterpartyPayee>, I>>(object: I): RegisteredCounterpartyPayee {
    const message = createBaseRegisteredCounterpartyPayee();
    message.channel_id = object.channel_id ?? "";
    message.relayer = object.relayer ?? "";
    message.counterparty_payee = object.counterparty_payee ?? "";
    return message;
  }
};
function createBaseForwardRelayerAddress(): ForwardRelayerAddress {
  return {
    address: "",
    packet_id: PacketId.fromPartial({})
  };
}
export const ForwardRelayerAddress = {
  typeUrl: "/ibc.applications.fee.v1.ForwardRelayerAddress",
  encode(message: ForwardRelayerAddress, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.address !== "") {
      writer.uint32(10).string(message.address);
    }
    if (message.packet_id !== undefined) {
      PacketId.encode(message.packet_id, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ForwardRelayerAddress {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseForwardRelayerAddress();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.address = reader.string();
          break;
        case 2:
          message.packet_id = PacketId.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): ForwardRelayerAddress {
    const obj = createBaseForwardRelayerAddress();
    if (isSet(object.address)) obj.address = String(object.address);
    if (isSet(object.packet_id)) obj.packet_id = PacketId.fromJSON(object.packet_id);
    return obj;
  },
  toJSON(message: ForwardRelayerAddress): unknown {
    const obj: any = {};
    message.address !== undefined && (obj.address = message.address);
    message.packet_id !== undefined && (obj.packet_id = message.packet_id ? PacketId.toJSON(message.packet_id) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<ForwardRelayerAddress>, I>>(object: I): ForwardRelayerAddress {
    const message = createBaseForwardRelayerAddress();
    message.address = object.address ?? "";
    if (object.packet_id !== undefined && object.packet_id !== null) {
      message.packet_id = PacketId.fromPartial(object.packet_id);
    }
    return message;
  }
};