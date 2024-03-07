import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { TransactionIdSchema } from "./transaction_id.ts";

export const OutputReferenceSchema = Data.Object({
  transaction_id: TransactionIdSchema,
  output_index: Data.Integer(),
});
export type OutputReference = Data.Static<typeof OutputReferenceSchema>;
export const OutputReference =
  OutputReferenceSchema as unknown as OutputReference;
