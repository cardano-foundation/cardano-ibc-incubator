import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AcknowledgementResponseSchema } from "./acknowledgement_response.ts";

export const AcknowledgementSchema = Data.Object({
  response: AcknowledgementResponseSchema,
});
export type Acknowledgement = Data.Static<typeof AcknowledgementSchema>;
export const Acknowledgement =
  AcknowledgementSchema as unknown as Acknowledgement;
