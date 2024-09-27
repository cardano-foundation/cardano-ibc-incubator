import {ConnectionEndSchema} from '../types/connection_end/ConnectionEnd';
import {AuthTokenSchema} from '../../../auth/AuthToken';
import {Data} from '../../../plutus/data';

export const ConnectionDatumSchema = Data.Object({
  state: ConnectionEndSchema,
  token: AuthTokenSchema,
});
export type ConnectionDatum = Data.Static<typeof ConnectionDatumSchema>;
export const ConnectionDatum = ConnectionDatumSchema as unknown as ConnectionDatum;
