/* eslint-disable */
import { Params } from "./params";
import { Vessel } from "./vessel";
import { ConsolidatedDataReport } from "./consolidated_data_report";
import { BinaryReader, BinaryWriter } from "../../binary";
import { isSet, DeepPartial, Exact } from "../../helpers";
export const protobufPackage = "vesseloracle.vesseloracle";
/**
 * GenesisState defines the vesseloracle module's genesis state.
 * @name GenesisState
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.GenesisState
 */
export interface GenesisState {
  /**
   * params defines all the parameters of the module.
   */
  params: Params;
  port_id: string;
  vesselList: Vessel[];
  consolidatedDataReportList: ConsolidatedDataReport[];
}
function createBaseGenesisState(): GenesisState {
  return {
    params: Params.fromPartial({}),
    port_id: "",
    vesselList: [],
    consolidatedDataReportList: [],
  };
}
/**
 * GenesisState defines the vesseloracle module's genesis state.
 * @name GenesisState
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.GenesisState
 */
export const GenesisState = {
  typeUrl: "/vesseloracle.vesseloracle.GenesisState",
  encode(message: GenesisState, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.params !== undefined) {
      Params.encode(message.params, writer.uint32(10).fork()).ldelim();
    }
    if (message.port_id !== "") {
      writer.uint32(18).string(message.port_id);
    }
    for (const v of message.vesselList) {
      Vessel.encode(v!, writer.uint32(26).fork()).ldelim();
    }
    for (const v of message.consolidatedDataReportList) {
      ConsolidatedDataReport.encode(v!, writer.uint32(34).fork()).ldelim();
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
          message.params = Params.decode(reader, reader.uint32());
          break;
        case 2:
          message.port_id = reader.string();
          break;
        case 3:
          message.vesselList.push(Vessel.decode(reader, reader.uint32()));
          break;
        case 4:
          message.consolidatedDataReportList.push(ConsolidatedDataReport.decode(reader, reader.uint32()));
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
    if (isSet(object.params)) obj.params = Params.fromJSON(object.params);
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (Array.isArray(object?.vesselList))
      obj.vesselList = object.vesselList.map((e: any) => Vessel.fromJSON(e));
    if (Array.isArray(object?.consolidatedDataReportList))
      obj.consolidatedDataReportList = object.consolidatedDataReportList.map((e: any) =>
        ConsolidatedDataReport.fromJSON(e),
      );
    return obj;
  },
  toJSON(message: GenesisState): unknown {
    const obj: any = {};
    message.params !== undefined && (obj.params = message.params ? Params.toJSON(message.params) : undefined);
    message.port_id !== undefined && (obj.port_id = message.port_id);
    if (message.vesselList) {
      obj.vesselList = message.vesselList.map((e) => (e ? Vessel.toJSON(e) : undefined));
    } else {
      obj.vesselList = [];
    }
    if (message.consolidatedDataReportList) {
      obj.consolidatedDataReportList = message.consolidatedDataReportList.map((e) =>
        e ? ConsolidatedDataReport.toJSON(e) : undefined,
      );
    } else {
      obj.consolidatedDataReportList = [];
    }
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<GenesisState>, I>>(object: I): GenesisState {
    const message = createBaseGenesisState();
    if (object.params !== undefined && object.params !== null) {
      message.params = Params.fromPartial(object.params);
    }
    message.port_id = object.port_id ?? "";
    message.vesselList = object.vesselList?.map((e) => Vessel.fromPartial(e)) || [];
    message.consolidatedDataReportList =
      object.consolidatedDataReportList?.map((e) => ConsolidatedDataReport.fromPartial(e)) || [];
    return message;
  },
};
