/* eslint-disable */
import { BinaryReader, BinaryWriter } from "../../binary";
import { isSet, DeepPartial, Exact } from "../../helpers";
export const protobufPackage = "vesseloracle.vesseloracle";
/**
 * Params defines the parameters for the module.
 * @name Params
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.Params
 */
export interface Params {
  /**
   * The minimum number of items in a consolidation window needed for performing outlier detection.
   */
  consolidation_window_min_item_count: number;
  /**
   * The maximum number of items in a consolidation window chosen for performing outlier detection. Mostly used to prevent event spamming.
   */
  consolidation_window_max_item_count: number;
  /**
   * The width of the time interval over which a consolidation is executed.
   */
  consolidation_window_interval_width: bigint;
}
function createBaseParams(): Params {
  return {
    consolidation_window_min_item_count: 0,
    consolidation_window_max_item_count: 0,
    consolidation_window_interval_width: BigInt(0),
  };
}
/**
 * Params defines the parameters for the module.
 * @name Params
 * @package vesseloracle.vesseloracle
 * @see proto type: vesseloracle.vesseloracle.Params
 */
export const Params = {
  typeUrl: "/vesseloracle.vesseloracle.Params",
  encode(message: Params, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.consolidation_window_min_item_count !== 0) {
      writer.uint32(8).int32(message.consolidation_window_min_item_count);
    }
    if (message.consolidation_window_max_item_count !== 0) {
      writer.uint32(16).int32(message.consolidation_window_max_item_count);
    }
    if (message.consolidation_window_interval_width !== BigInt(0)) {
      writer.uint32(24).uint64(message.consolidation_window_interval_width);
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
          message.consolidation_window_min_item_count = reader.int32();
          break;
        case 2:
          message.consolidation_window_max_item_count = reader.int32();
          break;
        case 3:
          message.consolidation_window_interval_width = reader.uint64();
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
    if (isSet(object.consolidation_window_min_item_count))
      obj.consolidation_window_min_item_count = Number(object.consolidation_window_min_item_count);
    if (isSet(object.consolidation_window_max_item_count))
      obj.consolidation_window_max_item_count = Number(object.consolidation_window_max_item_count);
    if (isSet(object.consolidation_window_interval_width))
      obj.consolidation_window_interval_width = BigInt(object.consolidation_window_interval_width.toString());
    return obj;
  },
  toJSON(message: Params): unknown {
    const obj: any = {};
    message.consolidation_window_min_item_count !== undefined &&
      (obj.consolidation_window_min_item_count = Math.round(message.consolidation_window_min_item_count));
    message.consolidation_window_max_item_count !== undefined &&
      (obj.consolidation_window_max_item_count = Math.round(message.consolidation_window_max_item_count));
    message.consolidation_window_interval_width !== undefined &&
      (obj.consolidation_window_interval_width = (
        message.consolidation_window_interval_width || BigInt(0)
      ).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<Params>, I>>(object: I): Params {
    const message = createBaseParams();
    message.consolidation_window_min_item_count = object.consolidation_window_min_item_count ?? 0;
    message.consolidation_window_max_item_count = object.consolidation_window_max_item_count ?? 0;
    if (
      object.consolidation_window_interval_width !== undefined &&
      object.consolidation_window_interval_width !== null
    ) {
      message.consolidation_window_interval_width = BigInt(
        object.consolidation_window_interval_width.toString(),
      );
    }
    return message;
  },
};
