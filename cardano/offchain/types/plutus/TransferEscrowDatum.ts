import { Data } from "@lucid-evolution/lucid";

export const TransferEscrowDatumSchema = Data.Object({
  channel_id: Data.Bytes(),
  denom: Data.Bytes(),
  escrowed_amount: Data.Integer(),
});

export type TransferEscrowDatum = Data.Static<
  typeof TransferEscrowDatumSchema
>;
export const TransferEscrowDatum =
  TransferEscrowDatumSchema as unknown as TransferEscrowDatum;
