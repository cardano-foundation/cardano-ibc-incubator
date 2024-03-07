import { ChannelCounterparty } from './counterparty';
import { Order } from './order';
import { ChannelState } from './state';

export type Channel = {
  state: ChannelState;
  ordering: Order;
  counterparty: ChannelCounterparty;
  connection_hops: string[];
  version: string;
};
