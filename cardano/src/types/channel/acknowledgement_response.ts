import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const AcknowledgementResponseSchema = Data.Enum([
  Data.Object({
    AcknowledgementResult: Data.Object({
      result: Data.Bytes(),
    }),
  }),
  Data.Object({
    AcknowledgementError: Data.Object({
      err: Data.Bytes(),
    }),
  }),
]);
export type AcknowledgementResponse = Data.Static<
  typeof AcknowledgementResponseSchema
>;
export const AcknowledgementResponse =
  AcknowledgementResponseSchema as unknown as AcknowledgementResponse;
