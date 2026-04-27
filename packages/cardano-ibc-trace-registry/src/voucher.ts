import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha256';

export const CIP67_REFERENCE_NFT_LABEL_HEX = '000643b0';
export const CIP67_FT_LABEL_HEX = '0014df10';
export const VOUCHER_DENOM_HASH_HEX_LENGTH = 56;
export const LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH = 64;
export const VOUCHER_METADATA_VERSION = 1;

const CHANNEL_ID_SEGMENT_REGEX = /^channel-\d+$/;

export type VoucherLabelKind = 'ft' | 'reference_nft';

export type ParsedVoucherAssetName = {
  kind: VoucherLabelKind;
  voucherDenomHash: string;
};

export type DenomTraceParts = {
  path: string;
  baseDenom: string;
};

export type VoucherPresentation = {
  displayName: string;
  displaySymbol: string;
  displayDescription: string;
};

export type Cip68VoucherMetadata = {
  name: string;
  description: string;
  ticker: string;
  decimals?: number;
  url?: string;
  logo?: string;
  version: number;
  extra: {
    path: string;
    baseDenom: string;
    fullDenom: string;
    voucherTokenName: string;
    voucherPolicyId: string;
    ibcDenomHash: string;
    traceVersion: number;
  };
};

export type BuildVoucherMetadataParams = {
  path: string;
  baseDenom: string;
  fullDenom: string;
  voucherTokenName: string;
  voucherPolicyId: string;
  ibcDenomHash: string;
};

export type LucidDataModule = {
  Constr: new (index: number, fields: unknown[]) => unknown;
  Data: {
    from(encodedDatum: string): unknown;
    to(value: unknown, schema?: unknown, options?: unknown): string;
  };
};

export function buildVoucherDenomHashFromFullDenom(fullDenom: string): string {
  return Buffer.from(
    blake2b(Buffer.from(fullDenom, 'utf8'), { dkLen: 28 }),
  ).toString('hex').toLowerCase();
}

export function buildIbcDenomHashFromFullDenom(fullDenom: string): string {
  return Buffer.from(sha256(Buffer.from(fullDenom, 'utf8')))
    .toString('hex')
    .toLowerCase();
}

export function buildVoucherUserTokenNameFromDenomHash(voucherDenomHash: string): string {
  return `${CIP67_FT_LABEL_HEX}${normalizeVoucherDenomHash(voucherDenomHash)}`;
}

export function buildVoucherReferenceTokenNameFromDenomHash(
  voucherDenomHash: string,
): string {
  return `${CIP67_REFERENCE_NFT_LABEL_HEX}${normalizeVoucherDenomHash(voucherDenomHash)}`;
}

export function buildVoucherUserTokenNameFromFullDenom(fullDenom: string): string {
  return buildVoucherUserTokenNameFromDenomHash(
    buildVoucherDenomHashFromFullDenom(fullDenom),
  );
}

export function buildVoucherReferenceTokenNameFromFullDenom(
  fullDenom: string,
): string {
  return buildVoucherReferenceTokenNameFromDenomHash(
    buildVoucherDenomHashFromFullDenom(fullDenom),
  );
}

export function buildVoucherAssetId(policyId: string, tokenName: string): string {
  return `${policyId.toLowerCase()}${tokenName.toLowerCase()}`;
}

export function deriveVoucherReferenceAssetId(
  policyId: string,
  voucherDenomHash: string,
): string {
  return buildVoucherAssetId(
    policyId,
    buildVoucherReferenceTokenNameFromDenomHash(voucherDenomHash),
  );
}

export function parseVoucherAssetName(
  assetNameHex: string,
): ParsedVoucherAssetName | null {
  const normalized = assetNameHex.trim().toLowerCase();
  if (normalized.length !== LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH) {
    return null;
  }

  if (!/^[0-9a-f]+$/i.test(normalized)) {
    return null;
  }

  const label = normalized.slice(0, 8);
  const voucherDenomHash = normalized.slice(8);
  if (label === CIP67_FT_LABEL_HEX) {
    return { kind: 'ft', voucherDenomHash };
  }
  if (label === CIP67_REFERENCE_NFT_LABEL_HEX) {
    return { kind: 'reference_nft', voucherDenomHash };
  }
  return null;
}

export function expectVoucherAssetName(
  assetNameHex: string,
): ParsedVoucherAssetName {
  const parsed = parseVoucherAssetName(assetNameHex);
  if (!parsed) {
    throw new Error(
      `Invalid CIP-67 voucher asset name: expected 32-byte (333) or (100) labeled asset name, received ${assetNameHex}`,
    );
  }
  return parsed;
}

export function isVoucherAssetName(assetNameHex: string): boolean {
  return parseVoucherAssetName(assetNameHex) !== null;
}

export function isVoucherUserTokenName(assetNameHex: string): boolean {
  return parseVoucherAssetName(assetNameHex)?.kind === 'ft';
}

export function isVoucherReferenceTokenName(assetNameHex: string): boolean {
  return parseVoucherAssetName(assetNameHex)?.kind === 'reference_nft';
}

export function splitFullDenomTrace(fullDenomPath: string): DenomTraceParts {
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

    if (!looksLikePortId(maybePortId) || !CHANNEL_ID_SEGMENT_REGEX.test(maybeChannelId)) {
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

export function deriveVoucherPresentation(
  fullDenom: string,
  baseDenom: string,
): VoucherPresentation {
  const canonicalLabel = deriveVoucherCanonicalLabel(baseDenom);
  return {
    displayName: canonicalLabel,
    displaySymbol: canonicalLabel,
    displayDescription: `IBC voucher for ${fullDenom}`,
  };
}

export function deriveVoucherCanonicalLabel(baseDenom: string): string {
  const trimmedBaseDenom = baseDenom.trim();
  if (!trimmedBaseDenom) {
    return 'IBC';
  }

  return trimmedBaseDenom.split('/').filter(Boolean).at(-1) ?? trimmedBaseDenom;
}

export function buildVoucherCip68Metadata(
  params: BuildVoucherMetadataParams,
): Cip68VoucherMetadata {
  const presentation = deriveVoucherPresentation(
    params.fullDenom,
    params.baseDenom,
  );

  return {
    name: presentation.displayName,
    description: presentation.displayDescription,
    ticker: presentation.displaySymbol,
    version: VOUCHER_METADATA_VERSION,
    extra: {
      path: params.path,
      baseDenom: params.baseDenom,
      fullDenom: params.fullDenom,
      voucherTokenName: params.voucherTokenName,
      voucherPolicyId: params.voucherPolicyId,
      ibcDenomHash: params.ibcDenomHash,
      traceVersion: VOUCHER_METADATA_VERSION,
    },
  };
}

export function encodeVoucherCip68MetadataDatum(
  metadata: Cip68VoucherMetadata,
  Lucid: LucidDataModule,
): string {
  const metadataMap = new Map<unknown, unknown>([
    [toDataKey('name'), toDataBytes(metadata.name)],
    [toDataKey('description'), toDataBytes(metadata.description)],
  ]);
  if (metadata.ticker) {
    metadataMap.set(toDataKey('ticker'), toDataBytes(metadata.ticker));
  }
  if (typeof metadata.decimals === 'number') {
    metadataMap.set(toDataKey('decimals'), BigInt(metadata.decimals));
  }
  if (metadata.url) {
    metadataMap.set(toDataKey('url'), toDataBytes(metadata.url));
  }
  if (metadata.logo) {
    metadataMap.set(toDataKey('logo'), toDataBytes(metadata.logo));
  }

  const extraMap = new Map<unknown, unknown>([
    [toDataKey('path'), toDataBytes(metadata.extra.path)],
    [toDataKey('baseDenom'), toDataBytes(metadata.extra.baseDenom)],
    [toDataKey('fullDenom'), toDataBytes(metadata.extra.fullDenom)],
    [
      toDataKey('voucherTokenName'),
      toDataBytes(metadata.extra.voucherTokenName),
    ],
    [
      toDataKey('voucherPolicyId'),
      toDataBytes(metadata.extra.voucherPolicyId),
    ],
    [toDataKey('ibcDenomHash'), toDataBytes(metadata.extra.ibcDenomHash)],
    [toDataKey('traceVersion'), BigInt(metadata.extra.traceVersion)],
  ]);

  return Lucid.Data.to(
    new Lucid.Constr(0, [metadataMap, BigInt(metadata.version), extraMap]),
    undefined,
    { canonical: true },
  );
}

export function decodeVoucherCip68MetadataDatum(
  encodedDatum: string,
  Lucid: LucidDataModule,
): Cip68VoucherMetadata {
  const decoded = Lucid.Data.from(encodedDatum);
  const outer = expectMetadataConstr(decoded, 0);
  const [metadataRaw, versionRaw, extraRaw] = outer.fields;
  const metadataMap = toEntriesMap(metadataRaw);
  const extraMap = toEntriesMap(extraRaw);

  if (typeof versionRaw !== 'bigint') {
    throw new Error('Invalid CIP-68 voucher metadata version');
  }

  return {
    name: decodeRequiredBytes(metadataMap, 'name'),
    description: decodeRequiredBytes(metadataMap, 'description'),
    ticker: decodeRequiredBytes(metadataMap, 'ticker'),
    decimals: decodeOptionalInteger(metadataMap, 'decimals'),
    url: decodeOptionalUri(metadataMap, 'url'),
    logo: decodeOptionalUri(metadataMap, 'logo'),
    version: Number(versionRaw),
    extra: {
      path: decodeRequiredBytes(extraMap, 'path'),
      baseDenom: decodeRequiredBytes(extraMap, 'baseDenom'),
      fullDenom: decodeRequiredBytes(extraMap, 'fullDenom'),
      voucherTokenName: decodeRequiredBytes(extraMap, 'voucherTokenName'),
      voucherPolicyId: decodeRequiredBytes(extraMap, 'voucherPolicyId'),
      ibcDenomHash: decodeRequiredBytes(extraMap, 'ibcDenomHash'),
      traceVersion: decodeRequiredInteger(extraMap, 'traceVersion'),
    },
  };
}

export function decodeVerifiedVoucherCip68MetadataDatum(
  encodedDatum: string,
  params: BuildVoucherMetadataParams,
  Lucid: LucidDataModule,
): Cip68VoucherMetadata {
  const expected = buildVoucherCip68Metadata(params);
  const expectedEncodedDatum = encodeVoucherCip68MetadataDatum(expected, Lucid);

  if (expectedEncodedDatum !== encodedDatum) {
    throw new Error(
      'Voucher metadata datum does not match the canonical voucher metadata',
    );
  }

  return expected;
}

function normalizeVoucherDenomHash(voucherDenomHash: string): string {
  const normalized = voucherDenomHash.trim().toLowerCase();
  if (
    !new RegExp(`^[0-9a-f]{${VOUCHER_DENOM_HASH_HEX_LENGTH}}$`, 'i').test(
      normalized,
    )
  ) {
    throw new Error(
      `Invalid voucher denom hash: expected ${VOUCHER_DENOM_HASH_HEX_LENGTH} hex characters, received ${voucherDenomHash}`,
    );
  }
  return normalized;
}

function looksLikePortId(segment: string): boolean {
  return segment.length > 0;
}

function expectMetadataConstr(
  value: unknown,
  expectedIndex?: number,
): { index: number; fields: unknown[] } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('index' in value) ||
    !('fields' in value)
  ) {
    throw new Error('Expected CIP-68 voucher metadata constructor data');
  }

  const constr = value as { index: number; fields: unknown[] };
  if (expectedIndex !== undefined && constr.index !== expectedIndex) {
    throw new Error(
      `Unexpected CIP-68 voucher metadata constructor index ${constr.index}, expected ${expectedIndex}`,
    );
  }
  return constr;
}

function toDataKey(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

function toDataBytes(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

function toEntriesMap(value: unknown): Map<string, unknown> {
  const entries = value instanceof Map ? [...value.entries()] : value;
  if (!Array.isArray(entries)) {
    throw new Error('Expected CIP-68 voucher metadata map');
  }

  const normalized = new Map<string, unknown>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error('Invalid CIP-68 voucher metadata map entry');
    }
    const [key, item] = entry;
    if (typeof key !== 'string') {
      throw new Error('Invalid CIP-68 voucher metadata map key');
    }
    normalized.set(fromHexUtf8(key), item);
  }
  return normalized;
}

function decodeRequiredBytes(map: Map<string, unknown>, key: string): string {
  const value = map.get(key);
  if (typeof value !== 'string') {
    throw new Error(`Missing required CIP-68 voucher metadata field "${key}"`);
  }
  return fromHexUtf8(value);
}

function decodeRequiredInteger(map: Map<string, unknown>, key: string): number {
  const value = map.get(key);
  if (typeof value !== 'bigint') {
    throw new Error(
      `Missing required CIP-68 voucher metadata integer "${key}"`,
    );
  }
  return Number(value);
}

function decodeOptionalInteger(
  map: Map<string, unknown>,
  key: string,
): number | undefined {
  const value = map.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'bigint') {
    throw new Error(`Invalid CIP-68 voucher metadata integer "${key}"`);
  }
  return Number(value);
}

function decodeOptionalUri(
  map: Map<string, unknown>,
  key: string,
): string | undefined {
  const value = map.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return fromHexUtf8(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part !== 'string') {
          throw new Error(
            `Invalid CIP-68 voucher metadata URI part for "${key}"`,
          );
        }
        return fromHexUtf8(part);
      })
      .join('');
  }
  throw new Error(`Invalid CIP-68 voucher metadata URI "${key}"`);
}

function fromHexUtf8(value: string): string {
  return Buffer.from(value, 'hex').toString('utf8');
}
