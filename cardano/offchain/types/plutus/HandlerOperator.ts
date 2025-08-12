import { Data } from "@lucid-evolution/lucid";

export const HandlerOperatorSchema = Data.Enum([
  Data.Literal("CreateClient"),
  Data.Literal("HandlerConnOpenInit"),
  Data.Literal("HandlerConnOpenTry"),
  Data.Literal("HandlerChanOpenInit"),
  Data.Literal("HandlerChanOpenTry"),
  Data.Literal("HandlerBindPort"),
]);
export type HandlerOperator = Data.Static<typeof HandlerOperatorSchema>;
export const HandlerOperator =
  HandlerOperatorSchema as unknown as HandlerOperator;
