import { Data } from "@lucid-evolution/lucid";

export const TraceRegistryEntrySchema = Data.Object({
  voucher_hash: Data.Bytes(),
  full_denom: Data.Bytes(),
});

export type TraceRegistryEntry = Data.Static<typeof TraceRegistryEntrySchema>;
export const TraceRegistryEntry =
  TraceRegistryEntrySchema as unknown as TraceRegistryEntry;

export const TraceRegistryShardDatumSchema = Data.Object({
  bucket_index: Data.Integer(),
  entries: Data.Array(TraceRegistryEntrySchema),
});

export type TraceRegistryShardDatum = Data.Static<
  typeof TraceRegistryShardDatumSchema
>;
export const TraceRegistryShardDatum =
  TraceRegistryShardDatumSchema as unknown as TraceRegistryShardDatum;

export const TraceRegistryDirectoryBucketSchema = Data.Object({
  bucket_index: Data.Integer(),
  active_shard_name: Data.Bytes(),
  archived_shard_names: Data.Array(Data.Bytes()),
});

export type TraceRegistryDirectoryBucket = Data.Static<
  typeof TraceRegistryDirectoryBucketSchema
>;
export const TraceRegistryDirectoryBucket =
  TraceRegistryDirectoryBucketSchema as unknown as TraceRegistryDirectoryBucket;

export const TraceRegistryDirectoryDatumSchema = Data.Object({
  buckets: Data.Array(TraceRegistryDirectoryBucketSchema),
});

export type TraceRegistryDirectoryDatum = Data.Static<
  typeof TraceRegistryDirectoryDatumSchema
>;
export const TraceRegistryDirectoryDatum =
  TraceRegistryDirectoryDatumSchema as unknown as TraceRegistryDirectoryDatum;

export const TraceRegistryDatumSchema = Data.Enum([
  Data.Object({
    Shard: TraceRegistryShardDatumSchema,
  }),
  Data.Object({
    Directory: TraceRegistryDirectoryDatumSchema,
  }),
]);

export type TraceRegistryDatum = Data.Static<typeof TraceRegistryDatumSchema>;
export const TraceRegistryDatum =
  TraceRegistryDatumSchema as unknown as TraceRegistryDatum;

export const TraceRegistryRedeemerSchema = Data.Enum([
  Data.Object({
    InsertTrace: Data.Object({
      voucher_hash: Data.Bytes(),
      full_denom: Data.Bytes(),
    }),
  }),
  Data.Object({
    RolloverInsertTrace: Data.Object({
      voucher_hash: Data.Bytes(),
      full_denom: Data.Bytes(),
      new_active_shard_name: Data.Bytes(),
    }),
  }),
  Data.Object({
    AdvanceDirectory: Data.Object({
      bucket_index: Data.Integer(),
      voucher_hash: Data.Bytes(),
      full_denom: Data.Bytes(),
      previous_active_shard_name: Data.Bytes(),
      new_active_shard_name: Data.Bytes(),
    }),
  }),
]);

export type TraceRegistryRedeemer = Data.Static<
  typeof TraceRegistryRedeemerSchema
>;
export const TraceRegistryRedeemer =
  TraceRegistryRedeemerSchema as unknown as TraceRegistryRedeemer;
