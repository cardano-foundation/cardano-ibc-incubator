import { Order } from 'src/shared/types/channel/order';

export type ChannelOpenInitOperator = {
  connectionId: string;
  counterpartyPortId: string;
  ordering: Order;
  version: string;
  port_id: string;
};
