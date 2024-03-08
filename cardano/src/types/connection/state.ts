import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const StateSchema = Data.Enum([
  Data.Literal("Uninitialized"),
  Data.Literal("Init"),
  Data.Literal("TryOpen"),
  Data.Literal("Open"),
]);
export type State = Data.Static<typeof StateSchema>;
export const State = StateSchema as unknown as State;
