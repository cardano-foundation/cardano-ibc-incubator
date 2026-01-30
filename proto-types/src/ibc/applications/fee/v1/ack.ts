/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, bytesFromBase64, base64FromBytes, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.applications.fee.v1";
/** IncentivizedAcknowledgement is the acknowledgement format to be used by applications wrapped in the fee middleware */
export interface IncentivizedAcknowledgement {
  /** the underlying app acknowledgement bytes */
  app_acknowledgement: Uint8Array;
  /** the relayer address which submits the recv packet message */
  forward_relayer_address: string;
  /** success flag of the base application callback */
  underlying_app_success: boolean;
}
function createBaseIncentivizedAcknowledgement(): IncentivizedAcknowledgement {
  return {
    app_acknowledgement: new Uint8Array(),
    forward_relayer_address: "",
    underlying_app_success: false,
  };
}
export const IncentivizedAcknowledgement = {
  typeUrl: "/ibc.applications.fee.v1.IncentivizedAcknowledgement",
  encode(message: IncentivizedAcknowledgement, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.app_acknowledgement.length !== 0) {
      writer.uint32(10).bytes(message.app_acknowledgement);
    }
    if (message.forward_relayer_address !== "") {
      writer.uint32(18).string(message.forward_relayer_address);
    }
    if (message.underlying_app_success === true) {
      writer.uint32(24).bool(message.underlying_app_success);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): IncentivizedAcknowledgement {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseIncentivizedAcknowledgement();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.app_acknowledgement = reader.bytes();
          break;
        case 2:
          message.forward_relayer_address = reader.string();
          break;
        case 3:
          message.underlying_app_success = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): IncentivizedAcknowledgement {
    const obj = createBaseIncentivizedAcknowledgement();
    if (isSet(object.app_acknowledgement))
      obj.app_acknowledgement = bytesFromBase64(object.app_acknowledgement);
    if (isSet(object.forward_relayer_address))
      obj.forward_relayer_address = String(object.forward_relayer_address);
    if (isSet(object.underlying_app_success))
      obj.underlying_app_success = Boolean(object.underlying_app_success);
    return obj;
  },
  toJSON(message: IncentivizedAcknowledgement): unknown {
    const obj: any = {};
    message.app_acknowledgement !== undefined &&
      (obj.app_acknowledgement = base64FromBytes(
        message.app_acknowledgement !== undefined ? message.app_acknowledgement : new Uint8Array(),
      ));
    message.forward_relayer_address !== undefined &&
      (obj.forward_relayer_address = message.forward_relayer_address);
    message.underlying_app_success !== undefined &&
      (obj.underlying_app_success = message.underlying_app_success);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<IncentivizedAcknowledgement>, I>>(
    object: I,
  ): IncentivizedAcknowledgement {
    const message = createBaseIncentivizedAcknowledgement();
    message.app_acknowledgement = object.app_acknowledgement ?? new Uint8Array();
    message.forward_relayer_address = object.forward_relayer_address ?? "";
    message.underlying_app_success = object.underlying_app_success ?? false;
    return message;
  },
};
