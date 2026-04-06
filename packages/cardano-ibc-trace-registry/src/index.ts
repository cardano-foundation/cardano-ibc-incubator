export interface CardanoAssetDenomTrace {
  assetId: string;
  kind: 'native' | 'ibc_voucher';
  path: string;
  baseDenom: string;
  fullDenom: string;
  voucherTokenName: string | null;
  voucherPolicyId: string | null;
  ibcDenomHash: string | null;
  displayName: string;
  displaySymbol: string;
  displayDescription: string;
}

export type TraceRegistryClientConfig = {
  bridgeManifestUrl: string;
  kupmiosUrl: string;
  fetchImpl?: typeof fetch;
};

export type TraceRegistryClient = {
  lookupCardanoAssetDenomTrace: (
    assetId: string,
  ) => Promise<CardanoAssetDenomTrace>;
  listCardanoIbcAssets: () => Promise<CardanoAssetDenomTrace[]>;
};

type BridgeManifest = {
  validators?: {
    mint_voucher?: {
      script_hash?: string;
    };
  };
  trace_registry?: {
    shard_policy_id: string;
    directory: {
      policy_id: string;
      token_name: string;
    };
  };
};

type TraceRegistryEntry = {
  voucher_hash: string;
  full_denom: string;
};

type TraceRegistryShardDatum = {
  bucket_index: bigint;
  entries: TraceRegistryEntry[];
};

type TraceRegistryDirectoryBucket = {
  bucket_index: bigint;
  active_shard_name: string;
  archived_shard_names: string[];
};

type TraceRegistryDirectoryDatum = {
  buckets: TraceRegistryDirectoryBucket[];
};

type TraceRegistryDatum =
  | { Shard: TraceRegistryShardDatum }
  | { Directory: TraceRegistryDirectoryDatum };

type KupmiosProvider = {
  getUtxoByUnit(unit: string): Promise<{
    txHash: string;
    outputIndex: number;
    datum?: string | null;
  } | undefined>;
};

type LucidModule = {
  Data: {
    from(encodedDatum: string): unknown;
  };
  Kupmios: new (kupoUrl: string, ogmiosUrl: string) => unknown;
};

type LoadedBucketShard = {
  tokenName: string;
  datum: TraceRegistryShardDatum;
};

type LoadedRegistryContext = {
  manifest: BridgeManifest;
  Lucid: LucidModule;
  provider: KupmiosProvider;
  registry: NonNullable<BridgeManifest['trace_registry']>;
  directory: TraceRegistryDirectoryDatum;
};

const LOVELACE = 'lovelace';
const CARDANO_POLICY_ID_HEX_LENGTH = 56;
const CHANNEL_ID_SEGMENT_REGEX = /^channel-\d+$/;

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
}

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

function hexToText(hex: string): string {
  if (!hex) {
    return '';
  }

  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex.length}`);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function decodeEntry(value: unknown): TraceRegistryEntry {
  const constr = expectConstr(value, 0);
  const [voucher_hash, full_denom] = constr.fields;

  return {
    voucher_hash: assertString(
      voucher_hash,
      'Invalid trace-registry entry voucher hash',
    ).toLowerCase(),
    full_denom: hexToText(
      assertString(full_denom, 'Invalid trace-registry entry full denom'),
    ),
  };
}

function decodeShardDatum(value: unknown): TraceRegistryShardDatum {
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

function decodeDirectoryBucket(value: unknown): TraceRegistryDirectoryBucket {
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

function decodeDirectoryDatum(value: unknown): TraceRegistryDirectoryDatum {
  const constr = expectConstr(value, 0);
  const [buckets] = constr.fields;
  if (!Array.isArray(buckets)) {
    throw new Error('Invalid trace-registry directory buckets');
  }

  return {
    buckets: buckets.map((bucket) => decodeDirectoryBucket(bucket)),
  };
}

function decodeTraceRegistryDatum(
  encodedDatum: string,
  Lucid: LucidModule,
): TraceRegistryDatum {
  const decoded = Lucid.Data.from(encodedDatum);
  const outer = expectConstr(decoded);

  if (outer.index === 0) {
    return { Shard: decodeShardDatum(outer.fields[0]) };
  }

  if (outer.index === 1) {
    return { Directory: decodeDirectoryDatum(outer.fields[0]) };
  }

  throw new Error(`Unknown trace-registry datum constructor ${outer.index}`);
}

function splitFullDenomTrace(fullDenomPath: string): {
  path: string;
  baseDenom: string;
} {
  const normalized = fullDenomPath.trim();
  if (!normalized) {
    throw new Error('Denom trace cannot be empty');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(
      `Denom trace contains empty path segments: ${fullDenomPath}`,
    );
  }

  let cursor = 0;
  while (cursor + 1 < segments.length) {
    const maybePortId = segments[cursor];
    const maybeChannelId = segments[cursor + 1];

    if (!maybePortId || !CHANNEL_ID_SEGMENT_REGEX.test(maybeChannelId)) {
      break;
    }
    cursor += 2;
  }

  const path = segments.slice(0, cursor).join('/');
  const baseSegments = segments.slice(cursor);
  if (baseSegments.length === 0) {
    throw new Error(
      `Denom trace is missing base denomination: ${fullDenomPath}`,
    );
  }

  return {
    path,
    baseDenom: baseSegments.join('/'),
  };
}

function deriveVoucherPresentation(fullDenom: string, baseDenom: string) {
  const trimmedBaseDenom = baseDenom.trim();
  const baseLabel = trimmedBaseDenom.includes('/')
    ? trimmedBaseDenom.split('/').filter(Boolean).at(-1) ?? trimmedBaseDenom
    : trimmedBaseDenom;

  const normalizedSymbol =
    /^u[a-z0-9]+$/i.test(baseLabel) && baseLabel.length > 1
      ? baseLabel.slice(1).toUpperCase()
      : (baseLabel || 'IBC').toUpperCase();

  return {
    displayName: `${normalizedSymbol} (IBC)`,
    displaySymbol: normalizedSymbol,
    displayDescription: `IBC voucher for ${fullDenom}`,
  };
}

async function computeIbcDenomHash(fullDenom: string): Promise<string> {
  const bytes = new TextEncoder().encode(fullDenom);

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }

  const { createHash } = await import('crypto');
  return createHash('sha256').update(bytes).digest('hex').toLowerCase();
}

function buildNativeAssetTrace(
  assetId: string,
  baseDenom: string,
  fullDenom: string,
): CardanoAssetDenomTrace {
  const displayName = fullDenom === LOVELACE ? 'ADA' : baseDenom;
  return {
    assetId,
    kind: 'native',
    path: '',
    baseDenom,
    fullDenom,
    voucherTokenName: null,
    voucherPolicyId: null,
    ibcDenomHash: null,
    displayName,
    displaySymbol: displayName,
    displayDescription: `Cardano native asset ${fullDenom}`,
  };
}

async function mapVoucherTrace(
  assetId: string,
  hash: string,
  fullDenom: string,
  voucherPolicyId: string,
): Promise<CardanoAssetDenomTrace> {
  const trace = splitFullDenomTrace(fullDenom);
  const presentation = deriveVoucherPresentation(fullDenom, trace.baseDenom);

  return {
    assetId,
    kind: 'ibc_voucher',
    path: trace.path,
    baseDenom: trace.baseDenom,
    fullDenom,
    voucherTokenName: hash,
    voucherPolicyId,
    ibcDenomHash: await computeIbcDenomHash(fullDenom),
    displayName: presentation.displayName,
    displaySymbol: presentation.displaySymbol,
    displayDescription: presentation.displayDescription,
  };
}

function parseCardanoAssetId(assetId: string): {
  assetId: string;
  policyId: string;
  assetNameHex: string;
} {
  const normalized = assetId.trim().toLowerCase();
  if (!normalized) {
    throw new Error('"assetId" is required');
  }

  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error(
      '"assetId" must be a hex-encoded Cardano asset unit or "lovelace"',
    );
  }

  if (normalized.length < CARDANO_POLICY_ID_HEX_LENGTH) {
    throw new Error('"assetId" must include a 56-character policy id');
  }

  const assetNameHex = normalized.slice(CARDANO_POLICY_ID_HEX_LENGTH);
  if (assetNameHex.length % 2 !== 0) {
    throw new Error('"assetId" token name bytes must be hex encoded');
  }

  return {
    assetId: normalized,
    policyId: normalized.slice(0, CARDANO_POLICY_ID_HEX_LENGTH),
    assetNameHex,
  };
}

function getBucketIndexForHash(hash: string): number {
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error(`Invalid voucher hash for trace-registry lookup: ${hash}`);
  }
  return Number.parseInt(hash[0], 16);
}

function getTraceRegistry(manifest: BridgeManifest) {
  if (!manifest.trace_registry) {
    throw new Error(
      'Bridge manifest does not include Cardano trace-registry config',
    );
  }
  return manifest.trace_registry;
}

function getVoucherPolicyId(manifest: BridgeManifest): string {
  const policyId = manifest.validators?.mint_voucher?.script_hash?.toLowerCase();
  if (!policyId) {
    throw new Error(
      'Bridge manifest does not include the Cardano voucher mint policy',
    );
  }
  return policyId;
}

function getKupmiosEndpoints(kupmiosUrl: string) {
  const [kupoUrl, ogmiosUrl] = kupmiosUrl.split(',').map((value) => value.trim());
  if (!kupoUrl || !ogmiosUrl) {
    throw new Error(
      'kupmiosUrl must be set to "<kupo-url>,<ogmios-url>" for on-chain trace-registry lookups.',
    );
  }

  return { kupoUrl, ogmiosUrl };
}

export function createTraceRegistryClient(
  config: TraceRegistryClientConfig,
): TraceRegistryClient {
  let bridgeManifestPromise: Promise<BridgeManifest> | null = null;
  let kupmiosProviderPromise: Promise<{
    Lucid: LucidModule;
    provider: KupmiosProvider;
  }> | null = null;

  const fetchImpl = config.fetchImpl ?? fetch;

  async function getBridgeManifest(): Promise<BridgeManifest> {
    if (!bridgeManifestPromise) {
      bridgeManifestPromise = fetchImpl(config.bridgeManifestUrl).then(
        async (response) => {
          if (!response.ok) {
            throw new Error(
              `Failed to load Cardano bridge manifest from ${config.bridgeManifestUrl} (${response.status})`,
            );
          }
          return response.json() as Promise<BridgeManifest>;
        },
      );
    }

    return bridgeManifestPromise;
  }

  async function getKupmiosProvider() {
    if (!kupmiosProviderPromise) {
      kupmiosProviderPromise = (async () => {
        const Lucid = await (eval(
          `import('@lucid-evolution/lucid')`,
        ) as Promise<LucidModule>);
        const { kupoUrl, ogmiosUrl } = getKupmiosEndpoints(config.kupmiosUrl);

        return {
          Lucid,
          provider: new Lucid.Kupmios(
            kupoUrl,
            ogmiosUrl,
          ) as unknown as KupmiosProvider,
        };
      })();
    }

    return kupmiosProviderPromise;
  }

  async function loadRegistryContext(): Promise<LoadedRegistryContext> {
    const manifest = await getBridgeManifest();
    const { Lucid, provider } = await getKupmiosProvider();
    const registry = getTraceRegistry(manifest);
    const directoryUnit =
      `${registry.directory.policy_id}${registry.directory.token_name}`.toLowerCase();
    const directoryUtxo = await provider.getUtxoByUnit(directoryUnit);

    if (!directoryUtxo?.datum) {
      throw new Error(
        'Unable to load the canonical Cardano trace-registry directory UTxO',
      );
    }

    const decoded = decodeTraceRegistryDatum(directoryUtxo.datum, Lucid);
    if (!('Directory' in decoded)) {
      throw new Error(
        'Trace-registry directory witness does not carry a directory datum',
      );
    }

    return {
      manifest,
      Lucid,
      provider,
      registry,
      directory: decoded.Directory,
    };
  }

  function getBucket(
    directory: TraceRegistryDirectoryDatum,
    bucketIndex: number,
  ): TraceRegistryDirectoryBucket {
    const bucket = directory.buckets.find(
      (candidate) => Number(candidate.bucket_index) === bucketIndex,
    );
    if (!bucket) {
      throw new Error(`Missing trace-registry bucket ${bucketIndex}`);
    }
    return bucket;
  }

  async function loadBucketShards(
    context: LoadedRegistryContext,
    bucketIndex: number,
    bucket: TraceRegistryDirectoryBucket,
  ): Promise<LoadedBucketShard[]> {
    const tokenNames = [bucket.active_shard_name, ...bucket.archived_shard_names];
    const uniqueTokenNames = Array.from(new Set(tokenNames));

    return Promise.all(
      uniqueTokenNames.map(async (tokenName) => {
        const unit =
          `${context.registry.shard_policy_id}${tokenName}`.toLowerCase();
        const shardUtxo = await context.provider.getUtxoByUnit(unit);
        if (!shardUtxo?.datum) {
          throw new Error(`Trace-registry shard ${unit} is missing inline datum`);
        }

        const decoded = decodeTraceRegistryDatum(shardUtxo.datum, context.Lucid);
        if (!('Shard' in decoded)) {
          throw new Error(
            `Trace-registry shard ${unit} does not carry a shard datum`,
          );
        }
        if (Number(decoded.Shard.bucket_index) !== bucketIndex) {
          throw new Error(
            `Trace-registry shard ${unit} belongs to bucket ${decoded.Shard.bucket_index.toString()}, expected ${bucketIndex}`,
          );
        }

        return {
          tokenName,
          datum: decoded.Shard,
        };
      }),
    );
  }

  async function findVoucherEntryByHash(
    hash: string,
  ): Promise<TraceRegistryEntry | null> {
    const normalizedHash = hash.toLowerCase();
    const context = await loadRegistryContext();
    const bucketIndex = getBucketIndexForHash(normalizedHash);
    const bucket = getBucket(context.directory, bucketIndex);
    const shards = await loadBucketShards(context, bucketIndex, bucket);

    const matches = shards.flatMap((shard) =>
      shard.datum.entries.filter(
        (entry) => entry.voucher_hash.toLowerCase() === normalizedHash,
      ),
    );

    if (matches.length > 1) {
      throw new Error(
        `Duplicate trace-registry entries detected for voucher hash ${normalizedHash}`,
      );
    }

    return matches[0] ?? null;
  }

  async function findAllVoucherEntries(): Promise<TraceRegistryEntry[]> {
    const context = await loadRegistryContext();
    const shardsPerBucket = await Promise.all(
      context.directory.buckets.map(async (bucket) =>
        loadBucketShards(context, Number(bucket.bucket_index), bucket),
      ),
    );

    const seen = new Set<string>();
    const entries: TraceRegistryEntry[] = [];

    for (const bucketShards of shardsPerBucket) {
      for (const shard of bucketShards) {
        for (const entry of shard.datum.entries) {
          const normalizedHash = entry.voucher_hash.toLowerCase();
          if (seen.has(normalizedHash)) {
            throw new Error(
              `Duplicate trace-registry entries detected for voucher hash ${normalizedHash}`,
            );
          }
          seen.add(normalizedHash);
          entries.push({
            voucher_hash: normalizedHash,
            full_denom: entry.full_denom,
          });
        }
      }
    }

    return entries;
  }

  async function lookupCardanoAssetDenomTrace(
    assetId: string,
  ): Promise<CardanoAssetDenomTrace> {
    if (assetId.trim().toLowerCase() === LOVELACE) {
      return buildNativeAssetTrace(LOVELACE, LOVELACE, LOVELACE);
    }

    const parsed = parseCardanoAssetId(assetId);
    const manifest = await getBridgeManifest();
    const voucherPolicyId = getVoucherPolicyId(manifest);

    if (parsed.policyId !== voucherPolicyId) {
      return buildNativeAssetTrace(
        parsed.assetId,
        parsed.assetId,
        parsed.assetId,
      );
    }

    const entry = await findVoucherEntryByHash(parsed.assetNameHex);
    if (!entry) {
      return buildNativeAssetTrace(
        parsed.assetId,
        parsed.assetId,
        parsed.assetId,
      );
    }

    return await mapVoucherTrace(
      parsed.assetId,
      entry.voucher_hash,
      entry.full_denom,
      voucherPolicyId,
    );
  }

  async function listCardanoIbcAssets(): Promise<CardanoAssetDenomTrace[]> {
    const manifest = await getBridgeManifest();
    const voucherPolicyId = getVoucherPolicyId(manifest);
    const entries = await findAllVoucherEntries();

    const traces = await Promise.all(
      entries.map((entry) =>
        mapVoucherTrace(
          `${voucherPolicyId}${entry.voucher_hash}`.toLowerCase(),
          entry.voucher_hash,
          entry.full_denom,
          voucherPolicyId,
        ),
      ),
    );

    return traces.sort(
      (left, right) =>
        left.fullDenom.localeCompare(right.fullDenom) ||
        left.assetId.localeCompare(right.assetId),
    );
  }

  return {
    lookupCardanoAssetDenomTrace,
    listCardanoIbcAssets,
  };
}
