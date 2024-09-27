import {Data} from '../../../../plutus/data';

export const ChannelStateSchema = Data.Enum([
  Data.Literal('Uninitialized'),
  Data.Literal('Init'),
  Data.Literal('TryOpen'),
  Data.Literal('Open'),
  Data.Literal('Closed'),
]);
export type ChannelState = Data.Static<typeof ChannelStateSchema>;
export const ChannelState = ChannelStateSchema as unknown as ChannelState;
