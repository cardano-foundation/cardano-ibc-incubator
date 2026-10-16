import type { ErrorReceiptValue, UpgradeFieldsValue, UpgradeValue } from '@cardano-ibc/tx-builder-runtime/channelDatum';
import {
  Channel as ProtoChannel,
  Order as ProtoOrder,
  State as ProtoState,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import {
  ErrorReceipt as ProtoErrorReceipt,
  Upgrade as ProtoUpgrade,
  UpgradeFields as ProtoUpgradeFields,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/upgrade';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { ORDER_MAPPING_CHANNEL, STATE_MAPPING_CHANNEL } from '~@/constant/channel';
import { convertHex2String, convertString2Hex } from '@shared/helpers/hex';
import { Channel } from '@shared/types/channel/channel';
import { Order } from '@shared/types/channel/order';
import { ChannelState } from '@shared/types/channel/state';

// Conversions between ibc-go channel-upgrade messages and the Cardano values,
// whose byte fields are hex. Encoding goes through the Cardano value so the
// committed protobuf matches ibc-go's Marshal, which always writes the
// non-nullable timeout height.

export function orderFromProto(order: ProtoOrder): Order {
  if (order === ProtoOrder.ORDER_UNORDERED) return Order.Unordered;
  if (order === ProtoOrder.ORDER_ORDERED) return Order.Ordered;
  throw new GrpcInvalidArgumentException('Invalid argument: ordering must be ordered or unordered');
}

export function channelStateFromProto(state: ProtoState): ChannelState {
  const entry = Object.entries(STATE_MAPPING_CHANNEL).find(([, value]) => value === state);
  if (!entry) throw new GrpcInvalidArgumentException(`Invalid argument: unknown channel state ${state}`);
  return entry[0] as ChannelState;
}

export function upgradeFieldsFromProto(fields: ProtoUpgradeFields | undefined): UpgradeFieldsValue {
  if (!fields) throw new GrpcInvalidArgumentException('Invalid argument: upgrade fields are required');
  return {
    ordering: orderFromProto(fields.ordering),
    connection_hops: (fields.connection_hops ?? []).map(convertString2Hex),
    version: convertString2Hex(fields.version ?? ''),
  };
}

export function upgradeFieldsToProto(fields: UpgradeFieldsValue): ProtoUpgradeFields {
  return {
    ordering: ORDER_MAPPING_CHANNEL[fields.ordering as Order],
    connection_hops: fields.connection_hops.map(convertHex2String),
    version: convertHex2String(fields.version),
  };
}

export function upgradeFromProto(upgrade: ProtoUpgrade | undefined): UpgradeValue {
  if (!upgrade) throw new GrpcInvalidArgumentException('Invalid argument: upgrade is required');
  return {
    fields: upgradeFieldsFromProto(upgrade.fields),
    timeout: {
      height: {
        revisionNumber: BigInt(upgrade.timeout?.height?.revision_number ?? 0n),
        revisionHeight: BigInt(upgrade.timeout?.height?.revision_height ?? 0n),
      },
      timestamp: BigInt(upgrade.timeout?.timestamp ?? 0n),
    },
    next_sequence_send: BigInt(upgrade.next_sequence_send ?? 0n),
  };
}

export function upgradeToProto(upgrade: UpgradeValue): ProtoUpgrade {
  return {
    fields: upgradeFieldsToProto(upgrade.fields),
    timeout: {
      height: {
        revision_number: upgrade.timeout.height.revisionNumber,
        revision_height: upgrade.timeout.height.revisionHeight,
      },
      timestamp: upgrade.timeout.timestamp,
    },
    next_sequence_send: upgrade.next_sequence_send,
  };
}

/** The bytes ibc-go commits for an upgrade. */
export function encodeUpgradeProto(upgrade: UpgradeValue): Uint8Array {
  return ProtoUpgrade.encode(upgradeToProto(upgrade)).finish();
}

export function errorReceiptFromProto(receipt: ProtoErrorReceipt | undefined): ErrorReceiptValue | null {
  if (!receipt || (receipt.sequence === 0n && !receipt.message)) return null;
  return { sequence: BigInt(receipt.sequence), message: convertString2Hex(receipt.message) };
}

export function errorReceiptToProto(receipt: ErrorReceiptValue): ProtoErrorReceipt {
  return { sequence: receipt.sequence, message: convertHex2String(receipt.message) };
}

export function channelFromProto(channel: ProtoChannel | undefined): Channel {
  if (!channel) throw new GrpcInvalidArgumentException('Invalid argument: counterparty channel is required');
  return {
    state: channelStateFromProto(channel.state),
    ordering: orderFromProto(channel.ordering),
    counterparty: {
      port_id: convertString2Hex(channel.counterparty?.port_id ?? ''),
      channel_id: convertString2Hex(channel.counterparty?.channel_id ?? ''),
    },
    connection_hops: (channel.connection_hops ?? []).map(convertString2Hex),
    version: convertString2Hex(channel.version ?? ''),
    upgrade_sequence: BigInt(channel.upgrade_sequence ?? 0n),
  };
}

export function channelToProto(channel: Channel): ProtoChannel {
  return {
    state: STATE_MAPPING_CHANNEL[channel.state],
    ordering: ORDER_MAPPING_CHANNEL[channel.ordering],
    counterparty: {
      port_id: convertHex2String(channel.counterparty.port_id),
      channel_id: convertHex2String(channel.counterparty.channel_id),
    },
    connection_hops: channel.connection_hops.map(convertHex2String),
    version: convertHex2String(channel.version),
    upgrade_sequence: channel.upgrade_sequence,
  };
}

/** The bytes ibc-go commits for a channel end. */
export function encodeChannelProto(channel: Channel): Uint8Array {
  return ProtoChannel.encode(channelToProto(channel)).finish();
}
