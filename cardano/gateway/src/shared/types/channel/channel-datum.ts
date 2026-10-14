import { AuthToken } from '../auth-token';
import type { ChannelUpgradeStateValue } from '@cardano-ibc/tx-builder-runtime/channelDatum';
import { Channel } from './channel';
import { Height } from '../height';

export type ChannelUpgradeState = ChannelUpgradeStateValue;

export type ChannelDatumState = {
  channel: Channel;
  next_sequence_send: bigint;
  next_sequence_recv: bigint;
  next_sequence_ack: bigint;
  packet_commitment: Map<bigint, string>;
  packet_receipt: Map<bigint, string>;
  packet_acknowledgement: Map<bigint, string>;
  minimum_receive_proof_height: Height;
  maximum_receive_proof_height: Height;
  upgrade: ChannelUpgradeState;
};

export type ChannelDatum = {
  state: ChannelDatumState;
  port: string;
  token: AuthToken;
};

/**
 * Encode a `Channel` value exactly as the on-chain Aiken code does.
 *
 * This encoding is used for the `ibc_state_root` commitment tree value bytes at:
 * `channelEnds/ports/{portId}/channels/{channelId}`.
 */
export {
  encodeChannelEndValue,
  encodeChannelUpgradeRecords,
} from '@cardano-ibc/tx-builder-runtime/ibcStateRoot';
export {
  encodeChannelDatum,
  decodeChannelDatum,
  initialChannelUpgradeState,
} from '@cardano-ibc/tx-builder-runtime/channelDatum';
