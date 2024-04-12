/* eslint-disable */
import { DenomTrace, Params } from "./transfer";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.applications.transfer.v1";
/** GenesisState defines the ibc-transfer genesis state */
export interface GenesisState {
  port_id: string;
  denom_traces: DenomTrace[];
  params: Params;
}
function createBaseGenesisState(): GenesisState {
  return {
    port_id: "",
    denom_traces: [],
    params: Params.fromPartial({})
  };
}
export const GenesisState = {
  typeUrl: "/ibc.applications.transfer.v1.GenesisState",
  encode(message: GenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    for (const v of message.denom_traces) {
      DenomTrace.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    if (message.params !== undefined) {
      Params.encode(message.params, writer.uint32(26).fork()).ldelim();
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
          message.port_id = reader.string();
          break;
        case 2:
          message.denom_traces.push(DenomTrace.decode(reader, reader.uint32()));
          break;
        case 3:
          message.params = Params.decode(reader, reader.uint32());
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
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (Array.isArray(object?.denom_traces)) obj.denom_traces = object.denom_traces.map((e: any) => DenomTrace.fromJSON(e));
    if (isSet(object.params)) obj.params = Params.fromJSON(object.params);
    return obj;
  },
  toJSON(message: GenesisState): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    if (message.denom_traces) {
      obj.denom_traces = message.denom_traces.map(e => e ? DenomTrace.toJSON(e) : undefined);
    } else {
      obj.denom_traces = [];
    }
    message.params !== undefined && (obj.params = message.params ? Params.toJSON(message.params) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisState>, I>>(object: I): GenesisState {
    const message = createBaseGenesisState();
    message.port_id = object.port_id ?? "";
    message.denom_traces = object.denom_traces?.map(e => DenomTrace.fromPartial(e)) || [];
    if (object.params !== undefined && object.params !== null) {
      message.params = Params.fromPartial(object.params);
    }
    return message;
  }
};