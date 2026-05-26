import {
  buildIbcDenomHashFromFullDenom,
  buildVoucherDenomHashFromFullDenom,
  buildVoucherUserTokenNameFromDenomHash,
  decodeVerifiedVoucherCip68MetadataDatum,
  deriveVoucherPresentation,
  deriveVoucherReferenceAssetId,
  parseVoucherAssetName,
  splitFullDenomTrace,
  type Cip68VoucherMetadata,
  type LucidDataModule,
  VOUCHER_DENOM_HASH_HEX_LENGTH,
  VOUCHER_METADATA_VERSION,
} from "./voucher";

export {
  buildIbcDenomHashFromFullDenom,
  buildVoucherAssetId,
  buildVoucherCip68Metadata,
  buildVoucherDenomHashFromFullDenom,
  buildVoucherReferenceTokenNameFromDenomHash,
  buildVoucherReferenceTokenNameFromFullDenom,
  buildVoucherUserTokenNameFromDenomHash,
  buildVoucherUserTokenNameFromFullDenom,
  CIP67_FT_LABEL_HEX,
  CIP67_REFERENCE_NFT_LABEL_HEX,
  decodeVerifiedVoucherCip68MetadataDatum,
  decodeVoucherCip68MetadataDatum,
  deriveVoucherCanonicalLabel,
  deriveVoucherPresentation,
  deriveVoucherReferenceAssetId,
  encodeVoucherCip68MetadataDatum,
  expectVoucherAssetName,
  isVoucherAssetName,
  isVoucherReferenceTokenName,
  isVoucherUserTokenName,
  LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH,
  parseVoucherAssetName,
  splitFullDenomTrace,
  VOUCHER_DENOM_HASH_HEX_LENGTH,
  VOUCHER_METADATA_VERSION,
  type BuildVoucherMetadataParams,
  type Cip68VoucherMetadata,
  type DenomTraceParts,
  type LucidDataModule,
  type ParsedVoucherAssetName,
  type VoucherLabelKind,
  type VoucherPresentation,
} from "./voucher";

export interface CardanoAssetDenomTrace {
  assetId: string;
  kind: "native" | "ibc_voucher";
  path: string;
  baseDenom: string;
  fullDenom: string;
  voucherTokenName: string | null;
  cip68ReferenceAssetId?: string | null;
  voucherPolicyId: string | null;
  voucherPolicyStatus?: VoucherPolicyStatus | null;
  ibcDenomHash: string | null;
  displayName: string;
  displaySymbol: string;
  displayDescription: string;
  description?: string | null;
  ticker?: string | null;
  decimals?: number | null;
  url?: string | null;
  logo?: string | null;
  metadataVersion?: number | null;
}

type KupmiosAuthHeaders = {
  kupoHeader?: Record<string, string>;
  ogmiosHeader?: Record<string, string>;
};

export type TraceRegistryClientConfig = {
  bridgeManifestUrl: string;
  kupmiosUrl: string;
  kupmiosHeaders?: KupmiosAuthHeaders;
  fetchImpl?: typeof fetch;
};

export type TraceRegistryClient = {
  lookupCardanoAssetDenomTrace: (
    assetId: string,
  ) => Promise<CardanoAssetDenomTrace>;
  lookupIbcDenomTrace: (
    ibcDenomHash: string,
  ) => Promise<CardanoAssetDenomTrace | null>;
  listCardanoIbcAssets: () => Promise<CardanoAssetDenomTrace[]>;
};

export type VoucherPolicyStatus = "active" | "legacy";

export type VoucherPolicyRegistryEntry = {
  policyId: string;
  status: VoucherPolicyStatus;
  compatibility?: VoucherPolicyCompatibilityProfile;
};

export type VoucherPolicyRegistry = {
  active: VoucherPolicyRegistryEntry;
  legacy: VoucherPolicyRegistryEntry[];
};

export type VoucherPolicyCompatibilityProfile = {
  compatibleBridgeVersion: number;
  voucherAssetNameVersion: number;
  redeemerVersion: number;
  packetDataEncodingVersion: number;
  transferDenomLogicVersion: number;
  channelIdDerivationVersion: number;
  hostStateChannelSemanticsVersion: number;
  traceRegistrySemanticsVersion: number;
  metadataFormatVersion: number;
  bridgeRegistryToken: {
    policyId: string;
    name: string;
  };
  traceRegistryId: string;
};

type VoucherPolicyManifestCompatibilityProfile = {
  compatible_bridge_version?: number;
  voucher_asset_name_version?: number;
  redeemer_version?: number;
  packet_data_encoding_version?: number;
  transfer_denom_logic_version?: number;
  channel_id_derivation_version?: number;
  host_state_channel_semantics_version?: number;
  trace_registry_semantics_version?: number;
  metadata_format_version?: number;
  bridge_registry_token?: {
    policy_id?: string;
    token_name?: string;
  };
  trace_registry_id?: string;
};

type VoucherPolicyManifestEntry =
  | string
  | {
      policy_id?: string;
      policyId?: string;
      script_hash?: string;
      scriptHash?: string;
      address?: string;
      ref_utxo?: unknown;
      refUtxo?: unknown;
      compatibility?: VoucherPolicyManifestCompatibilityProfile;
    };

export type BridgeManifest = {
  validators?: {
    mint_voucher?: {
      script_hash?: string;
    };
  };
  voucher_policy_registry?: {
    active?: VoucherPolicyManifestEntry;
    legacy?: VoucherPolicyManifestEntry[];
  };
  trace_registry?: {
    address?: string;
    shard_policy_id: string;
    directory: {
      policy_id: string;
      token_name: string;
    };
  };
  bridge_registry?: {
    policy_id: string;
    token_name: string;
  };
};

export type TraceRegistryEntry = {
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
  getUtxoByUnit(unit: string): Promise<
    | {
        txHash: string;
        outputIndex: number;
        datum?: string | null;
      }
    | undefined
  >;
};

type LucidModule = LucidDataModule & {
  Kupmios: new (
    kupoUrl: string,
    ogmiosUrl: string,
    headers?: KupmiosAuthHeaders,
  ) => unknown;
};

type LoadedBucketShard = {
  tokenName: string;
  datum: TraceRegistryShardDatum;
};

type LoadedRegistryContext = {
  manifest: BridgeManifest;
  Lucid: LucidModule;
  provider: KupmiosProvider;
  registry: NonNullable<BridgeManifest["trace_registry"]>;
  directory: TraceRegistryDirectoryDatum;
};

const LOVELACE = "lovelace";
const CARDANO_POLICY_ID_HEX_LENGTH = 56;

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  return value;
}

function expectConstr(
  value: unknown,
  expectedIndex?: number,
): { index: number; fields: unknown[] } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("index" in value) ||
    !("fields" in value)
  ) {
    throw new Error("Expected trace-registry constructor data");
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
    return "";
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
      "Invalid trace-registry entry voucher hash",
    ).toLowerCase(),
    full_denom: hexToText(
      assertString(full_denom, "Invalid trace-registry entry full denom"),
    ),
  };
}

function decodeShardDatum(value: unknown): TraceRegistryShardDatum {
  const constr = expectConstr(value, 0);
  const [bucket_index, entries] = constr.fields;

  if (typeof bucket_index !== "bigint" || !Array.isArray(entries)) {
    throw new Error("Invalid trace-registry shard datum fields");
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
    typeof bucket_index !== "bigint" ||
    typeof active_shard_name !== "string" ||
    !Array.isArray(archived_shard_names) ||
    !archived_shard_names.every((name) => typeof name === "string")
  ) {
    throw new Error("Invalid trace-registry directory bucket fields");
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
    throw new Error("Invalid trace-registry directory buckets");
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

function buildNativeAssetTrace(
  assetId: string,
  baseDenom: string,
  fullDenom: string,
): CardanoAssetDenomTrace {
  const displayName = fullDenom === LOVELACE ? "ADA" : baseDenom;
  return {
    assetId,
    kind: "native",
    path: "",
    baseDenom,
    fullDenom,
    voucherTokenName: null,
    cip68ReferenceAssetId: null,
    voucherPolicyId: null,
    voucherPolicyStatus: null,
    ibcDenomHash: null,
    displayName,
    displaySymbol: displayName,
    displayDescription: `Cardano native asset ${fullDenom}`,
    description: null,
    ticker: null,
    decimals: null,
    url: null,
    logo: null,
    metadataVersion: null,
  };
}

async function mapVoucherTrace(
  assetId: string,
  hash: string,
  fullDenom: string,
  metadata: Cip68VoucherMetadata | null,
  voucherPolicy: VoucherPolicyRegistryEntry,
): Promise<CardanoAssetDenomTrace> {
  const trace = splitFullDenomTrace(fullDenom);
  const presentation = deriveVoucherPresentation(fullDenom, trace.baseDenom);
  const voucherTokenName = buildVoucherUserTokenNameFromDenomHash(hash);

  return {
    assetId,
    kind: "ibc_voucher",
    path: trace.path,
    baseDenom: trace.baseDenom,
    fullDenom,
    voucherTokenName,
    cip68ReferenceAssetId: deriveVoucherReferenceAssetId(
      voucherPolicy.policyId,
      hash,
    ),
    voucherPolicyId: voucherPolicy.policyId,
    voucherPolicyStatus: voucherPolicy.status,
    ibcDenomHash: buildIbcDenomHashFromFullDenom(fullDenom),
    displayName: metadata?.name ?? presentation.displayName,
    displaySymbol: metadata?.ticker ?? presentation.displaySymbol,
    displayDescription:
      metadata?.description ?? presentation.displayDescription,
    description: metadata?.description ?? presentation.displayDescription,
    ticker: metadata?.ticker ?? presentation.displaySymbol,
    decimals: metadata?.decimals ?? null,
    url: metadata?.url ?? null,
    logo: metadata?.logo ?? null,
    metadataVersion: metadata?.version ?? null,
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
  if (
    !new RegExp(`^[0-9a-f]{${VOUCHER_DENOM_HASH_HEX_LENGTH}}$`, "i").test(hash)
  ) {
    throw new Error(`Invalid voucher hash for trace-registry lookup: ${hash}`);
  }
  return Number.parseInt(hash[0], 16);
}

function getTraceRegistry(manifest: BridgeManifest) {
  if (!manifest.trace_registry) {
    throw new Error(
      "Bridge manifest does not include Cardano trace-registry config",
    );
  }
  return manifest.trace_registry;
}

function normalizePolicyId(policyId: string, field: string): string {
  const normalized = policyId.trim().toLowerCase();
  if (
    !new RegExp(`^[0-9a-f]{${CARDANO_POLICY_ID_HEX_LENGTH}}$`, "i").test(
      normalized,
    )
  ) {
    throw new Error(
      `${field} must be a ${CARDANO_POLICY_ID_HEX_LENGTH}-character policy id`,
    );
  }
  return normalized;
}

const VOUCHER_COMPATIBILITY_PROTOCOL = {
  compatibleBridgeVersion: 1,
  voucherAssetNameVersion: 1,
  redeemerVersion: 1,
  packetDataEncodingVersion: 1,
  transferDenomLogicVersion: 1,
  channelIdDerivationVersion: 1,
  hostStateChannelSemanticsVersion: 1,
  traceRegistrySemanticsVersion: 1,
  metadataFormatVersion: VOUCHER_METADATA_VERSION,
} as const;

function requireCompatibilityNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function traceRegistryId(manifest: BridgeManifest): string {
  const registry = getTraceRegistry(manifest);
  return [
    registry.address ?? "",
    registry.shard_policy_id,
    registry.directory.policy_id,
    registry.directory.token_name,
  ].join(":");
}

function expectedVoucherCompatibilityProfile(
  manifest: BridgeManifest,
): VoucherPolicyCompatibilityProfile {
  if (!manifest.bridge_registry) {
    throw new Error(
      "Bridge manifest legacy voucher policies require bridge_registry",
    );
  }
  return {
    ...VOUCHER_COMPATIBILITY_PROTOCOL,
    bridgeRegistryToken: {
      policyId: manifest.bridge_registry.policy_id,
      name: manifest.bridge_registry.token_name,
    },
    traceRegistryId: traceRegistryId(manifest),
  };
}

function normalizeCompatibilityProfile(
  profile: VoucherPolicyManifestCompatibilityProfile,
  field: string,
): VoucherPolicyCompatibilityProfile {
  if (!profile.bridge_registry_token) {
    throw new Error(`${field}.bridge_registry_token must be present`);
  }
  return {
    compatibleBridgeVersion: requireCompatibilityNumber(
      profile.compatible_bridge_version,
      `${field}.compatible_bridge_version`,
    ),
    voucherAssetNameVersion: requireCompatibilityNumber(
      profile.voucher_asset_name_version,
      `${field}.voucher_asset_name_version`,
    ),
    redeemerVersion: requireCompatibilityNumber(
      profile.redeemer_version,
      `${field}.redeemer_version`,
    ),
    packetDataEncodingVersion: requireCompatibilityNumber(
      profile.packet_data_encoding_version,
      `${field}.packet_data_encoding_version`,
    ),
    transferDenomLogicVersion: requireCompatibilityNumber(
      profile.transfer_denom_logic_version,
      `${field}.transfer_denom_logic_version`,
    ),
    channelIdDerivationVersion: requireCompatibilityNumber(
      profile.channel_id_derivation_version,
      `${field}.channel_id_derivation_version`,
    ),
    hostStateChannelSemanticsVersion: requireCompatibilityNumber(
      profile.host_state_channel_semantics_version,
      `${field}.host_state_channel_semantics_version`,
    ),
    traceRegistrySemanticsVersion: requireCompatibilityNumber(
      profile.trace_registry_semantics_version,
      `${field}.trace_registry_semantics_version`,
    ),
    metadataFormatVersion: requireCompatibilityNumber(
      profile.metadata_format_version,
      `${field}.metadata_format_version`,
    ),
    bridgeRegistryToken: {
      policyId: profile.bridge_registry_token.policy_id ?? "",
      name: profile.bridge_registry_token.token_name ?? "",
    },
    traceRegistryId: profile.trace_registry_id ?? "",
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compatibilityMatches(
  left: VoucherPolicyCompatibilityProfile,
  right: VoucherPolicyCompatibilityProfile,
): boolean {
  return stableJson(left) === stableJson(right);
}

function policyIdFromManifestEntry(
  entry: VoucherPolicyManifestEntry | undefined,
  field: string,
): string | null {
  if (!entry) {
    return null;
  }
  if (typeof entry === "string") {
    return normalizePolicyId(entry, field);
  }
  const policyId =
    entry.policy_id ?? entry.policyId ?? entry.script_hash ?? entry.scriptHash;
  if (!policyId) {
    throw new Error(`${field} must include policy_id or script_hash`);
  }
  return normalizePolicyId(policyId, field);
}

function compatibilityFromManifestEntry(
  entry: VoucherPolicyManifestEntry | undefined,
  field: string,
): VoucherPolicyCompatibilityProfile | undefined {
  if (!entry || typeof entry === "string" || !entry.compatibility) {
    return undefined;
  }
  return normalizeCompatibilityProfile(
    entry.compatibility,
    `${field}.compatibility`,
  );
}

function uniquePolicyEntries(
  entriesToNormalize: readonly VoucherPolicyRegistryEntry[],
  status: VoucherPolicyStatus,
): VoucherPolicyRegistryEntry[] {
  const seen = new Set<string>();
  const entries: VoucherPolicyRegistryEntry[] = [];
  for (const entry of entriesToNormalize) {
    if (seen.has(entry.policyId)) {
      continue;
    }
    seen.add(entry.policyId);
    entries.push({ ...entry, status });
  }
  return entries;
}

export function normalizeVoucherPolicyRegistry(
  manifest: BridgeManifest,
): VoucherPolicyRegistry {
  const activePolicyId =
    policyIdFromManifestEntry(
      manifest.voucher_policy_registry?.active,
      "voucher_policy_registry.active",
    ) ?? manifest.validators?.mint_voucher?.script_hash?.toLowerCase();

  const policyId = activePolicyId
    ? normalizePolicyId(activePolicyId, "validators.mint_voucher.script_hash")
    : null;
  if (!policyId) {
    throw new Error(
      "Bridge manifest does not include the Cardano voucher mint policy",
    );
  }

  const legacyPolicyIds =
    manifest.voucher_policy_registry?.legacy?.map((entry, index) =>
      policyIdFromManifestEntry(
        entry,
        `voucher_policy_registry.legacy[${index}]`,
      ),
    ) ?? [];

  const legacyRequiresCompatibility = legacyPolicyIds.some(Boolean);
  const hasCompatibilityContext =
    !!manifest.bridge_registry && !!manifest.trace_registry;
  const expectedCompatibility = hasCompatibilityContext
    ? expectedVoucherCompatibilityProfile(manifest)
    : undefined;
  if (legacyRequiresCompatibility && !expectedCompatibility) {
    throw new Error(
      "Bridge manifest legacy voucher policies require bridge_registry and trace_registry",
    );
  }
  const activeCompatibility =
    compatibilityFromManifestEntry(
      manifest.voucher_policy_registry?.active,
      "voucher_policy_registry.active",
    ) ?? expectedCompatibility;
  const active = {
    policyId,
    status: "active" as const,
    ...(activeCompatibility ? { compatibility: activeCompatibility } : {}),
  };
  const legacyCandidates: VoucherPolicyRegistryEntry[] = [];
  legacyPolicyIds.forEach((candidate, index) => {
    if (!candidate) {
      return;
    }
    const compatibility = compatibilityFromManifestEntry(
      manifest.voucher_policy_registry?.legacy?.[index],
      `voucher_policy_registry.legacy[${index}]`,
    );
    legacyCandidates.push({
      policyId: candidate,
      status: "legacy",
      ...(compatibility ? { compatibility } : {}),
    });
  });
  const legacy = uniquePolicyEntries(legacyCandidates, "legacy").filter(
    (entry) => entry.policyId !== active.policyId,
  );

  if (
    expectedCompatibility &&
    activeCompatibility &&
    !compatibilityMatches(activeCompatibility, expectedCompatibility)
  ) {
    throw new Error(
      "Active voucher policy compatibility does not match this bridge manifest",
    );
  }
  for (const entry of legacy) {
    if (!entry.compatibility) {
      throw new Error(
        `Legacy voucher policy ${entry.policyId} is missing compatibility`,
      );
    }
    if (
      !expectedCompatibility ||
      !compatibilityMatches(entry.compatibility, expectedCompatibility)
    ) {
      throw new Error(
        `Legacy voucher policy ${entry.policyId} is not compatible with this bridge manifest`,
      );
    }
  }

  return { active, legacy };
}

export function getActiveVoucherPolicyId(manifest: BridgeManifest): string {
  return normalizeVoucherPolicyRegistry(manifest).active.policyId;
}

export function listOperationalVoucherPolicies(
  manifest: BridgeManifest,
): VoucherPolicyRegistryEntry[] {
  const registry = normalizeVoucherPolicyRegistry(manifest);
  return [registry.active, ...registry.legacy];
}

export function findVoucherPolicy(
  manifest: BridgeManifest,
  policyId: string,
): VoucherPolicyRegistryEntry | null {
  const normalized = normalizePolicyId(policyId, "asset policy id");
  const registry = normalizeVoucherPolicyRegistry(manifest);
  return (
    [registry.active, ...registry.legacy].find(
      (entry) => entry.policyId === normalized,
    ) ?? null
  );
}

function unresolvedVoucherTraceError(
  assetId: string,
  voucherHash: string,
): Error {
  return new Error(
    `Cardano asset ${assetId} matches the bridge voucher mint policy and CIP-67 voucher label, but denom trace ${voucherHash} could not be resolved. Refusing to treat it as a native Cardano asset.`,
  );
}

export function assertUniqueTraceRegistryEntries(
  entries: readonly TraceRegistryEntry[],
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalizedHash = entry.voucher_hash.toLowerCase();
    if (seen.has(normalizedHash)) {
      throw new Error(
        `Duplicate trace-registry entries detected for voucher hash ${normalizedHash}`,
      );
    }
    seen.add(normalizedHash);
  }
}

function getKupmiosEndpoints(kupmiosUrl: string) {
  const [kupoUrl, ogmiosUrl] = kupmiosUrl
    .split(",")
    .map((value) => value.trim());
  if (!kupoUrl || !ogmiosUrl) {
    throw new Error(
      'kupmiosUrl must be set to "<kupo-url>,<ogmios-url>" for on-chain trace-registry lookups.',
    );
  }

  return { kupoUrl, ogmiosUrl };
}

function isDemeterHost(hostname: string): boolean {
  return hostname.endsWith(".dmtr.host") || hostname.endsWith(".demeter.run");
}

function normalizeDemeterOgmiosEndpoint(
  ogmiosUrl: string,
  headers?: KupmiosAuthHeaders,
): { ogmiosUrl: string; headers?: KupmiosAuthHeaders } {
  const apiKey = headers?.ogmiosHeader?.["dmtr-api-key"]?.trim();
  if (!apiKey) {
    return { ogmiosUrl, headers };
  }

  try {
    const parsed = new URL(ogmiosUrl);
    if (!isDemeterHost(parsed.hostname)) {
      return { ogmiosUrl, headers };
    }
    if (!parsed.host.startsWith(`${apiKey}.`)) {
      parsed.host = `${apiKey}.${parsed.host}`;
    }
    const nextHeaders: KupmiosAuthHeaders = { ...headers };
    // Demeter Ogmios uses host-based auth for HTTP JSON-RPC; the same key as a
    // header can leave POST requests waiting until the provider timeout.
    delete nextHeaders.ogmiosHeader;
    return {
      ogmiosUrl: parsed.toString().replace(/\/$/, ""),
      headers:
        nextHeaders.kupoHeader || nextHeaders.ogmiosHeader
          ? nextHeaders
          : undefined,
    };
  } catch {
    return { ogmiosUrl, headers };
  }
}

function describeFetchFailure(error: unknown): string {
  const cause =
    error instanceof Error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;
  const causeRecord =
    typeof cause === "object" && cause !== null
      ? (cause as Record<string, unknown>)
      : undefined;
  const code =
    typeof causeRecord?.code === "string" ? causeRecord.code : undefined;
  const address =
    typeof causeRecord?.address === "string" ? causeRecord.address : undefined;
  const port =
    typeof causeRecord?.port === "string" ||
    typeof causeRecord?.port === "number"
      ? String(causeRecord.port)
      : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;

  if (code && address && port) {
    return `${code} while connecting to ${address}:${port}`;
  }

  if (code) {
    return causeMessage ? `${code}: ${causeMessage}` : code;
  }

  if (causeMessage) {
    return causeMessage;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
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
      bridgeManifestPromise = (async () => {
        let response: Response;
        try {
          response = await fetchImpl(config.bridgeManifestUrl);
        } catch (error) {
          throw new Error(
            `Failed to load Cardano bridge manifest from ${config.bridgeManifestUrl}: ${describeFetchFailure(error)}`,
            { cause: error },
          );
        }

        if (!response.ok) {
          throw new Error(
            `Failed to load Cardano bridge manifest from ${config.bridgeManifestUrl} (${response.status})`,
          );
        }
        return response.json() as Promise<BridgeManifest>;
      })();
    }

    return bridgeManifestPromise;
  }

  async function getKupmiosProvider() {
    if (!kupmiosProviderPromise) {
      kupmiosProviderPromise = (async () => {
        const Lucid = await (eval(
          `import('@lucid-evolution/lucid')`,
        ) as Promise<LucidModule>);
        const { kupoUrl, ogmiosUrl: rawOgmiosUrl } = getKupmiosEndpoints(
          config.kupmiosUrl,
        );
        const { ogmiosUrl, headers } = normalizeDemeterOgmiosEndpoint(
          rawOgmiosUrl,
          config.kupmiosHeaders,
        );

        return {
          Lucid,
          provider: new Lucid.Kupmios(
            kupoUrl,
            ogmiosUrl,
            headers,
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
        "Unable to load the canonical Cardano trace-registry directory UTxO",
      );
    }

    const decoded = decodeTraceRegistryDatum(directoryUtxo.datum, Lucid);
    if (!("Directory" in decoded)) {
      throw new Error(
        "Trace-registry directory witness does not carry a directory datum",
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
    const tokenNames = [
      bucket.active_shard_name,
      ...bucket.archived_shard_names,
    ];
    const uniqueTokenNames = Array.from(new Set(tokenNames));

    return Promise.all(
      uniqueTokenNames.map(async (tokenName) => {
        const unit =
          `${context.registry.shard_policy_id}${tokenName}`.toLowerCase();
        const shardUtxo = await context.provider.getUtxoByUnit(unit);
        if (!shardUtxo?.datum) {
          throw new Error(
            `Trace-registry shard ${unit} is missing inline datum`,
          );
        }

        const decoded = decodeTraceRegistryDatum(
          shardUtxo.datum,
          context.Lucid,
        );
        if (!("Shard" in decoded)) {
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

    assertUniqueTraceRegistryEntries(matches);

    return matches[0] ?? null;
  }

  async function resolveVoucherMetadata(
    voucherPolicyId: string,
    voucherDenomHash: string,
    fullDenom: string,
  ): Promise<Cip68VoucherMetadata | null> {
    const context = await loadRegistryContext();
    const referenceAssetId = deriveVoucherReferenceAssetId(
      voucherPolicyId,
      voucherDenomHash,
    );
    const referenceUtxo =
      await context.provider.getUtxoByUnit(referenceAssetId);

    if (!referenceUtxo?.datum) {
      return null;
    }

    try {
      const trace = splitFullDenomTrace(fullDenom);
      return decodeVerifiedVoucherCip68MetadataDatum(
        referenceUtxo.datum,
        {
          path: trace.path,
          baseDenom: trace.baseDenom,
          fullDenom,
          voucherTokenName:
            buildVoucherUserTokenNameFromDenomHash(voucherDenomHash),
          voucherPolicyId,
          ibcDenomHash: buildIbcDenomHashFromFullDenom(fullDenom),
        },
        context.Lucid,
      );
    } catch {
      return null;
    }
  }

  async function findAllVoucherEntries(): Promise<TraceRegistryEntry[]> {
    const context = await loadRegistryContext();
    const shardsPerBucket = await Promise.all(
      context.directory.buckets.map(async (bucket) =>
        loadBucketShards(context, Number(bucket.bucket_index), bucket),
      ),
    );

    assertUniqueTraceRegistryEntries(
      shardsPerBucket.flatMap((bucketShards) =>
        bucketShards.flatMap((shard) => shard.datum.entries),
      ),
    );

    const entries: TraceRegistryEntry[] = [];

    for (const bucketShards of shardsPerBucket) {
      for (const shard of bucketShards) {
        for (const entry of shard.datum.entries) {
          const normalizedHash = entry.voucher_hash.toLowerCase();
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
    const voucherPolicy = findVoucherPolicy(manifest, parsed.policyId);

    if (!voucherPolicy) {
      return buildNativeAssetTrace(
        parsed.assetId,
        parsed.assetId,
        parsed.assetId,
      );
    }

    const parsedVoucherAssetName = parseVoucherAssetName(parsed.assetNameHex);
    if (!parsedVoucherAssetName) {
      return buildNativeAssetTrace(
        parsed.assetId,
        parsed.assetId,
        parsed.assetId,
      );
    }

    const entry = await findVoucherEntryByHash(
      parsedVoucherAssetName.voucherDenomHash,
    );
    if (!entry) {
      throw unresolvedVoucherTraceError(
        parsed.assetId,
        parsedVoucherAssetName.voucherDenomHash,
      );
    }

    const metadata = await resolveVoucherMetadata(
      voucherPolicy.policyId,
      entry.voucher_hash,
      entry.full_denom,
    );
    return await mapVoucherTrace(
      parsed.assetId,
      entry.voucher_hash,
      entry.full_denom,
      metadata,
      voucherPolicy,
    );
  }

  async function lookupIbcDenomTrace(
    ibcDenomHash: string,
  ): Promise<CardanoAssetDenomTrace | null> {
    const normalizedHash = ibcDenomHash.trim().toLowerCase();
    if (!normalizedHash) {
      throw new Error("IBC denom hash cannot be empty");
    }

    const manifest = await getBridgeManifest();
    const activeVoucherPolicy = normalizeVoucherPolicyRegistry(manifest).active;
    const entries = await findAllVoucherEntries();
    let match: TraceRegistryEntry | null = null;
    for (const entry of entries) {
      if (buildIbcDenomHashFromFullDenom(entry.full_denom) === normalizedHash) {
        match = entry;
        break;
      }
    }

    if (!match) {
      return null;
    }

    const metadata = await resolveVoucherMetadata(
      activeVoucherPolicy.policyId,
      match.voucher_hash,
      match.full_denom,
    );
    return mapVoucherTrace(
      `${activeVoucherPolicy.policyId}${buildVoucherUserTokenNameFromDenomHash(match.voucher_hash)}`.toLowerCase(),
      match.voucher_hash,
      match.full_denom,
      metadata,
      activeVoucherPolicy,
    );
  }

  async function listCardanoIbcAssets(): Promise<CardanoAssetDenomTrace[]> {
    const manifest = await getBridgeManifest();
    const voucherPolicies = listOperationalVoucherPolicies(manifest);
    const entries = await findAllVoucherEntries();

    const traces = await Promise.all(
      entries.flatMap((entry) =>
        voucherPolicies.map(async (voucherPolicy) =>
          mapVoucherTrace(
            `${voucherPolicy.policyId}${buildVoucherUserTokenNameFromDenomHash(entry.voucher_hash)}`.toLowerCase(),
            entry.voucher_hash,
            entry.full_denom,
            await resolveVoucherMetadata(
              voucherPolicy.policyId,
              entry.voucher_hash,
              entry.full_denom,
            ),
            voucherPolicy,
          ),
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
    lookupIbcDenomTrace,
    listCardanoIbcAssets,
  };
}
