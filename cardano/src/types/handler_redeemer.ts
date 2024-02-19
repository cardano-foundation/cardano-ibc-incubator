import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const HandlerOperatorSchema = Data.Enum([
  Data.Literal("CreateClient"),
  Data.Literal("Other"),
]);
export type HandlerOperator = Data.Static<typeof HandlerOperatorSchema>;
export const HandlerOperator =
  HandlerOperatorSchema as unknown as HandlerOperator;
