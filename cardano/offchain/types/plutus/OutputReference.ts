import { Data } from "@lucid-evolution/lucid";
export const OutputReferenceSchema = Data.Object({
  transaction_id: Data.Bytes(),
  output_index: Data.Integer(),
});
export type OutputReference = Data.Static<typeof OutputReferenceSchema>;
export const OutputReference =
  OutputReferenceSchema as unknown as OutputReference;
