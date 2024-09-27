import {HandlerStateSchema} from '../handler/HandlerState';
import {AuthTokenSchema} from '../../../auth/AuthToken';
import {Data} from '../../../plutus/data';

export const HandlerDatumSchema = Data.Object({
  state: HandlerStateSchema,
  token: AuthTokenSchema,
});
export type HandlerDatum = Data.Static<typeof HandlerDatumSchema>;
export const HandlerDatum = HandlerDatumSchema as unknown as HandlerDatum;
