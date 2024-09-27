import {ChannelStateSchema} from '../state/ChannelState';
import {OrderSchema} from '../order/Order';
import {ChannelCounterpartySchema} from '../counterparty/ChannelCounterparty';
import {Data} from '../../../../plutus/data';

export const ChannelSchema = Data.Object({
  state: ChannelStateSchema,
  ordering: OrderSchema,
  counterparty: ChannelCounterpartySchema,
  connection_hops: Data.Array(Data.Bytes()),
  version: Data.Bytes(),
});
export type Channel = Data.Static<typeof ChannelSchema>;
export const Channel = ChannelSchema as unknown as Channel;
