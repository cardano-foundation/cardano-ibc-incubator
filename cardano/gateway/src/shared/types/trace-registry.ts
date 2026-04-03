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

function expectConstr(
  value: unknown,
  expectedIndex?: number,
): { index: number; fields: unknown[] } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('index' in value) ||
    !('fields' in value)
  ) {
    throw new Error('Expected trace-registry constructor data');
  }

  const constr = value as { index: number; fields: unknown[] };
  if (expectedIndex !== undefined && constr.index !== expectedIndex) {
    throw new Error(
      `Unexpected trace-registry constructor index ${constr.index}, expected ${expectedIndex}`,
    );
  }
  return constr;
}

function encodeEntry(
  entry: TraceRegistryEntry,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Constr } = Lucid;
  return new Constr(0, [
    entry.voucher_hash,
    convertString2Hex(entry.full_denom),
  ]);
}

function decodeEntry(
  value: unknown,
): TraceRegistryEntry {
  const constr = expectConstr(value, 0);
  const [voucher_hash, full_denom] = constr.fields;
  if (typeof voucher_hash !== 'string' || typeof full_denom !== 'string') {
    throw new Error('Invalid trace-registry entry fields');
  }

  return {
    voucher_hash,
    full_denom: convertHex2String(full_denom),
  };
}

function encodeShardDatum(
  datum: TraceRegistryShardDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Constr } = Lucid;
  return new Constr(0, [
    datum.bucket_index,
    datum.entries.map((entry) => encodeEntry(entry, Lucid)),
  ]);
}

function decodeShardDatum(
  value: unknown,
): TraceRegistryShardDatum {
  const constr = expectConstr(value, 0);
  const [bucket_index, entries] = constr.fields;
  if (typeof bucket_index !== 'bigint' || !Array.isArray(entries)) {
    throw new Error('Invalid trace-registry shard datum fields');
  }

  return {
    bucket_index,
    entries: entries.map((entry) => decodeEntry(entry)),
  };
}

function encodeDirectoryBucket(
  bucket: TraceRegistryDirectoryBucket,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Constr } = Lucid;
  return new Constr(0, [
    bucket.bucket_index,
    bucket.active_shard_name,
    bucket.archived_shard_names,
  ]);
}

function decodeDirectoryBucket(
  value: unknown,
): TraceRegistryDirectoryBucket {
  const constr = expectConstr(value, 0);
  const [bucket_index, active_shard_name, archived_shard_names] = constr.fields;
  if (
    typeof bucket_index !== 'bigint' ||
    typeof active_shard_name !== 'string' ||
    !Array.isArray(archived_shard_names) ||
    !archived_shard_names.every((name) => typeof name === 'string')
  ) {
    throw new Error('Invalid trace-registry directory bucket fields');
  }

  return {
    bucket_index,
    active_shard_name,
    archived_shard_names,
  };
}

function encodeDirectoryDatum(
  datum: TraceRegistryDirectoryDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Constr } = Lucid;
  return new Constr(0, [
    datum.buckets.map((bucket) => encodeDirectoryBucket(bucket, Lucid)),
  ]);
}

function decodeDirectoryDatum(
  value: unknown,
): TraceRegistryDirectoryDatum {
  const constr = expectConstr(value, 0);
  const [buckets] = constr.fields;
  if (!Array.isArray(buckets)) {
    throw new Error('Invalid trace-registry directory datum buckets');
  }

  return {
    buckets: buckets.map((bucket) => decodeDirectoryBucket(bucket)),
  };
}

export function encodeTraceRegistryDatum(
  datum: TraceRegistryDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Constr, Data } = Lucid;

  if ('Shard' in datum) {
    return Data.to(new Constr(0, [encodeShardDatum(datum.Shard, Lucid)]), undefined, {
      canonical: true,
    });
  }

  return Data.to(
    new Constr(1, [encodeDirectoryDatum(datum.Directory, Lucid)]),
    undefined,
    { canonical: true },
  );
}

export function decodeTraceRegistryDatum(
  encodedDatum: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): TraceRegistryDatum {
  const { Data } = Lucid;
  const decoded = Data.from(encodedDatum);
  const outer = expectConstr(decoded);

  if (outer.index === 0) {
    return { Shard: decodeShardDatum(outer.fields[0]) };
  }

  if (outer.index === 1) {
    return { Directory: decodeDirectoryDatum(outer.fields[0]) };
  }

  throw new Error(`Unknown trace-registry datum constructor ${outer.index}`);
}

export function encodeTraceRegistryRedeemer(
  redeemer: TraceRegistryRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Constr, Data } = Lucid;

  if ('InsertTrace' in redeemer) {
    return Data.to(
      new Constr(0, [
        redeemer.InsertTrace.voucher_hash,
        convertString2Hex(redeemer.InsertTrace.full_denom),
      ]),
      undefined,
      { canonical: true },
    );
  }

  if ('RolloverInsertTrace' in redeemer) {
    return Data.to(
      new Constr(1, [
        redeemer.RolloverInsertTrace.voucher_hash,
        convertString2Hex(redeemer.RolloverInsertTrace.full_denom),
        redeemer.RolloverInsertTrace.new_active_shard_name,
      ]),
      undefined,
      { canonical: true },
    );
  }

  return Data.to(
    new Constr(2, [
      redeemer.AdvanceDirectory.bucket_index,
      redeemer.AdvanceDirectory.voucher_hash,
      convertString2Hex(redeemer.AdvanceDirectory.full_denom),
      redeemer.AdvanceDirectory.previous_active_shard_name,
      redeemer.AdvanceDirectory.new_active_shard_name,
    ]),
    undefined,
    { canonical: true },
  );
}
