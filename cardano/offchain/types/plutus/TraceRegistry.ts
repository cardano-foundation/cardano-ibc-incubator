import { Data } from "@lucid-evolution/lucid";

export const TraceRegistryEntrySchema = Data.Object({
  voucher_hash: Data.Bytes(),
  full_denom: Data.Bytes(),
});

export type TraceRegistryEntry = Data.Static<typeof TraceRegistryEntrySchema>;
export const TraceRegistryEntry =
  TraceRegistryEntrySchema as unknown as TraceRegistryEntry;

export const TraceRegistryShardDatumSchema = Data.Object({
  shard_index: Data.Integer(),
  entries: Data.Array(TraceRegistryEntrySchema),
});

export type TraceRegistryShardDatum = Data.Static<
  typeof TraceRegistryShardDatumSchema
>;
export const TraceRegistryShardDatum =
  TraceRegistryShardDatumSchema as unknown as TraceRegistryShardDatum;

export const TraceRegistryRedeemerSchema = Data.Enum([
  Data.Object({
    InsertTrace: Data.Object({
      voucher_hash: Data.Bytes(),
      full_denom: Data.Bytes(),
    }),
  }),
]);

export type TraceRegistryRedeemer = Data.Static<
  typeof TraceRegistryRedeemerSchema
>;
export const TraceRegistryRedeemer =
  TraceRegistryRedeemerSchema as unknown as TraceRegistryRedeemer;
