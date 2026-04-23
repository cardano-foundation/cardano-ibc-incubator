import { Constr } from '@lucid-evolution/lucid';

import { deriveVoucherPresentation } from './voucher-presentation';
import { VoucherMetadataRegistryEntry } from './voucher-metadata-registry';

export type Cip68VoucherMetadata = {
  name: string;
  description: string;
  ticker?: string;
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
    sourceChain?: string;
    sourceChannel?: string;
    port?: string;
    traceVersion: number;
  };
};

type LucidModule = typeof import('@lucid-evolution/lucid');

export type BuildVoucherMetadataParams = {
  path: string;
  baseDenom: string;
  fullDenom: string;
  voucherTokenName: string;
  voucherPolicyId: string;
  ibcDenomHash: string;
  curated?: VoucherMetadataRegistryEntry;
};

const VERSION = 1;

export function buildVoucherCip68Metadata(
  params: BuildVoucherMetadataParams,
): Cip68VoucherMetadata {
  const presentation = deriveVoucherPresentation(params.fullDenom, params.baseDenom);
  const curated = params.curated;

  return {
    name: curated?.name ?? presentation.displayName,
    description:
      curated?.description ?? presentation.displayDescription,
    ticker: curated?.ticker ?? presentation.displaySymbol,
    ...(typeof curated?.decimals === 'number'
      ? { decimals: curated.decimals }
      : {}),
    ...(curated?.url ? { url: curated.url } : {}),
    ...(curated?.logo ? { logo: curated.logo } : {}),
    version: VERSION,
    extra: {
      path: params.path,
      baseDenom: params.baseDenom,
      fullDenom: params.fullDenom,
      voucherTokenName: params.voucherTokenName,
      voucherPolicyId: params.voucherPolicyId,
      ibcDenomHash: params.ibcDenomHash,
      ...(curated?.sourceChain ? { sourceChain: curated.sourceChain } : {}),
      ...(curated?.sourceChannel
        ? { sourceChannel: curated.sourceChannel }
        : {}),
      ...(curated?.port ? { port: curated.port } : {}),
      traceVersion: VERSION,
    },
  };
}

export function encodeVoucherCip68MetadataDatum(
  metadata: Cip68VoucherMetadata,
  Lucid: LucidModule,
): string {
  const { Data } = Lucid;

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
  if (metadata.extra.sourceChain) {
    extraMap.set(toDataKey('sourceChain'), toDataBytes(metadata.extra.sourceChain));
  }
  if (metadata.extra.sourceChannel) {
    extraMap.set(
      toDataKey('sourceChannel'),
      toDataBytes(metadata.extra.sourceChannel),
    );
  }
  if (metadata.extra.port) {
    extraMap.set(toDataKey('port'), toDataBytes(metadata.extra.port));
  }

  return Data.to(
    new Constr(0, [metadataMap, BigInt(metadata.version), extraMap]),
    undefined,
    { canonical: true },
  );
}

export function decodeVoucherCip68MetadataDatum(
  encodedDatum: string,
  Lucid: LucidModule,
): Cip68VoucherMetadata {
  const { Data } = Lucid;
  const decoded = Data.from(encodedDatum);
  const outer = expectConstr(decoded, 0);
  const [metadataRaw, versionRaw, extraRaw] = outer.fields;
  const metadataMap = toEntriesMap(metadataRaw);
  const extraMap = toEntriesMap(extraRaw);

  if (typeof versionRaw !== 'bigint') {
    throw new Error('Invalid CIP-68 voucher metadata version');
  }

  return {
    name: decodeRequiredBytes(metadataMap, 'name'),
    description: decodeRequiredBytes(metadataMap, 'description'),
    ticker: decodeOptionalBytes(metadataMap, 'ticker'),
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
      sourceChain: decodeOptionalBytes(extraMap, 'sourceChain'),
      sourceChannel: decodeOptionalBytes(extraMap, 'sourceChannel'),
      port: decodeOptionalBytes(extraMap, 'port'),
      traceVersion: decodeRequiredInteger(extraMap, 'traceVersion'),
    },
  };
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

function decodeRequiredBytes(
  map: Map<string, unknown>,
  key: string,
): string {
  const value = map.get(key);
  if (typeof value !== 'string') {
    throw new Error(`Missing required CIP-68 voucher metadata field "${key}"`);
  }
  return fromHexUtf8(value);
}

function decodeOptionalBytes(
  map: Map<string, unknown>,
  key: string,
): string | undefined {
  const value = map.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid CIP-68 voucher metadata field "${key}"`);
  }
  return fromHexUtf8(value);
}

function decodeRequiredInteger(
  map: Map<string, unknown>,
  key: string,
): number {
  const value = map.get(key);
  if (typeof value !== 'bigint') {
    throw new Error(`Missing required CIP-68 voucher metadata integer "${key}"`);
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
          throw new Error(`Invalid CIP-68 voucher metadata URI part for "${key}"`);
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
