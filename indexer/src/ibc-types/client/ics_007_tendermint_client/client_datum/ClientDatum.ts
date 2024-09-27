import {AuthTokenSchema} from '../../../auth/AuthToken';
import {Data} from '../../../plutus/data';
import {ClientDatumStateSchema} from './ClientDatumState';

export const ClientDatumSchema = Data.Object({
  state: ClientDatumStateSchema,
  token: AuthTokenSchema,
});
export type ClientDatum = Data.Static<typeof ClientDatumSchema>;
export const ClientDatum = ClientDatumSchema as unknown as ClientDatum;
