import { State as ChannelState, Order as ChannelOrder } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
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
};

export const ORDER_MAPPING_CHANNEL = {
  [Order.None]: ChannelOrder.ORDER_NONE_UNSPECIFIED,
  [Order.Ordered]: ChannelOrder.ORDER_ORDERED,
  [Order.Unordered]: ChannelOrder.ORDER_UNORDERED,
};

export const CHANNEL_ID_PREFIX = 'channel';

export const KEY_CHANNEL_PREFIX = 'channels';

export const KEY_CHANNEL_END_PREFIX = 'channelEnds';

export const PORT_ID_PREFIX = 'port';

export const KEY_PORT_PREFIX = 'ports';

export const TRANSFER_MODULE_PORT = 100;
