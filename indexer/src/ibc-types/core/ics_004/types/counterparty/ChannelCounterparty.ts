import {Data} from '../../../../plutus/data';

export const ChannelCounterpartySchema = Data.Object({
  port_id: Data.Bytes(),
  channel_id: Data.Bytes(),
});
export type ChannelCounterparty = Data.Static<typeof ChannelCounterpartySchema>;
export const ChannelCounterparty = ChannelCounterpartySchema as unknown as ChannelCounterparty;
