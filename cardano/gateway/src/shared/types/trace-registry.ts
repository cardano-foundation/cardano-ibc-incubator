import { convertHex2String, convertString2Hex } from '../helpers/hex';

export type TraceRegistryEntry = {
  voucher_hash: string;
  full_denom: string;
};

export type TraceRegistryShardDatum = {
  shard_index: bigint;
  entries: TraceRegistryEntry[];
};

export type TraceRegistryRedeemer = {
  InsertTrace: {
    voucher_hash: string;
    full_denom: string;
  };
};

export function encodeTraceRegistryShardDatum(
  datum: TraceRegistryShardDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const TraceRegistryEntrySchema = Data.Object({
    voucher_hash: Data.Bytes(),
    full_denom: Data.Bytes(),
  });
  const TraceRegistryShardDatumSchema = Data.Object({
    shard_index: Data.Integer(),
    entries: Data.Array(TraceRegistryEntrySchema),
  });

  return Data.to(
    {
      ...datum,
      entries: datum.entries.map((entry) => ({
        voucher_hash: entry.voucher_hash,
        full_denom: convertString2Hex(entry.full_denom),
      })),
    },
    TraceRegistryShardDatumSchema as unknown as TraceRegistryShardDatum,
    { canonical: true },
  );
}

export function decodeTraceRegistryShardDatum(
  encodedDatum: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): TraceRegistryShardDatum {
  const { Data } = Lucid;
  const TraceRegistryEntrySchema = Data.Object({
    voucher_hash: Data.Bytes(),
    full_denom: Data.Bytes(),
  });
  const TraceRegistryShardDatumSchema = Data.Object({
    shard_index: Data.Integer(),
    entries: Data.Array(TraceRegistryEntrySchema),
  });

  const decoded = Data.from(
    encodedDatum,
    TraceRegistryShardDatumSchema as unknown as {
      shard_index: bigint;
      entries: Array<{ voucher_hash: string; full_denom: string }>;
    },
  );

  return {
    shard_index: decoded.shard_index,
    entries: decoded.entries.map((entry) => ({
      voucher_hash: entry.voucher_hash,
      full_denom: convertHex2String(entry.full_denom),
    })),
  };
}

export function encodeTraceRegistryRedeemer(
  redeemer: TraceRegistryRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const TraceRegistryRedeemerSchema = Data.Object({
    InsertTrace: Data.Object({
      voucher_hash: Data.Bytes(),
      full_denom: Data.Bytes(),
    }),
  });

  const encodedRedeemer = {
    InsertTrace: {
      voucher_hash: redeemer.InsertTrace.voucher_hash,
      full_denom: convertString2Hex(redeemer.InsertTrace.full_denom),
    },
  };

  return Data.to(
    encodedRedeemer,
    TraceRegistryRedeemerSchema as unknown as TraceRegistryRedeemer,
    { canonical: true },
  );
}
