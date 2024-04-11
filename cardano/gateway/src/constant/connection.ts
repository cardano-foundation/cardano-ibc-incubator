import { State as StateConnectionEnd } from '@plus/proto-types/build/ibc/core/connection/v1/connection';
import { State } from '../shared/types/connection/state';

export const EVENT_TYPE_CONNECTION = {
  OPEN_INIT: 'connection_open_init',
  OPEN_TRY: 'connection_open_try',
  OPEN_ACK: 'connection_open_ack',
  OPEN_CONFIRM: 'connection_open_confirm',
};

export const ATTRIBUTE_KEY_CONNECTION = {
  CONNECTION_ID: 'connection_id',
  CLIENT_ID: 'client_id',
  COUNTERPARTY_CLIENT_ID: 'counterparty_client_id',
  COUNTERPARTY_CONNECTION_ID: 'counterparty_connection_id',
};

export const STATE_MAPPING_CONNECTION = {
  [State.Init]: StateConnectionEnd.STATE_INIT,
  [State.Open]: StateConnectionEnd.STATE_OPEN,
  [State.TryOpen]: StateConnectionEnd.STATE_TRYOPEN,
  [State.Uninitialized]: StateConnectionEnd.STATE_UNINITIALIZED_UNSPECIFIED,
};

export const CONNECTION_ID_PREFIX = 'connection';
