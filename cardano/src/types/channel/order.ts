import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const OrderSchema = Data.Enum([
  Data.Literal("None"),
  Data.Literal("Unordered"),
  Data.Literal("Ordered"),
]);
export type Order = Data.Static<typeof OrderSchema>;
export const Order = OrderSchema as unknown as Order;
