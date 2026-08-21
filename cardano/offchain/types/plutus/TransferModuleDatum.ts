import { Data } from "@lucid-evolution/lucid";

export const TransferModuleDatumSchema = Data.Object({
  escrow_shard_registry_root: Data.Bytes(),
});

export type TransferModuleDatum = Data.Static<
  typeof TransferModuleDatumSchema
>;
export const TransferModuleDatum =
  TransferModuleDatumSchema as unknown as TransferModuleDatum;
