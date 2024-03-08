import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const TransactionIdSchema = Data.Object({
  hash: Data.Bytes(),
});
export type TransactionId = Data.Static<typeof TransactionIdSchema>;
export const TransactionId = TransactionIdSchema as unknown as TransactionId;
