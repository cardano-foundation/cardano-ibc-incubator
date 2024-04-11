/* eslint-disable */
import { GenesisState as GenesisState1 } from "../../client/v1/genesis";
import { GenesisState as GenesisState2 } from "../../connection/v1/genesis";
import { GenesisState as GenesisState3 } from "../../channel/v1/genesis";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.core.types.v1";
/** GenesisState defines the ibc module's genesis state. */
export interface GenesisState {
  /** ICS002 - Clients genesis state */
  client_genesis: GenesisState1;
  /** ICS003 - Connections genesis state */
  connection_genesis: GenesisState2;
  /** ICS004 - Channel genesis state */
  channel_genesis: GenesisState3;
}
function createBaseGenesisState(): GenesisState {
  return {
    client_genesis: GenesisState1.fromPartial({}),
    connection_genesis: GenesisState2.fromPartial({}),
    channel_genesis: GenesisState3.fromPartial({})
  };
}
export const GenesisState = {
  typeUrl: "/ibc.core.types.v1.GenesisState",
  encode(message: GenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.client_genesis !== undefined) {
      GenesisState1.encode(message.client_genesis, writer.uint32(10).fork()).ldelim();
    }
    if (message.connection_genesis !== undefined) {
      GenesisState2.encode(message.connection_genesis, writer.uint32(18).fork()).ldelim();
    }
    if (message.channel_genesis !== undefined) {
      GenesisState3.encode(message.channel_genesis, writer.uint32(26).fork()).ldelim();
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
          message.client_genesis = GenesisState1.decode(reader, reader.uint32());
          break;
        case 2:
          message.connection_genesis = GenesisState2.decode(reader, reader.uint32());
          break;
        case 3:
          message.channel_genesis = GenesisState3.decode(reader, reader.uint32());
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
    if (isSet(object.client_genesis)) obj.client_genesis = GenesisState1.fromJSON(object.client_genesis);
    if (isSet(object.connection_genesis)) obj.connection_genesis = GenesisState2.fromJSON(object.connection_genesis);
    if (isSet(object.channel_genesis)) obj.channel_genesis = GenesisState3.fromJSON(object.channel_genesis);
    return obj;
  },
  toJSON(message: GenesisState): unknown {
    const obj: any = {};
    message.client_genesis !== undefined && (obj.client_genesis = message.client_genesis ? GenesisState1.toJSON(message.client_genesis) : undefined);
    message.connection_genesis !== undefined && (obj.connection_genesis = message.connection_genesis ? GenesisState2.toJSON(message.connection_genesis) : undefined);
    message.channel_genesis !== undefined && (obj.channel_genesis = message.channel_genesis ? GenesisState3.toJSON(message.channel_genesis) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisState>, I>>(object: I): GenesisState {
    const message = createBaseGenesisState();
    if (object.client_genesis !== undefined && object.client_genesis !== null) {
      message.client_genesis = GenesisState1.fromPartial(object.client_genesis);
    }
    if (object.connection_genesis !== undefined && object.connection_genesis !== null) {
      message.connection_genesis = GenesisState2.fromPartial(object.connection_genesis);
    }
    if (object.channel_genesis !== undefined && object.channel_genesis !== null) {
      message.channel_genesis = GenesisState3.fromPartial(object.channel_genesis);
    }
    return message;
  }
};