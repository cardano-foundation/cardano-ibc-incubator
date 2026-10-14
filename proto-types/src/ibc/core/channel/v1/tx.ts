/* eslint-disable */
import { Channel, Packet, Coin, State, stateFromJSON, stateToJSON } from "./channel";
import { Height } from "../../client/v1/client";
import { UpgradeFields, Upgrade, ErrorReceipt } from "./upgrade";
import { Any } from "../../../../google/protobuf/any";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact, bytesFromBase64, base64FromBytes, Rpc } from "../../../../helpers";
export const protobufPackage = "ibc.core.channel.v1";
/** ResponseResultType defines the possible outcomes of the execution of a message */
export enum ResponseResultType {
  /** RESPONSE_RESULT_TYPE_UNSPECIFIED - Default zero value enumeration */
  RESPONSE_RESULT_TYPE_UNSPECIFIED = 0,
  /** RESPONSE_RESULT_TYPE_NOOP - The message did not call the IBC application callbacks (because, for example, the packet had already been relayed) */
  RESPONSE_RESULT_TYPE_NOOP = 1,
  /** RESPONSE_RESULT_TYPE_SUCCESS - The message was executed successfully */
  RESPONSE_RESULT_TYPE_SUCCESS = 2,
  /** RESPONSE_RESULT_TYPE_FAILURE - The message was executed unsuccessfully */
  RESPONSE_RESULT_TYPE_FAILURE = 3,
  UNRECOGNIZED = -1,
}
export function responseResultTypeFromJSON(object: any): ResponseResultType {
  switch (object) {
    case 0:
    case "RESPONSE_RESULT_TYPE_UNSPECIFIED":
      return ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED;
    case 1:
    case "RESPONSE_RESULT_TYPE_NOOP":
      return ResponseResultType.RESPONSE_RESULT_TYPE_NOOP;
    case 2:
    case "RESPONSE_RESULT_TYPE_SUCCESS":
      return ResponseResultType.RESPONSE_RESULT_TYPE_SUCCESS;
    case 3:
    case "RESPONSE_RESULT_TYPE_FAILURE":
      return ResponseResultType.RESPONSE_RESULT_TYPE_FAILURE;
    case -1:
    case "UNRECOGNIZED":
    default:
      return ResponseResultType.UNRECOGNIZED;
  }
}
export function responseResultTypeToJSON(object: ResponseResultType): string {
  switch (object) {
    case ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED:
      return "RESPONSE_RESULT_TYPE_UNSPECIFIED";
    case ResponseResultType.RESPONSE_RESULT_TYPE_NOOP:
      return "RESPONSE_RESULT_TYPE_NOOP";
    case ResponseResultType.RESPONSE_RESULT_TYPE_SUCCESS:
      return "RESPONSE_RESULT_TYPE_SUCCESS";
    case ResponseResultType.RESPONSE_RESULT_TYPE_FAILURE:
      return "RESPONSE_RESULT_TYPE_FAILURE";
    case ResponseResultType.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}
/**
 * MsgChannelOpenInit defines an sdk.Msg to initialize a channel handshake. It
 * is called by a relayer on Chain A.
 * @name MsgChannelOpenInit
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenInit
 */
export interface MsgChannelOpenInit {
  port_id: string;
  channel: Channel;
  signer: string;
}
/**
 * MsgChannelOpenInitResponse defines the Msg/ChannelOpenInit response type.
 * @name MsgChannelOpenInitResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenInitResponse
 */
export interface MsgChannelOpenInitResponse {
  channel_id: string;
  version: string;
  unsigned_tx?: Any;
}
/**
 * MsgChannelOpenInit defines a msg sent by a Relayer to try to open a channel
 * on Chain B. The version field within the Channel field has been deprecated. Its
 * value will be ignored by core IBC.
 * @name MsgChannelOpenTry
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenTry
 */
export interface MsgChannelOpenTry {
  port_id: string;
  /**
   * Deprecated: this field is unused. Crossing hello's are no longer supported in core IBC.
   * @deprecated
   */
  previous_channel_id: string;
  /**
   * NOTE: the version field within the channel has been deprecated. Its value will be ignored by core IBC.
   */
  channel: Channel;
  counterparty_version: string;
  proof_init: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * MsgChannelOpenTryResponse defines the Msg/ChannelOpenTry response type.
 * @name MsgChannelOpenTryResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenTryResponse
 */
export interface MsgChannelOpenTryResponse {
  version: string;
  unsigned_tx?: Any;
}
/**
 * MsgChannelOpenAck defines a msg sent by a Relayer to Chain A to acknowledge
 * the change of channel state to TRYOPEN on Chain B.
 * @name MsgChannelOpenAck
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenAck
 */
export interface MsgChannelOpenAck {
  port_id: string;
  channel_id: string;
  counterparty_channel_id: string;
  counterparty_version: string;
  proof_try: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * MsgChannelOpenAckResponse defines the Msg/ChannelOpenAck response type.
 * @name MsgChannelOpenAckResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenAckResponse
 */
export interface MsgChannelOpenAckResponse {
  unsigned_tx?: Any;
}
/**
 * MsgChannelOpenConfirm defines a msg sent by a Relayer to Chain B to
 * acknowledge the change of channel state to OPEN on Chain A.
 * @name MsgChannelOpenConfirm
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenConfirm
 */
export interface MsgChannelOpenConfirm {
  port_id: string;
  channel_id: string;
  proof_ack: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * MsgChannelOpenConfirmResponse defines the Msg/ChannelOpenConfirm response
 * type.
 * @name MsgChannelOpenConfirmResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenConfirmResponse
 */
export interface MsgChannelOpenConfirmResponse {
  unsigned_tx?: Any;
}
/**
 * MsgChannelCloseInit defines a msg sent by a Relayer to Chain A
 * to close a channel with Chain B.
 * @name MsgChannelCloseInit
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseInit
 */
export interface MsgChannelCloseInit {
  port_id: string;
  channel_id: string;
  signer: string;
}
/**
 * MsgChannelCloseInitResponse defines the Msg/ChannelCloseInit response type.
 * @name MsgChannelCloseInitResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseInitResponse
 */
export interface MsgChannelCloseInitResponse {
  unsigned_tx?: Any;
}
/**
 * MsgChannelCloseConfirm defines a msg sent by a Relayer to Chain B
 * to acknowledge the change of channel state to CLOSED on Chain A.
 * @name MsgChannelCloseConfirm
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseConfirm
 */
export interface MsgChannelCloseConfirm {
  port_id: string;
  channel_id: string;
  proof_init: Uint8Array;
  proof_height: Height;
  signer: string;
  counterparty_upgrade_sequence: bigint;
}
/**
 * MsgChannelCloseConfirmResponse defines the Msg/ChannelCloseConfirm response
 * type.
 * @name MsgChannelCloseConfirmResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseConfirmResponse
 */
export interface MsgChannelCloseConfirmResponse {
  unsigned_tx?: Any;
}
/**
 * MsgRecvPacket receives incoming IBC packet
 * @name MsgRecvPacket
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgRecvPacket
 */
export interface MsgRecvPacket {
  packet: Packet;
  proof_commitment: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * MsgRecvPacketResponse defines the Msg/RecvPacket response type.
 * @name MsgRecvPacketResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgRecvPacketResponse
 */
export interface MsgRecvPacketResponse {
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * MsgTimeout receives timed-out packet
 * @name MsgTimeout
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeout
 */
export interface MsgTimeout {
  packet: Packet;
  proof_unreceived: Uint8Array;
  proof_height: Height;
  next_sequence_recv: bigint;
  signer: string;
}
/**
 * MsgTimeoutResponse defines the Msg/Timeout response type.
 * @name MsgTimeoutResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeoutResponse
 */
export interface MsgTimeoutResponse {
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * MsgTimeoutOnClose timed-out packet upon counterparty channel closure.
 * @name MsgTimeoutOnClose
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeoutOnClose
 */
export interface MsgTimeoutOnClose {
  packet: Packet;
  proof_unreceived: Uint8Array;
  proof_close: Uint8Array;
  proof_height: Height;
  next_sequence_recv: bigint;
  signer: string;
  counterparty_upgrade_sequence: bigint;
}
/**
 * MsgTimeoutOnCloseResponse defines the Msg/TimeoutOnClose response type.
 * @name MsgTimeoutOnCloseResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeoutOnCloseResponse
 */
export interface MsgTimeoutOnCloseResponse {
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * MsgAcknowledgement receives incoming IBC acknowledgement
 * @name MsgAcknowledgement
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgAcknowledgement
 */
export interface MsgAcknowledgement {
  packet: Packet;
  acknowledgement: Uint8Array;
  proof_acked: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * MsgAcknowledgementResponse defines the Msg/Acknowledgement response type.
 * @name MsgAcknowledgementResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgAcknowledgementResponse
 */
export interface MsgAcknowledgementResponse {
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * MsgTransfer send packet
 * @name MsgTransfer
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTransfer
 */
export interface MsgTransfer {
  source_port: string;
  source_channel: string;
  token: Coin;
  sender: string;
  receiver: string;
  timeout_height?: Height;
  timeout_timestamp: bigint;
  memo: string;
  signer: string;
}
/**
 * MsgTransferResponse defines the Msg/Transfer response type.
 * @name MsgTransferResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTransferResponse
 */
export interface MsgTransferResponse {
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * MsgChannelUpgradeInit is the deployment authority's proposal to upgrade a channel.
 * @name MsgChannelUpgradeInit
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeInit
 */
export interface MsgChannelUpgradeInit {
  port_id: string;
  channel_id: string;
  fields: UpgradeFields;
  signer: string;
  /**
   * Cardano: milliseconds from the start of flushing until the upgrade times
   * out on the counterparty.
   */
  timeout_period_ms: bigint;
}
/**
 * @name MsgChannelUpgradeInitResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeInitResponse
 */
export interface MsgChannelUpgradeInitResponse {
  upgrade: Upgrade;
  upgrade_sequence: bigint;
  unsigned_tx?: Any;
}
/**
 * @name MsgChannelUpgradeTry
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTry
 */
export interface MsgChannelUpgradeTry {
  port_id: string;
  channel_id: string;
  proposed_upgrade_connection_hops: string[];
  counterparty_upgrade_fields: UpgradeFields;
  counterparty_upgrade_sequence: bigint;
  proof_channel: Uint8Array;
  proof_upgrade: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * @name MsgChannelUpgradeTryResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTryResponse
 */
export interface MsgChannelUpgradeTryResponse {
  upgrade: Upgrade;
  upgrade_sequence: bigint;
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * @name MsgChannelUpgradeAck
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeAck
 */
export interface MsgChannelUpgradeAck {
  port_id: string;
  channel_id: string;
  counterparty_upgrade: Upgrade;
  proof_channel: Uint8Array;
  proof_upgrade: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * @name MsgChannelUpgradeAckResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeAckResponse
 */
export interface MsgChannelUpgradeAckResponse {
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * @name MsgChannelUpgradeConfirm
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeConfirm
 */
export interface MsgChannelUpgradeConfirm {
  port_id: string;
  channel_id: string;
  counterparty_channel_state: State;
  counterparty_upgrade: Upgrade;
  proof_channel: Uint8Array;
  proof_upgrade: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * @name MsgChannelUpgradeConfirmResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeConfirmResponse
 */
export interface MsgChannelUpgradeConfirmResponse {
  result: ResponseResultType;
  unsigned_tx?: Any;
}
/**
 * @name MsgChannelUpgradeOpen
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeOpen
 */
export interface MsgChannelUpgradeOpen {
  port_id: string;
  channel_id: string;
  counterparty_channel_state: State;
  counterparty_upgrade_sequence: bigint;
  proof_channel: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * @name MsgChannelUpgradeOpenResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeOpenResponse
 */
export interface MsgChannelUpgradeOpenResponse {
  unsigned_tx?: Any;
}
/**
 * @name MsgChannelUpgradeTimeout
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTimeout
 */
export interface MsgChannelUpgradeTimeout {
  port_id: string;
  channel_id: string;
  counterparty_channel: Channel;
  proof_channel: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * @name MsgChannelUpgradeTimeoutResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTimeoutResponse
 */
export interface MsgChannelUpgradeTimeoutResponse {
  unsigned_tx?: Any;
}
/**
 * @name MsgChannelUpgradeCancel
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeCancel
 */
export interface MsgChannelUpgradeCancel {
  port_id: string;
  channel_id: string;
  error_receipt: ErrorReceipt;
  proof_error_receipt: Uint8Array;
  proof_height: Height;
  signer: string;
}
/**
 * @name MsgChannelUpgradeCancelResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeCancelResponse
 */
export interface MsgChannelUpgradeCancelResponse {
  unsigned_tx?: Any;
}
/**
 * MsgChannelUpgradeFlush certifies the drained packet lanes of a flushing
 * Cardano channel.
 * @name MsgChannelUpgradeFlush
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeFlush
 */
export interface MsgChannelUpgradeFlush {
  port_id: string;
  channel_id: string;
  signer: string;
}
/**
 * @name MsgChannelUpgradeFlushResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeFlushResponse
 */
export interface MsgChannelUpgradeFlushResponse {
  /**
   * Packet lanes certified so far, out of the deployment's lane count.
   */
  flushed_lanes: bigint;
  lane_count: bigint;
  unsigned_tx?: Any;
}
function createBaseMsgChannelOpenInit(): MsgChannelOpenInit {
  return {
    port_id: "",
    channel: Channel.fromPartial({}),
    signer: "",
  };
}
/**
 * MsgChannelOpenInit defines an sdk.Msg to initialize a channel handshake. It
 * is called by a relayer on Chain A.
 * @name MsgChannelOpenInit
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenInit
 */
export const MsgChannelOpenInit = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenInit",
  encode(message: MsgChannelOpenInit, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel !== undefined) {
      Channel.encode(message.channel, writer.uint32(18).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(26).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenInit {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenInit();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel = Channel.decode(reader, reader.uint32());
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
  fromJSON(object: any): MsgChannelOpenInit {
    const obj = createBaseMsgChannelOpenInit();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel)) obj.channel = Channel.fromJSON(object.channel);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelOpenInit): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel !== undefined &&
      (obj.channel = message.channel ? Channel.toJSON(message.channel) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenInit>, I>>(object: I): MsgChannelOpenInit {
    const message = createBaseMsgChannelOpenInit();
    message.port_id = object.port_id ?? "";
    if (object.channel !== undefined && object.channel !== null) {
      message.channel = Channel.fromPartial(object.channel);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelOpenInitResponse(): MsgChannelOpenInitResponse {
  return {
    channel_id: "",
    version: "",
    unsigned_tx: undefined,
  };
}
/**
 * MsgChannelOpenInitResponse defines the Msg/ChannelOpenInit response type.
 * @name MsgChannelOpenInitResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenInitResponse
 */
export const MsgChannelOpenInitResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenInitResponse",
  encode(message: MsgChannelOpenInitResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.channel_id !== "") {
      writer.uint32(10).string(message.channel_id);
    }
    if (message.version !== "") {
      writer.uint32(18).string(message.version);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenInitResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenInitResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.channel_id = reader.string();
          break;
        case 2:
          message.version = reader.string();
          break;
        case 3:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelOpenInitResponse {
    const obj = createBaseMsgChannelOpenInitResponse();
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.version)) obj.version = String(object.version);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelOpenInitResponse): unknown {
    const obj: any = {};
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.version !== undefined && (obj.version = message.version);
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenInitResponse>, I>>(
    object: I,
  ): MsgChannelOpenInitResponse {
    const message = createBaseMsgChannelOpenInitResponse();
    message.channel_id = object.channel_id ?? "";
    message.version = object.version ?? "";
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelOpenTry(): MsgChannelOpenTry {
  return {
    port_id: "",
    previous_channel_id: "",
    channel: Channel.fromPartial({}),
    counterparty_version: "",
    proof_init: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * MsgChannelOpenInit defines a msg sent by a Relayer to try to open a channel
 * on Chain B. The version field within the Channel field has been deprecated. Its
 * value will be ignored by core IBC.
 * @name MsgChannelOpenTry
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenTry
 */
export const MsgChannelOpenTry = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenTry",
  encode(message: MsgChannelOpenTry, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.previous_channel_id !== "") {
      writer.uint32(18).string(message.previous_channel_id);
    }
    if (message.channel !== undefined) {
      Channel.encode(message.channel, writer.uint32(26).fork()).ldelim();
    }
    if (message.counterparty_version !== "") {
      writer.uint32(34).string(message.counterparty_version);
    }
    if (message.proof_init.length !== 0) {
      writer.uint32(42).bytes(message.proof_init);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(50).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(58).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenTry {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenTry();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.previous_channel_id = reader.string();
          break;
        case 3:
          message.channel = Channel.decode(reader, reader.uint32());
          break;
        case 4:
          message.counterparty_version = reader.string();
          break;
        case 5:
          message.proof_init = reader.bytes();
          break;
        case 6:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 7:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelOpenTry {
    const obj = createBaseMsgChannelOpenTry();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.previous_channel_id)) obj.previous_channel_id = String(object.previous_channel_id);
    if (isSet(object.channel)) obj.channel = Channel.fromJSON(object.channel);
    if (isSet(object.counterparty_version)) obj.counterparty_version = String(object.counterparty_version);
    if (isSet(object.proof_init)) obj.proof_init = bytesFromBase64(object.proof_init);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelOpenTry): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.previous_channel_id !== undefined && (obj.previous_channel_id = message.previous_channel_id);
    message.channel !== undefined &&
      (obj.channel = message.channel ? Channel.toJSON(message.channel) : undefined);
    message.counterparty_version !== undefined && (obj.counterparty_version = message.counterparty_version);
    message.proof_init !== undefined &&
      (obj.proof_init = base64FromBytes(
        message.proof_init !== undefined ? message.proof_init : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenTry>, I>>(object: I): MsgChannelOpenTry {
    const message = createBaseMsgChannelOpenTry();
    message.port_id = object.port_id ?? "";
    message.previous_channel_id = object.previous_channel_id ?? "";
    if (object.channel !== undefined && object.channel !== null) {
      message.channel = Channel.fromPartial(object.channel);
    }
    message.counterparty_version = object.counterparty_version ?? "";
    message.proof_init = object.proof_init ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelOpenTryResponse(): MsgChannelOpenTryResponse {
  return {
    version: "",
    unsigned_tx: undefined,
  };
}
/**
 * MsgChannelOpenTryResponse defines the Msg/ChannelOpenTry response type.
 * @name MsgChannelOpenTryResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenTryResponse
 */
export const MsgChannelOpenTryResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenTryResponse",
  encode(message: MsgChannelOpenTryResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.version !== "") {
      writer.uint32(10).string(message.version);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenTryResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenTryResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.version = reader.string();
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelOpenTryResponse {
    const obj = createBaseMsgChannelOpenTryResponse();
    if (isSet(object.version)) obj.version = String(object.version);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelOpenTryResponse): unknown {
    const obj: any = {};
    message.version !== undefined && (obj.version = message.version);
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenTryResponse>, I>>(
    object: I,
  ): MsgChannelOpenTryResponse {
    const message = createBaseMsgChannelOpenTryResponse();
    message.version = object.version ?? "";
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelOpenAck(): MsgChannelOpenAck {
  return {
    port_id: "",
    channel_id: "",
    counterparty_channel_id: "",
    counterparty_version: "",
    proof_try: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * MsgChannelOpenAck defines a msg sent by a Relayer to Chain A to acknowledge
 * the change of channel state to TRYOPEN on Chain B.
 * @name MsgChannelOpenAck
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenAck
 */
export const MsgChannelOpenAck = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenAck",
  encode(message: MsgChannelOpenAck, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.counterparty_channel_id !== "") {
      writer.uint32(26).string(message.counterparty_channel_id);
    }
    if (message.counterparty_version !== "") {
      writer.uint32(34).string(message.counterparty_version);
    }
    if (message.proof_try.length !== 0) {
      writer.uint32(42).bytes(message.proof_try);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(50).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(58).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenAck {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenAck();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.counterparty_channel_id = reader.string();
          break;
        case 4:
          message.counterparty_version = reader.string();
          break;
        case 5:
          message.proof_try = reader.bytes();
          break;
        case 6:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 7:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelOpenAck {
    const obj = createBaseMsgChannelOpenAck();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.counterparty_channel_id))
      obj.counterparty_channel_id = String(object.counterparty_channel_id);
    if (isSet(object.counterparty_version)) obj.counterparty_version = String(object.counterparty_version);
    if (isSet(object.proof_try)) obj.proof_try = bytesFromBase64(object.proof_try);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelOpenAck): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.counterparty_channel_id !== undefined &&
      (obj.counterparty_channel_id = message.counterparty_channel_id);
    message.counterparty_version !== undefined && (obj.counterparty_version = message.counterparty_version);
    message.proof_try !== undefined &&
      (obj.proof_try = base64FromBytes(
        message.proof_try !== undefined ? message.proof_try : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenAck>, I>>(object: I): MsgChannelOpenAck {
    const message = createBaseMsgChannelOpenAck();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.counterparty_channel_id = object.counterparty_channel_id ?? "";
    message.counterparty_version = object.counterparty_version ?? "";
    message.proof_try = object.proof_try ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelOpenAckResponse(): MsgChannelOpenAckResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * MsgChannelOpenAckResponse defines the Msg/ChannelOpenAck response type.
 * @name MsgChannelOpenAckResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenAckResponse
 */
export const MsgChannelOpenAckResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenAckResponse",
  encode(message: MsgChannelOpenAckResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenAckResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenAckResponse();
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
  fromJSON(object: any): MsgChannelOpenAckResponse {
    const obj = createBaseMsgChannelOpenAckResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelOpenAckResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenAckResponse>, I>>(
    object: I,
  ): MsgChannelOpenAckResponse {
    const message = createBaseMsgChannelOpenAckResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelOpenConfirm(): MsgChannelOpenConfirm {
  return {
    port_id: "",
    channel_id: "",
    proof_ack: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * MsgChannelOpenConfirm defines a msg sent by a Relayer to Chain B to
 * acknowledge the change of channel state to OPEN on Chain A.
 * @name MsgChannelOpenConfirm
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenConfirm
 */
export const MsgChannelOpenConfirm = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenConfirm",
  encode(message: MsgChannelOpenConfirm, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.proof_ack.length !== 0) {
      writer.uint32(26).bytes(message.proof_ack);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(34).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(42).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenConfirm {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenConfirm();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.proof_ack = reader.bytes();
          break;
        case 4:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 5:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelOpenConfirm {
    const obj = createBaseMsgChannelOpenConfirm();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.proof_ack)) obj.proof_ack = bytesFromBase64(object.proof_ack);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelOpenConfirm): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.proof_ack !== undefined &&
      (obj.proof_ack = base64FromBytes(
        message.proof_ack !== undefined ? message.proof_ack : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenConfirm>, I>>(object: I): MsgChannelOpenConfirm {
    const message = createBaseMsgChannelOpenConfirm();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.proof_ack = object.proof_ack ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelOpenConfirmResponse(): MsgChannelOpenConfirmResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * MsgChannelOpenConfirmResponse defines the Msg/ChannelOpenConfirm response
 * type.
 * @name MsgChannelOpenConfirmResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelOpenConfirmResponse
 */
export const MsgChannelOpenConfirmResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelOpenConfirmResponse",
  encode(message: MsgChannelOpenConfirmResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelOpenConfirmResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelOpenConfirmResponse();
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
  fromJSON(object: any): MsgChannelOpenConfirmResponse {
    const obj = createBaseMsgChannelOpenConfirmResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelOpenConfirmResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelOpenConfirmResponse>, I>>(
    object: I,
  ): MsgChannelOpenConfirmResponse {
    const message = createBaseMsgChannelOpenConfirmResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelCloseInit(): MsgChannelCloseInit {
  return {
    port_id: "",
    channel_id: "",
    signer: "",
  };
}
/**
 * MsgChannelCloseInit defines a msg sent by a Relayer to Chain A
 * to close a channel with Chain B.
 * @name MsgChannelCloseInit
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseInit
 */
export const MsgChannelCloseInit = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelCloseInit",
  encode(message: MsgChannelCloseInit, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.signer !== "") {
      writer.uint32(26).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelCloseInit {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelCloseInit();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
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
  fromJSON(object: any): MsgChannelCloseInit {
    const obj = createBaseMsgChannelCloseInit();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelCloseInit): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelCloseInit>, I>>(object: I): MsgChannelCloseInit {
    const message = createBaseMsgChannelCloseInit();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelCloseInitResponse(): MsgChannelCloseInitResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * MsgChannelCloseInitResponse defines the Msg/ChannelCloseInit response type.
 * @name MsgChannelCloseInitResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseInitResponse
 */
export const MsgChannelCloseInitResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelCloseInitResponse",
  encode(message: MsgChannelCloseInitResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelCloseInitResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelCloseInitResponse();
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
  fromJSON(object: any): MsgChannelCloseInitResponse {
    const obj = createBaseMsgChannelCloseInitResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelCloseInitResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelCloseInitResponse>, I>>(
    object: I,
  ): MsgChannelCloseInitResponse {
    const message = createBaseMsgChannelCloseInitResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelCloseConfirm(): MsgChannelCloseConfirm {
  return {
    port_id: "",
    channel_id: "",
    proof_init: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
    counterparty_upgrade_sequence: BigInt(0),
  };
}
/**
 * MsgChannelCloseConfirm defines a msg sent by a Relayer to Chain B
 * to acknowledge the change of channel state to CLOSED on Chain A.
 * @name MsgChannelCloseConfirm
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseConfirm
 */
export const MsgChannelCloseConfirm = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelCloseConfirm",
  encode(message: MsgChannelCloseConfirm, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.proof_init.length !== 0) {
      writer.uint32(26).bytes(message.proof_init);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(34).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(42).string(message.signer);
    }
    if (message.counterparty_upgrade_sequence !== BigInt(0)) {
      writer.uint32(48).uint64(message.counterparty_upgrade_sequence);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelCloseConfirm {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelCloseConfirm();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.proof_init = reader.bytes();
          break;
        case 4:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 5:
          message.signer = reader.string();
          break;
        case 6:
          message.counterparty_upgrade_sequence = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelCloseConfirm {
    const obj = createBaseMsgChannelCloseConfirm();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.proof_init)) obj.proof_init = bytesFromBase64(object.proof_init);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.counterparty_upgrade_sequence))
      obj.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    return obj;
  },
  toJSON(message: MsgChannelCloseConfirm): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.proof_init !== undefined &&
      (obj.proof_init = base64FromBytes(
        message.proof_init !== undefined ? message.proof_init : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    message.counterparty_upgrade_sequence !== undefined &&
      (obj.counterparty_upgrade_sequence = (message.counterparty_upgrade_sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelCloseConfirm>, I>>(object: I): MsgChannelCloseConfirm {
    const message = createBaseMsgChannelCloseConfirm();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.proof_init = object.proof_init ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    if (object.counterparty_upgrade_sequence !== undefined && object.counterparty_upgrade_sequence !== null) {
      message.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    }
    return message;
  },
};
function createBaseMsgChannelCloseConfirmResponse(): MsgChannelCloseConfirmResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * MsgChannelCloseConfirmResponse defines the Msg/ChannelCloseConfirm response
 * type.
 * @name MsgChannelCloseConfirmResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelCloseConfirmResponse
 */
export const MsgChannelCloseConfirmResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelCloseConfirmResponse",
  encode(
    message: MsgChannelCloseConfirmResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelCloseConfirmResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelCloseConfirmResponse();
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
  fromJSON(object: any): MsgChannelCloseConfirmResponse {
    const obj = createBaseMsgChannelCloseConfirmResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelCloseConfirmResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelCloseConfirmResponse>, I>>(
    object: I,
  ): MsgChannelCloseConfirmResponse {
    const message = createBaseMsgChannelCloseConfirmResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgRecvPacket(): MsgRecvPacket {
  return {
    packet: Packet.fromPartial({}),
    proof_commitment: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * MsgRecvPacket receives incoming IBC packet
 * @name MsgRecvPacket
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgRecvPacket
 */
export const MsgRecvPacket = {
  typeUrl: "/ibc.core.channel.v1.MsgRecvPacket",
  encode(message: MsgRecvPacket, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet !== undefined) {
      Packet.encode(message.packet, writer.uint32(10).fork()).ldelim();
    }
    if (message.proof_commitment.length !== 0) {
      writer.uint32(18).bytes(message.proof_commitment);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(34).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRecvPacket {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRecvPacket();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet = Packet.decode(reader, reader.uint32());
          break;
        case 2:
          message.proof_commitment = reader.bytes();
          break;
        case 3:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 4:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgRecvPacket {
    const obj = createBaseMsgRecvPacket();
    if (isSet(object.packet)) obj.packet = Packet.fromJSON(object.packet);
    if (isSet(object.proof_commitment)) obj.proof_commitment = bytesFromBase64(object.proof_commitment);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgRecvPacket): unknown {
    const obj: any = {};
    message.packet !== undefined && (obj.packet = message.packet ? Packet.toJSON(message.packet) : undefined);
    message.proof_commitment !== undefined &&
      (obj.proof_commitment = base64FromBytes(
        message.proof_commitment !== undefined ? message.proof_commitment : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRecvPacket>, I>>(object: I): MsgRecvPacket {
    const message = createBaseMsgRecvPacket();
    if (object.packet !== undefined && object.packet !== null) {
      message.packet = Packet.fromPartial(object.packet);
    }
    message.proof_commitment = object.proof_commitment ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgRecvPacketResponse(): MsgRecvPacketResponse {
  return {
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * MsgRecvPacketResponse defines the Msg/RecvPacket response type.
 * @name MsgRecvPacketResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgRecvPacketResponse
 */
export const MsgRecvPacketResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgRecvPacketResponse",
  encode(message: MsgRecvPacketResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.result !== 0) {
      writer.uint32(8).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgRecvPacketResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgRecvPacketResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = reader.int32() as any;
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgRecvPacketResponse {
    const obj = createBaseMsgRecvPacketResponse();
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgRecvPacketResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgRecvPacketResponse>, I>>(object: I): MsgRecvPacketResponse {
    const message = createBaseMsgRecvPacketResponse();
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgTimeout(): MsgTimeout {
  return {
    packet: Packet.fromPartial({}),
    proof_unreceived: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    next_sequence_recv: BigInt(0),
    signer: "",
  };
}
/**
 * MsgTimeout receives timed-out packet
 * @name MsgTimeout
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeout
 */
export const MsgTimeout = {
  typeUrl: "/ibc.core.channel.v1.MsgTimeout",
  encode(message: MsgTimeout, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet !== undefined) {
      Packet.encode(message.packet, writer.uint32(10).fork()).ldelim();
    }
    if (message.proof_unreceived.length !== 0) {
      writer.uint32(18).bytes(message.proof_unreceived);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(26).fork()).ldelim();
    }
    if (message.next_sequence_recv !== BigInt(0)) {
      writer.uint32(32).uint64(message.next_sequence_recv);
    }
    if (message.signer !== "") {
      writer.uint32(42).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgTimeout {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgTimeout();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet = Packet.decode(reader, reader.uint32());
          break;
        case 2:
          message.proof_unreceived = reader.bytes();
          break;
        case 3:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 4:
          message.next_sequence_recv = reader.uint64();
          break;
        case 5:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgTimeout {
    const obj = createBaseMsgTimeout();
    if (isSet(object.packet)) obj.packet = Packet.fromJSON(object.packet);
    if (isSet(object.proof_unreceived)) obj.proof_unreceived = bytesFromBase64(object.proof_unreceived);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.next_sequence_recv))
      obj.next_sequence_recv = BigInt(object.next_sequence_recv.toString());
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgTimeout): unknown {
    const obj: any = {};
    message.packet !== undefined && (obj.packet = message.packet ? Packet.toJSON(message.packet) : undefined);
    message.proof_unreceived !== undefined &&
      (obj.proof_unreceived = base64FromBytes(
        message.proof_unreceived !== undefined ? message.proof_unreceived : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.next_sequence_recv !== undefined &&
      (obj.next_sequence_recv = (message.next_sequence_recv || BigInt(0)).toString());
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgTimeout>, I>>(object: I): MsgTimeout {
    const message = createBaseMsgTimeout();
    if (object.packet !== undefined && object.packet !== null) {
      message.packet = Packet.fromPartial(object.packet);
    }
    message.proof_unreceived = object.proof_unreceived ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    if (object.next_sequence_recv !== undefined && object.next_sequence_recv !== null) {
      message.next_sequence_recv = BigInt(object.next_sequence_recv.toString());
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgTimeoutResponse(): MsgTimeoutResponse {
  return {
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * MsgTimeoutResponse defines the Msg/Timeout response type.
 * @name MsgTimeoutResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeoutResponse
 */
export const MsgTimeoutResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgTimeoutResponse",
  encode(message: MsgTimeoutResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.result !== 0) {
      writer.uint32(8).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgTimeoutResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgTimeoutResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = reader.int32() as any;
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgTimeoutResponse {
    const obj = createBaseMsgTimeoutResponse();
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgTimeoutResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgTimeoutResponse>, I>>(object: I): MsgTimeoutResponse {
    const message = createBaseMsgTimeoutResponse();
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgTimeoutOnClose(): MsgTimeoutOnClose {
  return {
    packet: Packet.fromPartial({}),
    proof_unreceived: new Uint8Array(),
    proof_close: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    next_sequence_recv: BigInt(0),
    signer: "",
    counterparty_upgrade_sequence: BigInt(0),
  };
}
/**
 * MsgTimeoutOnClose timed-out packet upon counterparty channel closure.
 * @name MsgTimeoutOnClose
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeoutOnClose
 */
export const MsgTimeoutOnClose = {
  typeUrl: "/ibc.core.channel.v1.MsgTimeoutOnClose",
  encode(message: MsgTimeoutOnClose, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet !== undefined) {
      Packet.encode(message.packet, writer.uint32(10).fork()).ldelim();
    }
    if (message.proof_unreceived.length !== 0) {
      writer.uint32(18).bytes(message.proof_unreceived);
    }
    if (message.proof_close.length !== 0) {
      writer.uint32(26).bytes(message.proof_close);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(34).fork()).ldelim();
    }
    if (message.next_sequence_recv !== BigInt(0)) {
      writer.uint32(40).uint64(message.next_sequence_recv);
    }
    if (message.signer !== "") {
      writer.uint32(50).string(message.signer);
    }
    if (message.counterparty_upgrade_sequence !== BigInt(0)) {
      writer.uint32(56).uint64(message.counterparty_upgrade_sequence);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgTimeoutOnClose {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgTimeoutOnClose();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet = Packet.decode(reader, reader.uint32());
          break;
        case 2:
          message.proof_unreceived = reader.bytes();
          break;
        case 3:
          message.proof_close = reader.bytes();
          break;
        case 4:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 5:
          message.next_sequence_recv = reader.uint64();
          break;
        case 6:
          message.signer = reader.string();
          break;
        case 7:
          message.counterparty_upgrade_sequence = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgTimeoutOnClose {
    const obj = createBaseMsgTimeoutOnClose();
    if (isSet(object.packet)) obj.packet = Packet.fromJSON(object.packet);
    if (isSet(object.proof_unreceived)) obj.proof_unreceived = bytesFromBase64(object.proof_unreceived);
    if (isSet(object.proof_close)) obj.proof_close = bytesFromBase64(object.proof_close);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.next_sequence_recv))
      obj.next_sequence_recv = BigInt(object.next_sequence_recv.toString());
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.counterparty_upgrade_sequence))
      obj.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    return obj;
  },
  toJSON(message: MsgTimeoutOnClose): unknown {
    const obj: any = {};
    message.packet !== undefined && (obj.packet = message.packet ? Packet.toJSON(message.packet) : undefined);
    message.proof_unreceived !== undefined &&
      (obj.proof_unreceived = base64FromBytes(
        message.proof_unreceived !== undefined ? message.proof_unreceived : new Uint8Array(),
      ));
    message.proof_close !== undefined &&
      (obj.proof_close = base64FromBytes(
        message.proof_close !== undefined ? message.proof_close : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.next_sequence_recv !== undefined &&
      (obj.next_sequence_recv = (message.next_sequence_recv || BigInt(0)).toString());
    message.signer !== undefined && (obj.signer = message.signer);
    message.counterparty_upgrade_sequence !== undefined &&
      (obj.counterparty_upgrade_sequence = (message.counterparty_upgrade_sequence || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgTimeoutOnClose>, I>>(object: I): MsgTimeoutOnClose {
    const message = createBaseMsgTimeoutOnClose();
    if (object.packet !== undefined && object.packet !== null) {
      message.packet = Packet.fromPartial(object.packet);
    }
    message.proof_unreceived = object.proof_unreceived ?? new Uint8Array();
    message.proof_close = object.proof_close ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    if (object.next_sequence_recv !== undefined && object.next_sequence_recv !== null) {
      message.next_sequence_recv = BigInt(object.next_sequence_recv.toString());
    }
    message.signer = object.signer ?? "";
    if (object.counterparty_upgrade_sequence !== undefined && object.counterparty_upgrade_sequence !== null) {
      message.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    }
    return message;
  },
};
function createBaseMsgTimeoutOnCloseResponse(): MsgTimeoutOnCloseResponse {
  return {
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * MsgTimeoutOnCloseResponse defines the Msg/TimeoutOnClose response type.
 * @name MsgTimeoutOnCloseResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTimeoutOnCloseResponse
 */
export const MsgTimeoutOnCloseResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgTimeoutOnCloseResponse",
  encode(message: MsgTimeoutOnCloseResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.result !== 0) {
      writer.uint32(8).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgTimeoutOnCloseResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgTimeoutOnCloseResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = reader.int32() as any;
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgTimeoutOnCloseResponse {
    const obj = createBaseMsgTimeoutOnCloseResponse();
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgTimeoutOnCloseResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgTimeoutOnCloseResponse>, I>>(
    object: I,
  ): MsgTimeoutOnCloseResponse {
    const message = createBaseMsgTimeoutOnCloseResponse();
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgAcknowledgement(): MsgAcknowledgement {
  return {
    packet: Packet.fromPartial({}),
    acknowledgement: new Uint8Array(),
    proof_acked: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * MsgAcknowledgement receives incoming IBC acknowledgement
 * @name MsgAcknowledgement
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgAcknowledgement
 */
export const MsgAcknowledgement = {
  typeUrl: "/ibc.core.channel.v1.MsgAcknowledgement",
  encode(message: MsgAcknowledgement, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.packet !== undefined) {
      Packet.encode(message.packet, writer.uint32(10).fork()).ldelim();
    }
    if (message.acknowledgement.length !== 0) {
      writer.uint32(18).bytes(message.acknowledgement);
    }
    if (message.proof_acked.length !== 0) {
      writer.uint32(26).bytes(message.proof_acked);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(34).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(42).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgAcknowledgement {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgAcknowledgement();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.packet = Packet.decode(reader, reader.uint32());
          break;
        case 2:
          message.acknowledgement = reader.bytes();
          break;
        case 3:
          message.proof_acked = reader.bytes();
          break;
        case 4:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 5:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgAcknowledgement {
    const obj = createBaseMsgAcknowledgement();
    if (isSet(object.packet)) obj.packet = Packet.fromJSON(object.packet);
    if (isSet(object.acknowledgement)) obj.acknowledgement = bytesFromBase64(object.acknowledgement);
    if (isSet(object.proof_acked)) obj.proof_acked = bytesFromBase64(object.proof_acked);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgAcknowledgement): unknown {
    const obj: any = {};
    message.packet !== undefined && (obj.packet = message.packet ? Packet.toJSON(message.packet) : undefined);
    message.acknowledgement !== undefined &&
      (obj.acknowledgement = base64FromBytes(
        message.acknowledgement !== undefined ? message.acknowledgement : new Uint8Array(),
      ));
    message.proof_acked !== undefined &&
      (obj.proof_acked = base64FromBytes(
        message.proof_acked !== undefined ? message.proof_acked : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgAcknowledgement>, I>>(object: I): MsgAcknowledgement {
    const message = createBaseMsgAcknowledgement();
    if (object.packet !== undefined && object.packet !== null) {
      message.packet = Packet.fromPartial(object.packet);
    }
    message.acknowledgement = object.acknowledgement ?? new Uint8Array();
    message.proof_acked = object.proof_acked ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgAcknowledgementResponse(): MsgAcknowledgementResponse {
  return {
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * MsgAcknowledgementResponse defines the Msg/Acknowledgement response type.
 * @name MsgAcknowledgementResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgAcknowledgementResponse
 */
export const MsgAcknowledgementResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgAcknowledgementResponse",
  encode(message: MsgAcknowledgementResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.result !== 0) {
      writer.uint32(8).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgAcknowledgementResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgAcknowledgementResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = reader.int32() as any;
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgAcknowledgementResponse {
    const obj = createBaseMsgAcknowledgementResponse();
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgAcknowledgementResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgAcknowledgementResponse>, I>>(
    object: I,
  ): MsgAcknowledgementResponse {
    const message = createBaseMsgAcknowledgementResponse();
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgTransfer(): MsgTransfer {
  return {
    source_port: "",
    source_channel: "",
    token: Coin.fromPartial({}),
    sender: "",
    receiver: "",
    timeout_height: undefined,
    timeout_timestamp: BigInt(0),
    memo: "",
    signer: "",
  };
}
/**
 * MsgTransfer send packet
 * @name MsgTransfer
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTransfer
 */
export const MsgTransfer = {
  typeUrl: "/ibc.core.channel.v1.MsgTransfer",
  encode(message: MsgTransfer, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.source_port !== "") {
      writer.uint32(10).string(message.source_port);
    }
    if (message.source_channel !== "") {
      writer.uint32(18).string(message.source_channel);
    }
    if (message.token !== undefined) {
      Coin.encode(message.token, writer.uint32(26).fork()).ldelim();
    }
    if (message.sender !== "") {
      writer.uint32(34).string(message.sender);
    }
    if (message.receiver !== "") {
      writer.uint32(42).string(message.receiver);
    }
    if (message.timeout_height !== undefined) {
      Height.encode(message.timeout_height, writer.uint32(50).fork()).ldelim();
    }
    if (message.timeout_timestamp !== BigInt(0)) {
      writer.uint32(56).uint64(message.timeout_timestamp);
    }
    if (message.memo !== "") {
      writer.uint32(66).string(message.memo);
    }
    if (message.signer !== "") {
      writer.uint32(74).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgTransfer {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgTransfer();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.source_port = reader.string();
          break;
        case 2:
          message.source_channel = reader.string();
          break;
        case 3:
          message.token = Coin.decode(reader, reader.uint32());
          break;
        case 4:
          message.sender = reader.string();
          break;
        case 5:
          message.receiver = reader.string();
          break;
        case 6:
          message.timeout_height = Height.decode(reader, reader.uint32());
          break;
        case 7:
          message.timeout_timestamp = reader.uint64();
          break;
        case 8:
          message.memo = reader.string();
          break;
        case 9:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgTransfer {
    const obj = createBaseMsgTransfer();
    if (isSet(object.source_port)) obj.source_port = String(object.source_port);
    if (isSet(object.source_channel)) obj.source_channel = String(object.source_channel);
    if (isSet(object.token)) obj.token = Coin.fromJSON(object.token);
    if (isSet(object.sender)) obj.sender = String(object.sender);
    if (isSet(object.receiver)) obj.receiver = String(object.receiver);
    if (isSet(object.timeout_height)) obj.timeout_height = Height.fromJSON(object.timeout_height);
    if (isSet(object.timeout_timestamp)) obj.timeout_timestamp = BigInt(object.timeout_timestamp.toString());
    if (isSet(object.memo)) obj.memo = String(object.memo);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgTransfer): unknown {
    const obj: any = {};
    message.source_port !== undefined && (obj.source_port = message.source_port);
    message.source_channel !== undefined && (obj.source_channel = message.source_channel);
    message.token !== undefined && (obj.token = message.token ? Coin.toJSON(message.token) : undefined);
    message.sender !== undefined && (obj.sender = message.sender);
    message.receiver !== undefined && (obj.receiver = message.receiver);
    message.timeout_height !== undefined &&
      (obj.timeout_height = message.timeout_height ? Height.toJSON(message.timeout_height) : undefined);
    message.timeout_timestamp !== undefined &&
      (obj.timeout_timestamp = (message.timeout_timestamp || BigInt(0)).toString());
    message.memo !== undefined && (obj.memo = message.memo);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgTransfer>, I>>(object: I): MsgTransfer {
    const message = createBaseMsgTransfer();
    message.source_port = object.source_port ?? "";
    message.source_channel = object.source_channel ?? "";
    if (object.token !== undefined && object.token !== null) {
      message.token = Coin.fromPartial(object.token);
    }
    message.sender = object.sender ?? "";
    message.receiver = object.receiver ?? "";
    if (object.timeout_height !== undefined && object.timeout_height !== null) {
      message.timeout_height = Height.fromPartial(object.timeout_height);
    }
    if (object.timeout_timestamp !== undefined && object.timeout_timestamp !== null) {
      message.timeout_timestamp = BigInt(object.timeout_timestamp.toString());
    }
    message.memo = object.memo ?? "";
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgTransferResponse(): MsgTransferResponse {
  return {
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * MsgTransferResponse defines the Msg/Transfer response type.
 * @name MsgTransferResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgTransferResponse
 */
export const MsgTransferResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgTransferResponse",
  encode(message: MsgTransferResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.result !== 0) {
      writer.uint32(8).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgTransferResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgTransferResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = reader.int32() as any;
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgTransferResponse {
    const obj = createBaseMsgTransferResponse();
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgTransferResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgTransferResponse>, I>>(object: I): MsgTransferResponse {
    const message = createBaseMsgTransferResponse();
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeInit(): MsgChannelUpgradeInit {
  return {
    port_id: "",
    channel_id: "",
    fields: UpgradeFields.fromPartial({}),
    signer: "",
    timeout_period_ms: BigInt(0),
  };
}
/**
 * MsgChannelUpgradeInit is the deployment authority's proposal to upgrade a channel.
 * @name MsgChannelUpgradeInit
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeInit
 */
export const MsgChannelUpgradeInit = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeInit",
  encode(message: MsgChannelUpgradeInit, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.fields !== undefined) {
      UpgradeFields.encode(message.fields, writer.uint32(26).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(34).string(message.signer);
    }
    if (message.timeout_period_ms !== BigInt(0)) {
      writer.uint32(40).uint64(message.timeout_period_ms);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeInit {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeInit();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.fields = UpgradeFields.decode(reader, reader.uint32());
          break;
        case 4:
          message.signer = reader.string();
          break;
        case 5:
          message.timeout_period_ms = reader.uint64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeInit {
    const obj = createBaseMsgChannelUpgradeInit();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.fields)) obj.fields = UpgradeFields.fromJSON(object.fields);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    if (isSet(object.timeout_period_ms)) obj.timeout_period_ms = BigInt(object.timeout_period_ms.toString());
    return obj;
  },
  toJSON(message: MsgChannelUpgradeInit): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.fields !== undefined &&
      (obj.fields = message.fields ? UpgradeFields.toJSON(message.fields) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    message.timeout_period_ms !== undefined &&
      (obj.timeout_period_ms = (message.timeout_period_ms || BigInt(0)).toString());
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeInit>, I>>(object: I): MsgChannelUpgradeInit {
    const message = createBaseMsgChannelUpgradeInit();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.fields !== undefined && object.fields !== null) {
      message.fields = UpgradeFields.fromPartial(object.fields);
    }
    message.signer = object.signer ?? "";
    if (object.timeout_period_ms !== undefined && object.timeout_period_ms !== null) {
      message.timeout_period_ms = BigInt(object.timeout_period_ms.toString());
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeInitResponse(): MsgChannelUpgradeInitResponse {
  return {
    upgrade: Upgrade.fromPartial({}),
    upgrade_sequence: BigInt(0),
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeInitResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeInitResponse
 */
export const MsgChannelUpgradeInitResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeInitResponse",
  encode(message: MsgChannelUpgradeInitResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.upgrade !== undefined) {
      Upgrade.encode(message.upgrade, writer.uint32(10).fork()).ldelim();
    }
    if (message.upgrade_sequence !== BigInt(0)) {
      writer.uint32(16).uint64(message.upgrade_sequence);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeInitResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeInitResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.upgrade = Upgrade.decode(reader, reader.uint32());
          break;
        case 2:
          message.upgrade_sequence = reader.uint64();
          break;
        case 3:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeInitResponse {
    const obj = createBaseMsgChannelUpgradeInitResponse();
    if (isSet(object.upgrade)) obj.upgrade = Upgrade.fromJSON(object.upgrade);
    if (isSet(object.upgrade_sequence)) obj.upgrade_sequence = BigInt(object.upgrade_sequence.toString());
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeInitResponse): unknown {
    const obj: any = {};
    message.upgrade !== undefined &&
      (obj.upgrade = message.upgrade ? Upgrade.toJSON(message.upgrade) : undefined);
    message.upgrade_sequence !== undefined &&
      (obj.upgrade_sequence = (message.upgrade_sequence || BigInt(0)).toString());
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeInitResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeInitResponse {
    const message = createBaseMsgChannelUpgradeInitResponse();
    if (object.upgrade !== undefined && object.upgrade !== null) {
      message.upgrade = Upgrade.fromPartial(object.upgrade);
    }
    if (object.upgrade_sequence !== undefined && object.upgrade_sequence !== null) {
      message.upgrade_sequence = BigInt(object.upgrade_sequence.toString());
    }
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeTry(): MsgChannelUpgradeTry {
  return {
    port_id: "",
    channel_id: "",
    proposed_upgrade_connection_hops: [],
    counterparty_upgrade_fields: UpgradeFields.fromPartial({}),
    counterparty_upgrade_sequence: BigInt(0),
    proof_channel: new Uint8Array(),
    proof_upgrade: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * @name MsgChannelUpgradeTry
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTry
 */
export const MsgChannelUpgradeTry = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeTry",
  encode(message: MsgChannelUpgradeTry, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    for (const v of message.proposed_upgrade_connection_hops) {
      writer.uint32(26).string(v!);
    }
    if (message.counterparty_upgrade_fields !== undefined) {
      UpgradeFields.encode(message.counterparty_upgrade_fields, writer.uint32(34).fork()).ldelim();
    }
    if (message.counterparty_upgrade_sequence !== BigInt(0)) {
      writer.uint32(40).uint64(message.counterparty_upgrade_sequence);
    }
    if (message.proof_channel.length !== 0) {
      writer.uint32(50).bytes(message.proof_channel);
    }
    if (message.proof_upgrade.length !== 0) {
      writer.uint32(58).bytes(message.proof_upgrade);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(66).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(74).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeTry {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeTry();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.proposed_upgrade_connection_hops.push(reader.string());
          break;
        case 4:
          message.counterparty_upgrade_fields = UpgradeFields.decode(reader, reader.uint32());
          break;
        case 5:
          message.counterparty_upgrade_sequence = reader.uint64();
          break;
        case 6:
          message.proof_channel = reader.bytes();
          break;
        case 7:
          message.proof_upgrade = reader.bytes();
          break;
        case 8:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 9:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeTry {
    const obj = createBaseMsgChannelUpgradeTry();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (Array.isArray(object?.proposed_upgrade_connection_hops))
      obj.proposed_upgrade_connection_hops = object.proposed_upgrade_connection_hops.map((e: any) =>
        String(e),
      );
    if (isSet(object.counterparty_upgrade_fields))
      obj.counterparty_upgrade_fields = UpgradeFields.fromJSON(object.counterparty_upgrade_fields);
    if (isSet(object.counterparty_upgrade_sequence))
      obj.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    if (isSet(object.proof_channel)) obj.proof_channel = bytesFromBase64(object.proof_channel);
    if (isSet(object.proof_upgrade)) obj.proof_upgrade = bytesFromBase64(object.proof_upgrade);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeTry): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    if (message.proposed_upgrade_connection_hops) {
      obj.proposed_upgrade_connection_hops = message.proposed_upgrade_connection_hops.map((e) => e);
    } else {
      obj.proposed_upgrade_connection_hops = [];
    }
    message.counterparty_upgrade_fields !== undefined &&
      (obj.counterparty_upgrade_fields = message.counterparty_upgrade_fields
        ? UpgradeFields.toJSON(message.counterparty_upgrade_fields)
        : undefined);
    message.counterparty_upgrade_sequence !== undefined &&
      (obj.counterparty_upgrade_sequence = (message.counterparty_upgrade_sequence || BigInt(0)).toString());
    message.proof_channel !== undefined &&
      (obj.proof_channel = base64FromBytes(
        message.proof_channel !== undefined ? message.proof_channel : new Uint8Array(),
      ));
    message.proof_upgrade !== undefined &&
      (obj.proof_upgrade = base64FromBytes(
        message.proof_upgrade !== undefined ? message.proof_upgrade : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeTry>, I>>(object: I): MsgChannelUpgradeTry {
    const message = createBaseMsgChannelUpgradeTry();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.proposed_upgrade_connection_hops = object.proposed_upgrade_connection_hops?.map((e) => e) || [];
    if (object.counterparty_upgrade_fields !== undefined && object.counterparty_upgrade_fields !== null) {
      message.counterparty_upgrade_fields = UpgradeFields.fromPartial(object.counterparty_upgrade_fields);
    }
    if (object.counterparty_upgrade_sequence !== undefined && object.counterparty_upgrade_sequence !== null) {
      message.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    }
    message.proof_channel = object.proof_channel ?? new Uint8Array();
    message.proof_upgrade = object.proof_upgrade ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelUpgradeTryResponse(): MsgChannelUpgradeTryResponse {
  return {
    upgrade: Upgrade.fromPartial({}),
    upgrade_sequence: BigInt(0),
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeTryResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTryResponse
 */
export const MsgChannelUpgradeTryResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeTryResponse",
  encode(message: MsgChannelUpgradeTryResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.upgrade !== undefined) {
      Upgrade.encode(message.upgrade, writer.uint32(10).fork()).ldelim();
    }
    if (message.upgrade_sequence !== BigInt(0)) {
      writer.uint32(16).uint64(message.upgrade_sequence);
    }
    if (message.result !== 0) {
      writer.uint32(24).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeTryResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeTryResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.upgrade = Upgrade.decode(reader, reader.uint32());
          break;
        case 2:
          message.upgrade_sequence = reader.uint64();
          break;
        case 3:
          message.result = reader.int32() as any;
          break;
        case 4:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeTryResponse {
    const obj = createBaseMsgChannelUpgradeTryResponse();
    if (isSet(object.upgrade)) obj.upgrade = Upgrade.fromJSON(object.upgrade);
    if (isSet(object.upgrade_sequence)) obj.upgrade_sequence = BigInt(object.upgrade_sequence.toString());
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeTryResponse): unknown {
    const obj: any = {};
    message.upgrade !== undefined &&
      (obj.upgrade = message.upgrade ? Upgrade.toJSON(message.upgrade) : undefined);
    message.upgrade_sequence !== undefined &&
      (obj.upgrade_sequence = (message.upgrade_sequence || BigInt(0)).toString());
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeTryResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeTryResponse {
    const message = createBaseMsgChannelUpgradeTryResponse();
    if (object.upgrade !== undefined && object.upgrade !== null) {
      message.upgrade = Upgrade.fromPartial(object.upgrade);
    }
    if (object.upgrade_sequence !== undefined && object.upgrade_sequence !== null) {
      message.upgrade_sequence = BigInt(object.upgrade_sequence.toString());
    }
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeAck(): MsgChannelUpgradeAck {
  return {
    port_id: "",
    channel_id: "",
    counterparty_upgrade: Upgrade.fromPartial({}),
    proof_channel: new Uint8Array(),
    proof_upgrade: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * @name MsgChannelUpgradeAck
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeAck
 */
export const MsgChannelUpgradeAck = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeAck",
  encode(message: MsgChannelUpgradeAck, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.counterparty_upgrade !== undefined) {
      Upgrade.encode(message.counterparty_upgrade, writer.uint32(26).fork()).ldelim();
    }
    if (message.proof_channel.length !== 0) {
      writer.uint32(34).bytes(message.proof_channel);
    }
    if (message.proof_upgrade.length !== 0) {
      writer.uint32(42).bytes(message.proof_upgrade);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(50).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(58).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeAck {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeAck();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.counterparty_upgrade = Upgrade.decode(reader, reader.uint32());
          break;
        case 4:
          message.proof_channel = reader.bytes();
          break;
        case 5:
          message.proof_upgrade = reader.bytes();
          break;
        case 6:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 7:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeAck {
    const obj = createBaseMsgChannelUpgradeAck();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.counterparty_upgrade))
      obj.counterparty_upgrade = Upgrade.fromJSON(object.counterparty_upgrade);
    if (isSet(object.proof_channel)) obj.proof_channel = bytesFromBase64(object.proof_channel);
    if (isSet(object.proof_upgrade)) obj.proof_upgrade = bytesFromBase64(object.proof_upgrade);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeAck): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.counterparty_upgrade !== undefined &&
      (obj.counterparty_upgrade = message.counterparty_upgrade
        ? Upgrade.toJSON(message.counterparty_upgrade)
        : undefined);
    message.proof_channel !== undefined &&
      (obj.proof_channel = base64FromBytes(
        message.proof_channel !== undefined ? message.proof_channel : new Uint8Array(),
      ));
    message.proof_upgrade !== undefined &&
      (obj.proof_upgrade = base64FromBytes(
        message.proof_upgrade !== undefined ? message.proof_upgrade : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeAck>, I>>(object: I): MsgChannelUpgradeAck {
    const message = createBaseMsgChannelUpgradeAck();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.counterparty_upgrade !== undefined && object.counterparty_upgrade !== null) {
      message.counterparty_upgrade = Upgrade.fromPartial(object.counterparty_upgrade);
    }
    message.proof_channel = object.proof_channel ?? new Uint8Array();
    message.proof_upgrade = object.proof_upgrade ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelUpgradeAckResponse(): MsgChannelUpgradeAckResponse {
  return {
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeAckResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeAckResponse
 */
export const MsgChannelUpgradeAckResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeAckResponse",
  encode(message: MsgChannelUpgradeAckResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.result !== 0) {
      writer.uint32(8).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeAckResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeAckResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = reader.int32() as any;
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeAckResponse {
    const obj = createBaseMsgChannelUpgradeAckResponse();
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeAckResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeAckResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeAckResponse {
    const message = createBaseMsgChannelUpgradeAckResponse();
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeConfirm(): MsgChannelUpgradeConfirm {
  return {
    port_id: "",
    channel_id: "",
    counterparty_channel_state: 0,
    counterparty_upgrade: Upgrade.fromPartial({}),
    proof_channel: new Uint8Array(),
    proof_upgrade: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * @name MsgChannelUpgradeConfirm
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeConfirm
 */
export const MsgChannelUpgradeConfirm = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeConfirm",
  encode(message: MsgChannelUpgradeConfirm, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.counterparty_channel_state !== 0) {
      writer.uint32(24).int32(message.counterparty_channel_state);
    }
    if (message.counterparty_upgrade !== undefined) {
      Upgrade.encode(message.counterparty_upgrade, writer.uint32(34).fork()).ldelim();
    }
    if (message.proof_channel.length !== 0) {
      writer.uint32(42).bytes(message.proof_channel);
    }
    if (message.proof_upgrade.length !== 0) {
      writer.uint32(50).bytes(message.proof_upgrade);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(58).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(66).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeConfirm {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeConfirm();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.counterparty_channel_state = reader.int32() as any;
          break;
        case 4:
          message.counterparty_upgrade = Upgrade.decode(reader, reader.uint32());
          break;
        case 5:
          message.proof_channel = reader.bytes();
          break;
        case 6:
          message.proof_upgrade = reader.bytes();
          break;
        case 7:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 8:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeConfirm {
    const obj = createBaseMsgChannelUpgradeConfirm();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.counterparty_channel_state))
      obj.counterparty_channel_state = stateFromJSON(object.counterparty_channel_state);
    if (isSet(object.counterparty_upgrade))
      obj.counterparty_upgrade = Upgrade.fromJSON(object.counterparty_upgrade);
    if (isSet(object.proof_channel)) obj.proof_channel = bytesFromBase64(object.proof_channel);
    if (isSet(object.proof_upgrade)) obj.proof_upgrade = bytesFromBase64(object.proof_upgrade);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeConfirm): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.counterparty_channel_state !== undefined &&
      (obj.counterparty_channel_state = stateToJSON(message.counterparty_channel_state));
    message.counterparty_upgrade !== undefined &&
      (obj.counterparty_upgrade = message.counterparty_upgrade
        ? Upgrade.toJSON(message.counterparty_upgrade)
        : undefined);
    message.proof_channel !== undefined &&
      (obj.proof_channel = base64FromBytes(
        message.proof_channel !== undefined ? message.proof_channel : new Uint8Array(),
      ));
    message.proof_upgrade !== undefined &&
      (obj.proof_upgrade = base64FromBytes(
        message.proof_upgrade !== undefined ? message.proof_upgrade : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeConfirm>, I>>(
    object: I,
  ): MsgChannelUpgradeConfirm {
    const message = createBaseMsgChannelUpgradeConfirm();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.counterparty_channel_state = object.counterparty_channel_state ?? 0;
    if (object.counterparty_upgrade !== undefined && object.counterparty_upgrade !== null) {
      message.counterparty_upgrade = Upgrade.fromPartial(object.counterparty_upgrade);
    }
    message.proof_channel = object.proof_channel ?? new Uint8Array();
    message.proof_upgrade = object.proof_upgrade ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelUpgradeConfirmResponse(): MsgChannelUpgradeConfirmResponse {
  return {
    result: 0,
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeConfirmResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeConfirmResponse
 */
export const MsgChannelUpgradeConfirmResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeConfirmResponse",
  encode(
    message: MsgChannelUpgradeConfirmResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.result !== 0) {
      writer.uint32(8).int32(message.result);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeConfirmResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeConfirmResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = reader.int32() as any;
          break;
        case 2:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeConfirmResponse {
    const obj = createBaseMsgChannelUpgradeConfirmResponse();
    if (isSet(object.result)) obj.result = responseResultTypeFromJSON(object.result);
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeConfirmResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = responseResultTypeToJSON(message.result));
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeConfirmResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeConfirmResponse {
    const message = createBaseMsgChannelUpgradeConfirmResponse();
    message.result = object.result ?? 0;
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeOpen(): MsgChannelUpgradeOpen {
  return {
    port_id: "",
    channel_id: "",
    counterparty_channel_state: 0,
    counterparty_upgrade_sequence: BigInt(0),
    proof_channel: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * @name MsgChannelUpgradeOpen
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeOpen
 */
export const MsgChannelUpgradeOpen = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeOpen",
  encode(message: MsgChannelUpgradeOpen, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.counterparty_channel_state !== 0) {
      writer.uint32(24).int32(message.counterparty_channel_state);
    }
    if (message.counterparty_upgrade_sequence !== BigInt(0)) {
      writer.uint32(32).uint64(message.counterparty_upgrade_sequence);
    }
    if (message.proof_channel.length !== 0) {
      writer.uint32(42).bytes(message.proof_channel);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(50).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(58).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeOpen {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeOpen();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.counterparty_channel_state = reader.int32() as any;
          break;
        case 4:
          message.counterparty_upgrade_sequence = reader.uint64();
          break;
        case 5:
          message.proof_channel = reader.bytes();
          break;
        case 6:
          message.proof_height = Height.decode(reader, reader.uint32());
          break;
        case 7:
          message.signer = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeOpen {
    const obj = createBaseMsgChannelUpgradeOpen();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.counterparty_channel_state))
      obj.counterparty_channel_state = stateFromJSON(object.counterparty_channel_state);
    if (isSet(object.counterparty_upgrade_sequence))
      obj.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    if (isSet(object.proof_channel)) obj.proof_channel = bytesFromBase64(object.proof_channel);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeOpen): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.counterparty_channel_state !== undefined &&
      (obj.counterparty_channel_state = stateToJSON(message.counterparty_channel_state));
    message.counterparty_upgrade_sequence !== undefined &&
      (obj.counterparty_upgrade_sequence = (message.counterparty_upgrade_sequence || BigInt(0)).toString());
    message.proof_channel !== undefined &&
      (obj.proof_channel = base64FromBytes(
        message.proof_channel !== undefined ? message.proof_channel : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeOpen>, I>>(object: I): MsgChannelUpgradeOpen {
    const message = createBaseMsgChannelUpgradeOpen();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.counterparty_channel_state = object.counterparty_channel_state ?? 0;
    if (object.counterparty_upgrade_sequence !== undefined && object.counterparty_upgrade_sequence !== null) {
      message.counterparty_upgrade_sequence = BigInt(object.counterparty_upgrade_sequence.toString());
    }
    message.proof_channel = object.proof_channel ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelUpgradeOpenResponse(): MsgChannelUpgradeOpenResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeOpenResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeOpenResponse
 */
export const MsgChannelUpgradeOpenResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeOpenResponse",
  encode(message: MsgChannelUpgradeOpenResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeOpenResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeOpenResponse();
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
  fromJSON(object: any): MsgChannelUpgradeOpenResponse {
    const obj = createBaseMsgChannelUpgradeOpenResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeOpenResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeOpenResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeOpenResponse {
    const message = createBaseMsgChannelUpgradeOpenResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeTimeout(): MsgChannelUpgradeTimeout {
  return {
    port_id: "",
    channel_id: "",
    counterparty_channel: Channel.fromPartial({}),
    proof_channel: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * @name MsgChannelUpgradeTimeout
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTimeout
 */
export const MsgChannelUpgradeTimeout = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeTimeout",
  encode(message: MsgChannelUpgradeTimeout, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.counterparty_channel !== undefined) {
      Channel.encode(message.counterparty_channel, writer.uint32(26).fork()).ldelim();
    }
    if (message.proof_channel.length !== 0) {
      writer.uint32(34).bytes(message.proof_channel);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(42).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(50).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeTimeout {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeTimeout();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.counterparty_channel = Channel.decode(reader, reader.uint32());
          break;
        case 4:
          message.proof_channel = reader.bytes();
          break;
        case 5:
          message.proof_height = Height.decode(reader, reader.uint32());
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
  fromJSON(object: any): MsgChannelUpgradeTimeout {
    const obj = createBaseMsgChannelUpgradeTimeout();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.counterparty_channel))
      obj.counterparty_channel = Channel.fromJSON(object.counterparty_channel);
    if (isSet(object.proof_channel)) obj.proof_channel = bytesFromBase64(object.proof_channel);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeTimeout): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.counterparty_channel !== undefined &&
      (obj.counterparty_channel = message.counterparty_channel
        ? Channel.toJSON(message.counterparty_channel)
        : undefined);
    message.proof_channel !== undefined &&
      (obj.proof_channel = base64FromBytes(
        message.proof_channel !== undefined ? message.proof_channel : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeTimeout>, I>>(
    object: I,
  ): MsgChannelUpgradeTimeout {
    const message = createBaseMsgChannelUpgradeTimeout();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.counterparty_channel !== undefined && object.counterparty_channel !== null) {
      message.counterparty_channel = Channel.fromPartial(object.counterparty_channel);
    }
    message.proof_channel = object.proof_channel ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelUpgradeTimeoutResponse(): MsgChannelUpgradeTimeoutResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeTimeoutResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeTimeoutResponse
 */
export const MsgChannelUpgradeTimeoutResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeTimeoutResponse",
  encode(
    message: MsgChannelUpgradeTimeoutResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeTimeoutResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeTimeoutResponse();
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
  fromJSON(object: any): MsgChannelUpgradeTimeoutResponse {
    const obj = createBaseMsgChannelUpgradeTimeoutResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeTimeoutResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeTimeoutResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeTimeoutResponse {
    const message = createBaseMsgChannelUpgradeTimeoutResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeCancel(): MsgChannelUpgradeCancel {
  return {
    port_id: "",
    channel_id: "",
    error_receipt: ErrorReceipt.fromPartial({}),
    proof_error_receipt: new Uint8Array(),
    proof_height: Height.fromPartial({}),
    signer: "",
  };
}
/**
 * @name MsgChannelUpgradeCancel
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeCancel
 */
export const MsgChannelUpgradeCancel = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeCancel",
  encode(message: MsgChannelUpgradeCancel, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.error_receipt !== undefined) {
      ErrorReceipt.encode(message.error_receipt, writer.uint32(26).fork()).ldelim();
    }
    if (message.proof_error_receipt.length !== 0) {
      writer.uint32(34).bytes(message.proof_error_receipt);
    }
    if (message.proof_height !== undefined) {
      Height.encode(message.proof_height, writer.uint32(42).fork()).ldelim();
    }
    if (message.signer !== "") {
      writer.uint32(50).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeCancel {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeCancel();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
          break;
        case 3:
          message.error_receipt = ErrorReceipt.decode(reader, reader.uint32());
          break;
        case 4:
          message.proof_error_receipt = reader.bytes();
          break;
        case 5:
          message.proof_height = Height.decode(reader, reader.uint32());
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
  fromJSON(object: any): MsgChannelUpgradeCancel {
    const obj = createBaseMsgChannelUpgradeCancel();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.error_receipt)) obj.error_receipt = ErrorReceipt.fromJSON(object.error_receipt);
    if (isSet(object.proof_error_receipt))
      obj.proof_error_receipt = bytesFromBase64(object.proof_error_receipt);
    if (isSet(object.proof_height)) obj.proof_height = Height.fromJSON(object.proof_height);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeCancel): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.error_receipt !== undefined &&
      (obj.error_receipt = message.error_receipt ? ErrorReceipt.toJSON(message.error_receipt) : undefined);
    message.proof_error_receipt !== undefined &&
      (obj.proof_error_receipt = base64FromBytes(
        message.proof_error_receipt !== undefined ? message.proof_error_receipt : new Uint8Array(),
      ));
    message.proof_height !== undefined &&
      (obj.proof_height = message.proof_height ? Height.toJSON(message.proof_height) : undefined);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeCancel>, I>>(object: I): MsgChannelUpgradeCancel {
    const message = createBaseMsgChannelUpgradeCancel();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    if (object.error_receipt !== undefined && object.error_receipt !== null) {
      message.error_receipt = ErrorReceipt.fromPartial(object.error_receipt);
    }
    message.proof_error_receipt = object.proof_error_receipt ?? new Uint8Array();
    if (object.proof_height !== undefined && object.proof_height !== null) {
      message.proof_height = Height.fromPartial(object.proof_height);
    }
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelUpgradeCancelResponse(): MsgChannelUpgradeCancelResponse {
  return {
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeCancelResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeCancelResponse
 */
export const MsgChannelUpgradeCancelResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeCancelResponse",
  encode(
    message: MsgChannelUpgradeCancelResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeCancelResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeCancelResponse();
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
  fromJSON(object: any): MsgChannelUpgradeCancelResponse {
    const obj = createBaseMsgChannelUpgradeCancelResponse();
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeCancelResponse): unknown {
    const obj: any = {};
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeCancelResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeCancelResponse {
    const message = createBaseMsgChannelUpgradeCancelResponse();
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
function createBaseMsgChannelUpgradeFlush(): MsgChannelUpgradeFlush {
  return {
    port_id: "",
    channel_id: "",
    signer: "",
  };
}
/**
 * MsgChannelUpgradeFlush certifies the drained packet lanes of a flushing
 * Cardano channel.
 * @name MsgChannelUpgradeFlush
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeFlush
 */
export const MsgChannelUpgradeFlush = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeFlush",
  encode(message: MsgChannelUpgradeFlush, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.port_id !== "") {
      writer.uint32(10).string(message.port_id);
    }
    if (message.channel_id !== "") {
      writer.uint32(18).string(message.channel_id);
    }
    if (message.signer !== "") {
      writer.uint32(26).string(message.signer);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeFlush {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeFlush();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port_id = reader.string();
          break;
        case 2:
          message.channel_id = reader.string();
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
  fromJSON(object: any): MsgChannelUpgradeFlush {
    const obj = createBaseMsgChannelUpgradeFlush();
    if (isSet(object.port_id)) obj.port_id = String(object.port_id);
    if (isSet(object.channel_id)) obj.channel_id = String(object.channel_id);
    if (isSet(object.signer)) obj.signer = String(object.signer);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeFlush): unknown {
    const obj: any = {};
    message.port_id !== undefined && (obj.port_id = message.port_id);
    message.channel_id !== undefined && (obj.channel_id = message.channel_id);
    message.signer !== undefined && (obj.signer = message.signer);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeFlush>, I>>(object: I): MsgChannelUpgradeFlush {
    const message = createBaseMsgChannelUpgradeFlush();
    message.port_id = object.port_id ?? "";
    message.channel_id = object.channel_id ?? "";
    message.signer = object.signer ?? "";
    return message;
  },
};
function createBaseMsgChannelUpgradeFlushResponse(): MsgChannelUpgradeFlushResponse {
  return {
    flushed_lanes: BigInt(0),
    lane_count: BigInt(0),
    unsigned_tx: undefined,
  };
}
/**
 * @name MsgChannelUpgradeFlushResponse
 * @package ibc.core.channel.v1
 * @see proto type: ibc.core.channel.v1.MsgChannelUpgradeFlushResponse
 */
export const MsgChannelUpgradeFlushResponse = {
  typeUrl: "/ibc.core.channel.v1.MsgChannelUpgradeFlushResponse",
  encode(
    message: MsgChannelUpgradeFlushResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.flushed_lanes !== BigInt(0)) {
      writer.uint32(8).uint64(message.flushed_lanes);
    }
    if (message.lane_count !== BigInt(0)) {
      writer.uint32(16).uint64(message.lane_count);
    }
    if (message.unsigned_tx !== undefined) {
      Any.encode(message.unsigned_tx, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChannelUpgradeFlushResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgChannelUpgradeFlushResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.flushed_lanes = reader.uint64();
          break;
        case 2:
          message.lane_count = reader.uint64();
          break;
        case 3:
          message.unsigned_tx = Any.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): MsgChannelUpgradeFlushResponse {
    const obj = createBaseMsgChannelUpgradeFlushResponse();
    if (isSet(object.flushed_lanes)) obj.flushed_lanes = BigInt(object.flushed_lanes.toString());
    if (isSet(object.lane_count)) obj.lane_count = BigInt(object.lane_count.toString());
    if (isSet(object.unsigned_tx)) obj.unsigned_tx = Any.fromJSON(object.unsigned_tx);
    return obj;
  },
  toJSON(message: MsgChannelUpgradeFlushResponse): unknown {
    const obj: any = {};
    message.flushed_lanes !== undefined &&
      (obj.flushed_lanes = (message.flushed_lanes || BigInt(0)).toString());
    message.lane_count !== undefined && (obj.lane_count = (message.lane_count || BigInt(0)).toString());
    message.unsigned_tx !== undefined &&
      (obj.unsigned_tx = message.unsigned_tx ? Any.toJSON(message.unsigned_tx) : undefined);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<MsgChannelUpgradeFlushResponse>, I>>(
    object: I,
  ): MsgChannelUpgradeFlushResponse {
    const message = createBaseMsgChannelUpgradeFlushResponse();
    if (object.flushed_lanes !== undefined && object.flushed_lanes !== null) {
      message.flushed_lanes = BigInt(object.flushed_lanes.toString());
    }
    if (object.lane_count !== undefined && object.lane_count !== null) {
      message.lane_count = BigInt(object.lane_count.toString());
    }
    if (object.unsigned_tx !== undefined && object.unsigned_tx !== null) {
      message.unsigned_tx = Any.fromPartial(object.unsigned_tx);
    }
    return message;
  },
};
/** Msg defines the ibc/channel Msg service. */
export interface Msg {
  /** ChannelOpenInit defines a rpc handler method for MsgChannelOpenInit. */
  ChannelOpenInit(request: MsgChannelOpenInit): Promise<MsgChannelOpenInitResponse>;
  /** ChannelOpenTry defines a rpc handler method for MsgChannelOpenTry. */
  ChannelOpenTry(request: MsgChannelOpenTry): Promise<MsgChannelOpenTryResponse>;
  /** ChannelOpenAck defines a rpc handler method for MsgChannelOpenAck. */
  ChannelOpenAck(request: MsgChannelOpenAck): Promise<MsgChannelOpenAckResponse>;
  /** ChannelOpenConfirm defines a rpc handler method for MsgChannelOpenConfirm. */
  ChannelOpenConfirm(request: MsgChannelOpenConfirm): Promise<MsgChannelOpenConfirmResponse>;
  /** ChannelCloseInit defines a rpc handler method for MsgChannelCloseInit. */
  ChannelCloseInit(request: MsgChannelCloseInit): Promise<MsgChannelCloseInitResponse>;
  /**
   * ChannelCloseConfirm defines a rpc handler method for
   * MsgChannelCloseConfirm.
   */
  ChannelCloseConfirm(request: MsgChannelCloseConfirm): Promise<MsgChannelCloseConfirmResponse>;
  /** RecvPacket defines a rpc handler method for MsgRecvPacket. */
  RecvPacket(request: MsgRecvPacket): Promise<MsgRecvPacketResponse>;
  /** Timeout defines a rpc handler method for MsgTimeout. */
  Timeout(request: MsgTimeout): Promise<MsgTimeoutResponse>;
  /** TimeoutOnClose defines a rpc handler method for MsgTimeoutOnClose. */
  TimeoutOnClose(request: MsgTimeoutOnClose): Promise<MsgTimeoutOnCloseResponse>;
  /** Acknowledgement defines a rpc handler method for MsgAcknowledgement. */
  Acknowledgement(request: MsgAcknowledgement): Promise<MsgAcknowledgementResponse>;
  /** Transfer defines a rpc handler method for MsgTransfer. */
  Transfer(request: MsgTransfer): Promise<MsgTransferResponse>;
  /** ChannelUpgradeInit defines a rpc handler method for MsgChannelUpgradeInit. */
  ChannelUpgradeInit(request: MsgChannelUpgradeInit): Promise<MsgChannelUpgradeInitResponse>;
  /** ChannelUpgradeTry defines a rpc handler method for MsgChannelUpgradeTry. */
  ChannelUpgradeTry(request: MsgChannelUpgradeTry): Promise<MsgChannelUpgradeTryResponse>;
  /** ChannelUpgradeAck defines a rpc handler method for MsgChannelUpgradeAck. */
  ChannelUpgradeAck(request: MsgChannelUpgradeAck): Promise<MsgChannelUpgradeAckResponse>;
  /** ChannelUpgradeConfirm defines a rpc handler method for MsgChannelUpgradeConfirm. */
  ChannelUpgradeConfirm(request: MsgChannelUpgradeConfirm): Promise<MsgChannelUpgradeConfirmResponse>;
  /** ChannelUpgradeOpen defines a rpc handler method for MsgChannelUpgradeOpen. */
  ChannelUpgradeOpen(request: MsgChannelUpgradeOpen): Promise<MsgChannelUpgradeOpenResponse>;
  /** ChannelUpgradeTimeout defines a rpc handler method for MsgChannelUpgradeTimeout. */
  ChannelUpgradeTimeout(request: MsgChannelUpgradeTimeout): Promise<MsgChannelUpgradeTimeoutResponse>;
  /** ChannelUpgradeCancel defines a rpc handler method for MsgChannelUpgradeCancel. */
  ChannelUpgradeCancel(request: MsgChannelUpgradeCancel): Promise<MsgChannelUpgradeCancelResponse>;
  /**
   * ChannelUpgradeFlush records drained Cardano packet lanes of a flushing
   * channel. It has no ibc-go counterpart.
   */
  ChannelUpgradeFlush(request: MsgChannelUpgradeFlush): Promise<MsgChannelUpgradeFlushResponse>;
}
export class MsgClientImpl implements Msg {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.ChannelOpenInit = this.ChannelOpenInit.bind(this);
    this.ChannelOpenTry = this.ChannelOpenTry.bind(this);
    this.ChannelOpenAck = this.ChannelOpenAck.bind(this);
    this.ChannelOpenConfirm = this.ChannelOpenConfirm.bind(this);
    this.ChannelCloseInit = this.ChannelCloseInit.bind(this);
    this.ChannelCloseConfirm = this.ChannelCloseConfirm.bind(this);
    this.RecvPacket = this.RecvPacket.bind(this);
    this.Timeout = this.Timeout.bind(this);
    this.TimeoutOnClose = this.TimeoutOnClose.bind(this);
    this.Acknowledgement = this.Acknowledgement.bind(this);
    this.Transfer = this.Transfer.bind(this);
    this.ChannelUpgradeInit = this.ChannelUpgradeInit.bind(this);
    this.ChannelUpgradeTry = this.ChannelUpgradeTry.bind(this);
    this.ChannelUpgradeAck = this.ChannelUpgradeAck.bind(this);
    this.ChannelUpgradeConfirm = this.ChannelUpgradeConfirm.bind(this);
    this.ChannelUpgradeOpen = this.ChannelUpgradeOpen.bind(this);
    this.ChannelUpgradeTimeout = this.ChannelUpgradeTimeout.bind(this);
    this.ChannelUpgradeCancel = this.ChannelUpgradeCancel.bind(this);
    this.ChannelUpgradeFlush = this.ChannelUpgradeFlush.bind(this);
  }
  ChannelOpenInit(request: MsgChannelOpenInit): Promise<MsgChannelOpenInitResponse> {
    const data = MsgChannelOpenInit.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelOpenInit", data);
    return promise.then((data) => MsgChannelOpenInitResponse.decode(new BinaryReader(data)));
  }
  ChannelOpenTry(request: MsgChannelOpenTry): Promise<MsgChannelOpenTryResponse> {
    const data = MsgChannelOpenTry.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelOpenTry", data);
    return promise.then((data) => MsgChannelOpenTryResponse.decode(new BinaryReader(data)));
  }
  ChannelOpenAck(request: MsgChannelOpenAck): Promise<MsgChannelOpenAckResponse> {
    const data = MsgChannelOpenAck.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelOpenAck", data);
    return promise.then((data) => MsgChannelOpenAckResponse.decode(new BinaryReader(data)));
  }
  ChannelOpenConfirm(request: MsgChannelOpenConfirm): Promise<MsgChannelOpenConfirmResponse> {
    const data = MsgChannelOpenConfirm.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelOpenConfirm", data);
    return promise.then((data) => MsgChannelOpenConfirmResponse.decode(new BinaryReader(data)));
  }
  ChannelCloseInit(request: MsgChannelCloseInit): Promise<MsgChannelCloseInitResponse> {
    const data = MsgChannelCloseInit.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelCloseInit", data);
    return promise.then((data) => MsgChannelCloseInitResponse.decode(new BinaryReader(data)));
  }
  ChannelCloseConfirm(request: MsgChannelCloseConfirm): Promise<MsgChannelCloseConfirmResponse> {
    const data = MsgChannelCloseConfirm.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelCloseConfirm", data);
    return promise.then((data) => MsgChannelCloseConfirmResponse.decode(new BinaryReader(data)));
  }
  RecvPacket(request: MsgRecvPacket): Promise<MsgRecvPacketResponse> {
    const data = MsgRecvPacket.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "RecvPacket", data);
    return promise.then((data) => MsgRecvPacketResponse.decode(new BinaryReader(data)));
  }
  Timeout(request: MsgTimeout): Promise<MsgTimeoutResponse> {
    const data = MsgTimeout.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "Timeout", data);
    return promise.then((data) => MsgTimeoutResponse.decode(new BinaryReader(data)));
  }
  TimeoutOnClose(request: MsgTimeoutOnClose): Promise<MsgTimeoutOnCloseResponse> {
    const data = MsgTimeoutOnClose.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "TimeoutOnClose", data);
    return promise.then((data) => MsgTimeoutOnCloseResponse.decode(new BinaryReader(data)));
  }
  Acknowledgement(request: MsgAcknowledgement): Promise<MsgAcknowledgementResponse> {
    const data = MsgAcknowledgement.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "Acknowledgement", data);
    return promise.then((data) => MsgAcknowledgementResponse.decode(new BinaryReader(data)));
  }
  Transfer(request: MsgTransfer): Promise<MsgTransferResponse> {
    const data = MsgTransfer.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "Transfer", data);
    return promise.then((data) => MsgTransferResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeInit(request: MsgChannelUpgradeInit): Promise<MsgChannelUpgradeInitResponse> {
    const data = MsgChannelUpgradeInit.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeInit", data);
    return promise.then((data) => MsgChannelUpgradeInitResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeTry(request: MsgChannelUpgradeTry): Promise<MsgChannelUpgradeTryResponse> {
    const data = MsgChannelUpgradeTry.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeTry", data);
    return promise.then((data) => MsgChannelUpgradeTryResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeAck(request: MsgChannelUpgradeAck): Promise<MsgChannelUpgradeAckResponse> {
    const data = MsgChannelUpgradeAck.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeAck", data);
    return promise.then((data) => MsgChannelUpgradeAckResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeConfirm(request: MsgChannelUpgradeConfirm): Promise<MsgChannelUpgradeConfirmResponse> {
    const data = MsgChannelUpgradeConfirm.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeConfirm", data);
    return promise.then((data) => MsgChannelUpgradeConfirmResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeOpen(request: MsgChannelUpgradeOpen): Promise<MsgChannelUpgradeOpenResponse> {
    const data = MsgChannelUpgradeOpen.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeOpen", data);
    return promise.then((data) => MsgChannelUpgradeOpenResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeTimeout(request: MsgChannelUpgradeTimeout): Promise<MsgChannelUpgradeTimeoutResponse> {
    const data = MsgChannelUpgradeTimeout.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeTimeout", data);
    return promise.then((data) => MsgChannelUpgradeTimeoutResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeCancel(request: MsgChannelUpgradeCancel): Promise<MsgChannelUpgradeCancelResponse> {
    const data = MsgChannelUpgradeCancel.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeCancel", data);
    return promise.then((data) => MsgChannelUpgradeCancelResponse.decode(new BinaryReader(data)));
  }
  ChannelUpgradeFlush(request: MsgChannelUpgradeFlush): Promise<MsgChannelUpgradeFlushResponse> {
    const data = MsgChannelUpgradeFlush.encode(request).finish();
    const promise = this.rpc.request("ibc.core.channel.v1.Msg", "ChannelUpgradeFlush", data);
    return promise.then((data) => MsgChannelUpgradeFlushResponse.decode(new BinaryReader(data)));
  }
}
export const createClientImpl = (rpc: Rpc) => {
  return new MsgClientImpl(rpc);
};
