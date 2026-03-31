import { convertHex2String, convertString2Hex } from '../helpers/hex';

export type TraceRegistryEntry = {
  voucher_hash: string;
  full_denom: string;
};

export type TraceRegistryShardDatum = {
  bucket_index: bigint;
  entries: TraceRegistryEntry[];
};

export type TraceRegistryDirectoryBucket = {
  bucket_index: bigint;
  active_shard_name: string;
  archived_shard_names: string[];
};

export type TraceRegistryDirectoryDatum = {
  buckets: TraceRegistryDirectoryBucket[];
};

export type TraceRegistryDatum =
  | { Shard: TraceRegistryShardDatum }
  | { Directory: TraceRegistryDirectoryDatum };

export type TraceRegistryRedeemer =
  | {
      InsertTrace: {
        voucher_hash: string;
        full_denom: string;
      };
    }
  | {
      RolloverInsertTrace: {
        voucher_hash: string;
        full_denom: string;
        new_active_shard_name: string;
      };
    }
  | {
      AdvanceDirectory: {
        bucket_index: bigint;
        voucher_hash: string;
        full_denom: string;
        previous_active_shard_name: string;
        new_active_shard_name: string;
      };
    };

function buildSchemas(Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const TraceRegistryEntrySchema = Data.Object({
    voucher_hash: Data.Bytes(),
    full_denom: Data.Bytes(),
  });
  const TraceRegistryShardDatumSchema = Data.Object({
    bucket_index: Data.Integer(),
    entries: Data.Array(TraceRegistryEntrySchema),
  });
  const TraceRegistryDirectoryBucketSchema = Data.Object({
    bucket_index: Data.Integer(),
    active_shard_name: Data.Bytes(),
    archived_shard_names: Data.Array(Data.Bytes()),
  });
  const TraceRegistryDirectoryDatumSchema = Data.Object({
    buckets: Data.Array(TraceRegistryDirectoryBucketSchema),
  });
  const TraceRegistryDatumSchema = Data.Enum([
    Data.Object({
      Shard: TraceRegistryShardDatumSchema,
    }),
    Data.Object({
      Directory: TraceRegistryDirectoryDatumSchema,
    }),
  ]);
  const TraceRegistryRedeemerSchema = Data.Enum([
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

  return {
    TraceRegistryDatumSchema,
    TraceRegistryRedeemerSchema,
    TraceRegistryShardDatumSchema,
    TraceRegistryDirectoryDatumSchema,
  };
}

export function encodeTraceRegistryDatum(
  datum: TraceRegistryDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const { TraceRegistryDatumSchema } = buildSchemas(Lucid);

  if ('Shard' in datum) {
    return Data.to(
      {
        Shard: {
          ...datum.Shard,
          entries: datum.Shard.entries.map((entry) => ({
            voucher_hash: entry.voucher_hash,
            full_denom: convertString2Hex(entry.full_denom),
          })),
        },
      },
      TraceRegistryDatumSchema as unknown as TraceRegistryDatum,
      { canonical: true },
    );
  }

  return Data.to(
    {
      Directory: {
        buckets: datum.Directory.buckets.map((bucket) => ({
          ...bucket,
          active_shard_name: bucket.active_shard_name,
          archived_shard_names: bucket.archived_shard_names,
        })),
      },
    },
    TraceRegistryDatumSchema as unknown as TraceRegistryDatum,
    { canonical: true },
  );
}

export function decodeTraceRegistryDatum(
  encodedDatum: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): TraceRegistryDatum {
  const { Data } = Lucid;
  const { TraceRegistryDatumSchema } = buildSchemas(Lucid);
  const decoded = Data.from(encodedDatum, TraceRegistryDatumSchema as unknown as TraceRegistryDatum);

  if ('Shard' in decoded) {
    return {
      Shard: {
        bucket_index: decoded.Shard.bucket_index,
        entries: decoded.Shard.entries.map((entry) => ({
          voucher_hash: entry.voucher_hash,
          full_denom: convertHex2String(entry.full_denom),
        })),
      },
    };
  }

  return {
    Directory: {
      buckets: decoded.Directory.buckets.map((bucket) => ({
        bucket_index: bucket.bucket_index,
        active_shard_name: bucket.active_shard_name,
        archived_shard_names: bucket.archived_shard_names,
      })),
    },
  };
}

export function encodeTraceRegistryRedeemer(
  redeemer: TraceRegistryRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const { TraceRegistryRedeemerSchema } = buildSchemas(Lucid);

  if ('InsertTrace' in redeemer) {
    return Data.to(
      {
        InsertTrace: {
          voucher_hash: redeemer.InsertTrace.voucher_hash,
          full_denom: convertString2Hex(redeemer.InsertTrace.full_denom),
        },
      },
      TraceRegistryRedeemerSchema as unknown as TraceRegistryRedeemer,
      { canonical: true },
    );
  }

  if ('RolloverInsertTrace' in redeemer) {
    return Data.to(
      {
        RolloverInsertTrace: {
          voucher_hash: redeemer.RolloverInsertTrace.voucher_hash,
          full_denom: convertString2Hex(redeemer.RolloverInsertTrace.full_denom),
          new_active_shard_name: redeemer.RolloverInsertTrace.new_active_shard_name,
        },
      },
      TraceRegistryRedeemerSchema as unknown as TraceRegistryRedeemer,
      { canonical: true },
    );
  }

  return Data.to(
    {
      AdvanceDirectory: {
        bucket_index: redeemer.AdvanceDirectory.bucket_index,
        voucher_hash: redeemer.AdvanceDirectory.voucher_hash,
        full_denom: convertString2Hex(redeemer.AdvanceDirectory.full_denom),
        previous_active_shard_name: redeemer.AdvanceDirectory.previous_active_shard_name,
        new_active_shard_name: redeemer.AdvanceDirectory.new_active_shard_name,
      },
    },
    TraceRegistryRedeemerSchema as unknown as TraceRegistryRedeemer,
    { canonical: true },
  );
}
