import {Data} from '../../../plutus/data';
import {ChannelSchema} from '../types/channel/Channel';

export const ChannelDatumStateSchema = Data.Object({
  channel: ChannelSchema,
  next_sequence_send: Data.Integer(),
  next_sequence_recv: Data.Integer(),
  next_sequence_ack: Data.Integer(),
  packet_commitment: Data.Map(Data.Integer(), Data.Bytes()),
  packet_receipt: Data.Map(Data.Integer(), Data.Bytes()),
  packet_acknowledgement: Data.Map(Data.Integer(), Data.Bytes()),
});
export type ChannelDatumState = Data.Static<typeof ChannelDatumStateSchema>;
export const ChannelDatumState = ChannelDatumStateSchema as unknown as ChannelDatumState;
