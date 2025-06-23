import { Data } from "@lucid-evolution/lucid";

export const HandlerStateSchema = Data.Object({
  next_client_sequence: Data.Integer(),
  next_connection_sequence: Data.Integer(),
  next_channel_sequence: Data.Integer(),
  bound_port: Data.Array(Data.Integer()),
});
export type HandlerState = Data.Static<typeof HandlerStateSchema>;
export const HandlerState = HandlerStateSchema as unknown as HandlerState;
