import {ChannelDatumStateSchema} from './ChannelDatumState';
import {AuthTokenSchema} from '../../../auth/AuthToken';
import {Data} from '../../../plutus/data';

export const ChannelDatumSchema = Data.Object({
  state: ChannelDatumStateSchema,
  port_id: Data.Bytes(),
  token: AuthTokenSchema,
});
export type ChannelDatum = Data.Static<typeof ChannelDatumSchema>;
export const ChannelDatum = ChannelDatumSchema as unknown as ChannelDatum;
