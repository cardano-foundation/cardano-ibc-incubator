import { AuthToken } from './auth-token';
import { type Data } from 'lucid-cardano';

export type HandlerDatum = {
  state: {
    next_client_sequence: bigint;
    next_connection_sequence: bigint;
    next_channel_sequence: bigint;
    bound_port: Map<bigint, boolean>;
  };
  token: AuthToken;
};
export async function encodeHandlerDatum(handlerDatum: HandlerDatum, Lucid: typeof import('lucid-cardano')) {
  const { Data } = Lucid;

  const HandlerStateSchema = Data.Object({
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Map(Data.Integer(), Data.Boolean()),
  });
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HandlerDatumSchema = Data.Object({
    state: HandlerStateSchema,
    token: AuthTokenSchema,
  });
  type THandlerDatum = Data.Static<typeof HandlerDatumSchema>;
  const THandlerDatum = HandlerDatumSchema as unknown as HandlerDatum;

  return Data.to(handlerDatum, THandlerDatum);
}
export async function decodeHandlerDatum(handlerDatum: string, Lucid: typeof import('lucid-cardano')) {
  const { Data } = Lucid;
  const HandlerStateSchema = Data.Object({
    next_client_sequence: Data.Integer(),
    next_connection_sequence: Data.Integer(),
    next_channel_sequence: Data.Integer(),
    bound_port: Data.Map(Data.Integer(), Data.Boolean()),
  });
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HandlerDatumSchema = Data.Object({
    state: HandlerStateSchema,
    token: AuthTokenSchema,
  });
  type THandlerDatum = Data.Static<typeof HandlerDatumSchema>;
  const THandlerDatum = HandlerDatumSchema as unknown as HandlerDatum;
  Data.from(handlerDatum, THandlerDatum);
  return Data.from(handlerDatum, THandlerDatum);
}