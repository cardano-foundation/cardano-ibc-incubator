import { Data } from "@lucid-evolution/lucid";

export const TransferModuleDatumSchema = Data.Object({
  escrow_shard_registry_root: Data.Bytes(),
  live_escrow_shard_count: Data.Integer(),
  voucher_supply: Data.Integer(),
});

export type TransferModuleDatum = Data.Static<
  typeof TransferModuleDatumSchema
>;
export const TransferModuleDatum =
  TransferModuleDatumSchema as unknown as TransferModuleDatum;
