import {
  State as ChannelState,
  Order as ChannelOrder,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import { Order } from '../shared/types/channel/order';
import { ChannelState as State } from '../shared/types/channel/state';

export const EVENT_TYPE_CHANNEL = {
  OPEN_INIT: 'channel_open_init',
  OPEN_TRY: 'channel_open_try',
  OPEN_ACK: 'channel_open_ack',
  OPEN_CONFIRM: 'channel_open_confirm',
  CLOSE_INIT: 'channel_close_init',
  CLOSE_CONFIRM: 'channel_close_confirm',
  CLOSE: 'channel_close',
  UPGRADE_INIT: 'channel_upgrade_init',
  UPGRADE_TRY: 'channel_upgrade_try',
  UPGRADE_ACK: 'channel_upgrade_ack',
  UPGRADE_CONFIRM: 'channel_upgrade_confirm',
  UPGRADE_OPEN: 'channel_upgrade_open',
  UPGRADE_TIMEOUT: 'channel_upgrade_timeout',
  UPGRADE_CANCEL: 'channel_upgrade_cancelled',
  UPGRADE_ERROR: 'channel_upgrade_error',
  FLUSH_COMPLETE: 'channel_flush_complete',
};

// ibc-go v8 channel-upgrade event attributes.
export const ATTRIBUTE_KEY_CHANNEL_UPGRADE = {
  UPGRADE_SEQUENCE: 'upgrade_sequence',
  UPGRADE_CONNECTION_HOPS: 'upgrade_connection_hops',
  UPGRADE_VERSION: 'upgrade_version',
  UPGRADE_ORDERING: 'upgrade_ordering',
  UPGRADE_TIMEOUT_HEIGHT: 'timeout_height',
  UPGRADE_TIMEOUT_TIMESTAMP: 'timeout_timestamp',
  CHANNEL_STATE: 'channel_state',
  ERROR_RECEIPT: 'error_receipt',
};

export const ATTRIBUTE_KEY_CHANNEL = {
  CONNECTION_ID: 'connection_id',
  PORT_ID: 'port_id',
  CHANNEL_ID: 'channel_id',
  VERSION: 'version',
  COUNTERPARTY_PORT_ID: 'counterparty_port_id',
  COUNTERPARTY_CHANNEL_ID: 'counterparty_channel_id',
};

export const STATE_MAPPING_CHANNEL = {
  [State.Init]: ChannelState.STATE_INIT,
  [State.TryOpen]: ChannelState.STATE_TRYOPEN,
  [State.Open]: ChannelState.STATE_OPEN,
  [State.Close]: ChannelState.STATE_CLOSED,
  [State.Uninitialized]: ChannelState.STATE_UNINITIALIZED_UNSPECIFIED,
  [State.Flushing]: ChannelState.STATE_FLUSHING,
  [State.FlushComplete]: ChannelState.STATE_FLUSHCOMPLETE,
};

export const ORDER_MAPPING_CHANNEL = {
  [Order.None]: ChannelOrder.ORDER_NONE_UNSPECIFIED,
  [Order.Ordered]: ChannelOrder.ORDER_ORDERED,
  [Order.Unordered]: ChannelOrder.ORDER_UNORDERED,
};

export const CHANNEL_ID_PREFIX = 'channel';

export const KEY_CHANNEL_PREFIX = 'channels';

export const KEY_CHANNEL_END_PREFIX = 'channelEnds';

export const KEY_PORT_PREFIX = 'ports';
