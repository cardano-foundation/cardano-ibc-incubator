import { ConfigService } from '@nestjs/config';
import { querySystemStart, queryTransactionInclusionBlockHeight } from '../../helpers/time';
import { Network } from '@lucid-evolution/lucid';
import { applyDoubleCborEncoding } from '@lucid-evolution/utils';
import { writeFileSync } from 'fs';
import {
  installManagedCardanoAuthFetch,
  redactManagedEndpoint,
  resolveManagedKupmiosHeaders,
  resolveManagedKupoEndpoint,
  resolveManagedOgmiosHttpEndpoint,
} from '../../helpers/managed-cardano-endpoints';
import type { KupoHistoricalOutput, KupoHistoryPoint, KupoHistoryProvider } from '../kupo/kupo.types';
export const LUCID_CLIENT = 'LUCID_CLIENT';
export const LUCID_IMPORTER = 'LUCID_IMPORTER';

const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;
const OGMIOS_PROTOCOL_PARAMETERS_REQUEST_TIMEOUT_MS = 10_000;
const PROTOCOL_PARAMETERS_MAX_ATTEMPTS = 20;
const PROTOCOL_PARAMETERS_BASE_DELAY_MS = 1000;
const PROTOCOL_PARAMETERS_MAX_DELAY_MS = 5000;
// Respect provider rate limits without allowing one response to stall startup indefinitely.
const PROTOCOL_PARAMETERS_RETRY_AFTER_MAX_MS = 60_000;
const RUNTIME_PROVIDER_MAX_ATTEMPTS = 10;
const RUNTIME_PROVIDER_BASE_DELAY_MS = 500;
const RUNTIME_PROVIDER_MAX_DELAY_MS = 5000;
const TRANSIENT_STARTUP_ERROR_MARKERS = [
  'timeoutexception',
  'timeout',
  'timed out',
  'etimedout',
  'econnreset',
  'econnrefused',
  'requesterror',
  'request error',
  'transport error',
  'kupmioserror',
  'socket hang up',
  'network error',
  'fetch failed',
  'unauthorized',
  'statuscode: non 2xx status code : unauthorized',
  '401',
];
const TRANSIENT_RUNTIME_PROVIDER_ERROR_MARKERS = [
  'timeoutexception',
  'timeout',
  'timed out',
  'etimedout',
  'econnreset',
  'econnrefused',
  'requesterror',
  'request error',
  'transport error',
  'socket hang up',
  'network error',
  'fetch failed',
  'unauthorized',
  'statuscode: non 2xx status code : unauthorized',
  '401',
  '500 post',
  '502 post',
  '503 post',
  '504 post',
];
const NON_RETRYABLE_RUNTIME_PROVIDER_ERROR_MARKERS = [
  '(400 post',
  'http 400',
  '"code":3010',
  '"code":3012',
  'some scripts of the transactions terminated',
  'failed to evaluate to a positive outcome',
  'validationerror',
  'validator returned false',
];

function toSafeCostModelInteger(value: unknown): number {
  let parsedValue: number;

  if (typeof value === 'number') {
    parsedValue = value;
  } else if (typeof value === 'bigint') {
    parsedValue = Number(value);
  } else if (typeof value === 'string') {
    parsedValue = Number(value);
  } else {
    throw new Error(`Unsupported cost model value type: ${typeof value}`);
  }

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Invalid non-finite cost model value: ${String(value)}`);
  }

  if (!Number.isInteger(parsedValue)) {
    parsedValue = Math.trunc(parsedValue);
  }

  if (!Number.isSafeInteger(parsedValue)) {
    return parsedValue > 0 ? MAX_SAFE_COST_MODEL_VALUE : -MAX_SAFE_COST_MODEL_VALUE;
  }

  return parsedValue;
}

function costModelRecordEntries(values: Record<string, unknown>): Array<[string, unknown]> {
  const entries = Object.entries(values);
  const hasOnlyNumericIndexes = entries.every(([index]) => /^\d+$/.test(index));
  return hasOnlyNumericIndexes ? entries.sort(([left], [right]) => Number(left) - Number(right)) : entries;
}

function toCostModelArray(values: unknown[] | Record<string, unknown> | undefined): number[] {
  if (!values) {
    return [];
  }

  const rawValues = Array.isArray(values) ? values : costModelRecordEntries(values).map(([, value]) => value);
  return rawValues.map((value) => toSafeCostModelInteger(value));
}

function mapOgmiosCostModels(plutusCostModels: unknown): Record<string, number[]> {
  // Lucid's cost-model constructor iterates all three language keys
  // unconditionally. Keep unavailable models empty so the object has the
  // shape Lucid requires without copying another language's parameters.
  const mappedModels: Record<string, number[]> = {
    PlutusV1: [],
    PlutusV2: [],
    PlutusV3: [],
  };
  if (
    plutusCostModels !== undefined &&
    plutusCostModels !== null &&
    (typeof plutusCostModels !== 'object' || Array.isArray(plutusCostModels))
  ) {
    throw new Error('Ogmios protocol parameters response contains invalid plutusCostModels');
  }

  const rawModels = (plutusCostModels ?? {}) as Record<string, unknown>;
  const modelNames = [
    ['plutus:v1', 'PlutusV1'],
    ['plutus:v2', 'PlutusV2'],
    ['plutus:v3', 'PlutusV3'],
  ] as const;

  for (const [ogmiosName, lucidName] of modelNames) {
    const rawModel = rawModels[ogmiosName];
    if (rawModel === undefined || rawModel === null) {
      continue;
    }
    if (!Array.isArray(rawModel) && typeof rawModel !== 'object') {
      throw new Error(`Ogmios protocol parameters response contains invalid ${ogmiosName} cost model`);
    }
    mappedModels[lucidName] = toCostModelArray(rawModel as unknown[] | Record<string, unknown>);
  }

  for (const [ogmiosName, lucidName] of modelNames.slice(0, 2)) {
    if (mappedModels[lucidName].length === 0) {
      throw new Error(`Ogmios protocol parameters response is missing a non-empty ${ogmiosName} cost model`);
    }
  }

  return mappedModels;
}

function sanitizeProtocolParameters(protocolParameters: any): any {
  if (!protocolParameters?.costModels) {
    return protocolParameters;
  }

  const sanitizedCostModels: Record<string, number[]> = {};

  for (const [version, model] of Object.entries(protocolParameters.costModels as Record<string, unknown>)) {
    if (Array.isArray(model) || (typeof model === 'object' && model !== null)) {
      sanitizedCostModels[version] = toCostModelArray(model as unknown[] | Record<string, unknown>);
    }
  }

  return {
    ...protocolParameters,
    costModels: sanitizedCostModels,
  };
}

function parseOgmiosRatio(value: unknown, label: string): number {
  if (Array.isArray(value) && value.length >= 2) {
    const numerator = Number(value[0]);
    const denominator = Number(value[1]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  if (typeof value === 'string') {
    const [rawNumerator, rawDenominator] = value.includes('/') ? value.split('/') : [value, '1'];
    const numerator = Number(rawNumerator);
    const denominator = Number(rawDenominator);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const numerator = Number(record.numerator ?? record.num ?? record[0]);
    const denominator = Number(record.denominator ?? record.den ?? record[1]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Invalid Ogmios ratio for ${label}: ${JSON.stringify(value)}`);
}

function parseRetryAfterMs(headers: Headers | undefined): number | undefined {
  const retryAfter = headers?.get?.('retry-after')?.trim();
  if (!retryAfter) {
    return undefined;
  }

  if (/^\d+$/.test(retryAfter)) {
    return Number(retryAfter) * 1_000;
  }

  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) {
    return undefined;
  }
  return Math.max(0, retryAt - Date.now());
}

function lovelaceValue(value: any, fallback: bigint = 0n): bigint {
  const raw = value?.ada?.lovelace ?? value?.lovelace ?? value;
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  return BigInt(raw);
}

export function mapOgmiosProtocolParameters(result: any): any {
  if (!result) {
    throw new Error('Ogmios protocol parameters response is missing result');
  }

  const coinsPerUtxoByte = result.utxoCostPerByte ?? result.minUtxoDepositCoefficient;
  if (coinsPerUtxoByte === undefined || coinsPerUtxoByte === null) {
    throw new Error('Ogmios protocol parameters response is missing utxoCostPerByte/minUtxoDepositCoefficient');
  }
  const costModels = mapOgmiosCostModels(result.plutusCostModels);

  return {
    minFeeA: result.minFeeCoefficient,
    minFeeB: Number(lovelaceValue(result.minFeeConstant)),
    maxTxSize: result.maxTransactionSize?.bytes,
    maxValSize: result.maxValueSize?.bytes,
    keyDeposit: lovelaceValue(result.stakeCredentialDeposit),
    poolDeposit: lovelaceValue(result.stakePoolDeposit),
    drepDeposit: lovelaceValue(result.delegateRepresentativeDeposit),
    govActionDeposit: lovelaceValue(result.governanceActionDeposit),
    priceMem: parseOgmiosRatio(result.scriptExecutionPrices?.memory, 'scriptExecutionPrices.memory'),
    priceStep: parseOgmiosRatio(result.scriptExecutionPrices?.cpu, 'scriptExecutionPrices.cpu'),
    maxTxExMem: BigInt(result.maxExecutionUnitsPerTransaction?.memory ?? 0),
    maxTxExSteps: BigInt(result.maxExecutionUnitsPerTransaction?.cpu ?? 0),
    coinsPerUtxoByte: BigInt(coinsPerUtxoByte),
    collateralPercentage: result.collateralPercentage,
    maxCollateralInputs: result.maxCollateralInputs,
    minFeeRefScriptCostPerByte: result.minFeeReferenceScripts?.base ?? 0,
    costModels,
  };
}

export async function queryProtocolParametersCompat(
  ogmiosEndpoint: string | undefined,
  headers?: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = OGMIOS_PROTOCOL_PARAMETERS_REQUEST_TIMEOUT_MS,
): Promise<any> {
  if (!ogmiosEndpoint) {
    throw new Error('OGMIOS_ENDPOINT is required to query protocol parameters');
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new Error(`Ogmios protocol parameters query timed out after ${timeoutMs}ms`);
  timeoutError.name = 'TimeoutError';

  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(ogmiosEndpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(headers ?? {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'queryLedgerState/protocolParameters',
            params: {},
            id: 'gateway-protocol-parameters',
          }),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const error = new Error(`Ogmios protocol parameters query failed with HTTP ${response.status}: ${text}`);
          Object.assign(error, {
            status: response.status,
            retryAfterMs: parseRetryAfterMs(response.headers),
          });
          throw error;
        }
        let payload: any;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          throw new Error('Ogmios protocol parameters query returned invalid JSON', { cause: error });
        }
        if (payload.error) {
          throw new Error(`Ogmios protocol parameters query failed: ${JSON.stringify(payload.error)}`);
        }
        return mapOgmiosProtocolParameters(payload.result);
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

function collectErrorSignals(error: unknown): string[] {
  const signals: string[] = [];
  const visited = new Set<unknown>();

  const pushSignal = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const normalized = value.trim();
    if (normalized.length > 0) {
      signals.push(normalized);
    }
  };

  const visit = (value: unknown, depth: number) => {
    if (value == null || depth > 8 || visited.has(value)) {
      return;
    }
    visited.add(value);

    if (typeof value === 'string') {
      pushSignal(value);
      return;
    }

    if (value instanceof Error) {
      pushSignal(value.name);
      pushSignal(value.message);
      pushSignal(String(value));
      if (typeof value.stack === 'string') {
        const firstStackLine = value.stack.split('\n')[0]?.trim();
        pushSignal(firstStackLine);
      }
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      pushSignal(record.message);
      pushSignal(record.name);
      pushSignal(record.code);
      pushSignal(record.reason);
      pushSignal(record.details);
      pushSignal(record.type);
      pushSignal(record.statusText);
      if (typeof record.status === 'number') {
        pushSignal(`HTTP ${record.status}`);
      }

      visit(record.cause, depth + 1);
      visit(record.error, depth + 1);
      visit(record.originalError, depth + 1);

      for (const key of Object.getOwnPropertyNames(value)) {
        if (['message', 'name', 'code', 'reason', 'details', 'type', 'statusText', 'stack'].includes(key)) {
          continue;
        }
        visit(record[key], depth + 1);
      }

      try {
        pushSignal(JSON.stringify(value));
      } catch {
        // Circular provider errors are common; individual fields above are enough.
      }
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      pushSignal(String(value));
    }
  };

  visit(error, 0);

  return signals;
}

function summarizeError(error: unknown): string {
  const uniqueSignals = Array.from(new Set(collectErrorSignals(error)));
  if (uniqueSignals.length === 0) {
    return 'Unknown error';
  }
  return uniqueSignals.slice(0, 4).join(' | ');
}

function hasTransientHttpStatus(normalizedSignals: string[]): boolean {
  return normalizedSignals.some((signal) => {
    const statusMatches = [
      ...signal.matchAll(/\bhttp\s+(\d{3})\b/g),
      ...signal.matchAll(/\bstatus(?:code)?\s*[:=]?\s*(\d{3})\b/g),
      ...signal.matchAll(/\((\d{3})\s+(?:get|post|put|delete|patch)\b/g),
    ];
    return statusMatches.some((match) => {
      const status = Number(match[1]);
      return status === 429 || (status >= 500 && status <= 599);
    });
  });
}

function isTransientStartupError(error: unknown): boolean {
  const normalizedSignals = collectErrorSignals(error).map((signal) => signal.toLowerCase());
  if (normalizedSignals.length === 0) {
    return false;
  }

  return (
    hasTransientHttpStatus(normalizedSignals) ||
    normalizedSignals.some((signal) => TRANSIENT_STARTUP_ERROR_MARKERS.some((marker) => signal.includes(marker)))
  );
}

export function isNonRetryableRuntimeProviderError(error: unknown): boolean {
  const normalized = collectErrorSignals(error)
    .map((signal) => signal.toLowerCase())
    .join('\n');
  if (normalized.length === 0) {
    return false;
  }

  return NON_RETRYABLE_RUNTIME_PROVIDER_ERROR_MARKERS.some((marker) => normalized.includes(marker));
}

function describeRuntimeProviderError(error: unknown): string {
  const signals = collectErrorSignals(error);
  const normalized = signals.join('\n');
  const lower = normalized.toLowerCase();
  const parts: string[] = [];

  const statusMatch =
    lower.match(/\((\d{3})\s+post/) ??
    lower.match(/\bhttp\s+(\d{3})\b/) ??
    lower.match(/\bstatus\s*(?:code)?[:=]?\s*(\d{3})\b/);
  if (statusMatch?.[1]) {
    parts.push(`status=${statusMatch[1]}`);
  }

  const codeMatches = [...normalized.matchAll(/"code"\s*:\s*(\d+)/gi)].map((match) => match[1]);
  const uniqueCodes = [...new Set(codeMatches)];
  if (uniqueCodes.length > 0) {
    parts.push(`ogmios_codes=${uniqueCodes.join(',')}`);
  }

  const validatorMatches = [
    ...normalized.matchAll(/"validator"\s*:\s*\{\s*"index"\s*:\s*(\d+)\s*,\s*"purpose"\s*:\s*"([^"]+)"/gi),
  ].map((match) => `${match[2]}[${match[1]}]`);
  const uniqueValidators = [...new Set(validatorMatches)];
  if (uniqueValidators.length > 0) {
    parts.push(`validators=${uniqueValidators.join(',')}`);
  }

  const validationErrorMatch = normalized.match(/"validationError"\s*:\s*"([^"]+)"/i);
  if (validationErrorMatch?.[1]) {
    parts.push(`validation_error=${validationErrorMatch[1].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()}`);
  }

  parts.push(`summary=${summarizeError(error)}`);
  return parts.join('; ');
}

export function isTransientRuntimeProviderError(error: unknown): boolean {
  if (isNonRetryableRuntimeProviderError(error)) {
    return false;
  }

  const normalizedSignals = collectErrorSignals(error).map((signal) => signal.toLowerCase());
  if (normalizedSignals.length === 0) {
    return false;
  }

  return (
    hasTransientHttpStatus(normalizedSignals) ||
    normalizedSignals.some((signal) =>
      TRANSIENT_RUNTIME_PROVIDER_ERROR_MARKERS.some((marker) => signal.includes(marker)),
    )
  );
}

function computeJitteredBackoffDelayMs(failedAttempt: number): number {
  const backoffDelay = PROTOCOL_PARAMETERS_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(Math.min(backoffDelay, PROTOCOL_PARAMETERS_MAX_DELAY_MS) * jitterMultiplier);
}

function computeProtocolParametersRetryDelayMs(failedAttempt: number, error: unknown): number {
  const backoffDelayMs = computeJitteredBackoffDelayMs(failedAttempt);
  if (typeof error !== 'object' || error === null) {
    return backoffDelayMs;
  }

  const retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    return backoffDelayMs;
  }

  return Math.max(backoffDelayMs, Math.min(retryAfterMs, PROTOCOL_PARAMETERS_RETRY_AFTER_MAX_MS));
}

function computeRuntimeProviderDelayMs(failedAttempt: number): number {
  const backoffDelay = RUNTIME_PROVIDER_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(Math.min(backoffDelay, RUNTIME_PROVIDER_MAX_DELAY_MS) * jitterMultiplier);
}

type KupoValue = {
  coins: number | string;
  assets: Record<string, number | string>;
};

type KupoMatch = {
  transaction_id: string;
  output_index: number;
  address: string;
  value: KupoValue;
  datum_hash: string | null;
  datum_type?: 'hash' | 'inline';
  script_hash: string | null;
};

type KupoDatum = {
  datum: string;
} | null;

type KupoScript = {
  language: 'native' | 'plutus:v1' | 'plutus:v2' | 'plutus:v3';
  script: string;
} | null;

export function withKupoStringQuantityHeader(headers?: {
  kupoHeader?: Record<string, string>;
  ogmiosHeader?: Record<string, string>;
}): {
  kupoHeader: Record<string, string>;
  ogmiosHeader?: Record<string, string>;
} {
  const kupoHeader = Object.fromEntries(
    Object.entries(headers?.kupoHeader ?? {}).filter(([name]) => name.toLowerCase() !== 'accept'),
  );
  kupoHeader.accept = 'application/json;asset-quantity=string';
  return {
    ...(headers ?? {}),
    kupoHeader,
  };
}

const KUPMIOs_LOOKUP_ATTEMPTS = 10;
const KUPMIOS_LOOKUP_BASE_DELAY_MS = 300;
const KUPMIOS_LOOKUP_MAX_DELAY_MS = 3000;

export function mapKupoValueToAssets(value: KupoValue): Record<string, bigint> {
  const assets: Record<string, bigint> = { lovelace: BigInt(value.coins) };
  for (const [unit, quantity] of Object.entries(value.assets ?? {})) {
    assets[unit.replace('.', '')] = BigInt(quantity);
  }
  return assets;
}

function toScriptRef(script: KupoScript | undefined): any {
  if (!script) {
    return undefined;
  }

  switch (script.language) {
    case 'native':
      return { type: 'Native', script: script.script };
    case 'plutus:v1':
      return { type: 'PlutusV1', script: applyDoubleCborEncoding(script.script) };
    case 'plutus:v2':
      return { type: 'PlutusV2', script: applyDoubleCborEncoding(script.script) };
    case 'plutus:v3':
      return { type: 'PlutusV3', script: applyDoubleCborEncoding(script.script) };
  }
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  let attempt = 1;
  let lastError: Error | undefined;
  const requestHeaders = Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => name.toLowerCase() !== 'accept'),
  );
  requestHeaders.accept = 'application/json;asset-quantity=string';
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.host.includes('kupo-m1.dmtr.host') && !requestHeaders['dmtr-api-key'] && process.env.KUPO_API_KEY) {
      requestHeaders['dmtr-api-key'] = process.env.KUPO_API_KEY;
    }
  } catch {
    // Let fetch surface malformed URLs below.
  }

  while (attempt <= KUPMIOs_LOOKUP_ATTEMPTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status} GET ${redactManagedEndpoint(url)} authHeader=${requestHeaders['dmtr-api-key'] ? 'set' : 'missing'}${body ? `: ${body}` : ''}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      const requestError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(requestError.message.replaceAll(url, redactManagedEndpoint(url)));
      if (attempt >= KUPMIOs_LOOKUP_ATTEMPTS) {
        break;
      }
      const delayMs = Math.min(KUPMIOS_LOOKUP_BASE_DELAY_MS * 2 ** (attempt - 1), KUPMIOS_LOOKUP_MAX_DELAY_MS);
      await sleep(delayMs);
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${redactManagedEndpoint(url)}`);
}

async function fetchKupoDatum(
  kupoEndpoint: string,
  datumType: 'hash' | 'inline' | undefined,
  datumHash: string | null,
  headers?: Record<string, string>,
): Promise<string | undefined> {
  if (datumType !== 'inline' || !datumHash) {
    return undefined;
  }

  const result = await fetchJson<KupoDatum>(`${kupoEndpoint}/datums/${datumHash}?inline`, headers);
  return result?.datum;
}

async function fetchKupoScript(
  kupoEndpoint: string,
  scriptHash: string | null,
  headers?: Record<string, string>,
): Promise<any> {
  if (!scriptHash) {
    return undefined;
  }

  const result = await fetchJson<KupoScript>(`${kupoEndpoint}/scripts/${scriptHash}`, headers);
  return toScriptRef(result ?? undefined);
}

async function kupoMatchesToUtxos(
  kupoEndpoint: string,
  matches: KupoMatch[],
  headers?: Record<string, string>,
): Promise<any[]> {
  const utxos: any[] = [];
  for (const match of matches) {
    utxos.push({
      txHash: match.transaction_id,
      outputIndex: match.output_index,
      address: match.address,
      assets: mapKupoValueToAssets(match.value),
      datumHash: match.datum_type === 'hash' ? (match.datum_hash ?? undefined) : undefined,
      datum: await fetchKupoDatum(kupoEndpoint, match.datum_type, match.datum_hash, headers),
      scriptRef: await fetchKupoScript(kupoEndpoint, match.script_hash, headers),
    });
  }

  return utxos;
}

function kupoQueryPredicate(addressOrCredential: string | { hash: string }): {
  queryPredicate: string;
  isAddress: boolean;
} {
  const isAddress = typeof addressOrCredential === 'string';
  return {
    queryPredicate: isAddress ? addressOrCredential : addressOrCredential.hash,
    isAddress,
  };
}

function splitUnit(unit: string): { policyId: string; assetName: string } {
  if (unit === 'lovelace' || unit.length < 56) {
    throw new Error(`Unsupported Kupo asset unit for policy query: ${unit}`);
  }
  return {
    policyId: unit.slice(0, 56),
    assetName: unit.slice(56),
  };
}

async function fetchKupoUtxos(
  kupoEndpoint: string,
  addressOrCredential: string | { hash: string },
  headers?: Record<string, string>,
): Promise<any[]> {
  const { queryPredicate, isAddress } = kupoQueryPredicate(addressOrCredential);
  const matches = await fetchJson<KupoMatch[]>(
    `${kupoEndpoint}/matches/${queryPredicate}${isAddress ? '' : '/*'}?unspent`,
    headers,
  );
  return kupoMatchesToUtxos(kupoEndpoint, matches, headers);
}

async function fetchKupoUtxosWithUnit(
  kupoEndpoint: string,
  addressOrCredential: string | { hash: string },
  unit: string,
  headers?: Record<string, string>,
): Promise<any[]> {
  const { queryPredicate, isAddress } = kupoQueryPredicate(addressOrCredential);
  const { policyId, assetName } = splitUnit(unit);
  const matches = await fetchJson<KupoMatch[]>(
    `${kupoEndpoint}/matches/${queryPredicate}${isAddress ? '' : '/*'}?unspent&policy_id=${policyId}${assetName ? `&asset_name=${assetName}` : ''}`,
    headers,
  );
  return kupoMatchesToUtxos(kupoEndpoint, matches, headers);
}

async function fetchKupoUtxoByUnit(
  kupoEndpoint: string,
  unit: string,
  headers?: Record<string, string>,
): Promise<any | undefined> {
  const { policyId, assetName } = splitUnit(unit);
  const matches = await fetchJson<KupoMatch[]>(
    `${kupoEndpoint}/matches/${policyId}.${assetName || '*'}?unspent`,
    headers,
  );
  const utxos = await kupoMatchesToUtxos(kupoEndpoint, matches, headers);
  if (utxos.length > 1) {
    throw new Error('Unit needs to be an NFT or only held by one address.');
  }
  return utxos[0];
}

async function fetchKupoUtxosByOutRef(
  kupoEndpoint: string,
  outRefs: Array<{ txHash: string; outputIndex: number }>,
  headers?: Record<string, string>,
): Promise<any[]> {
  const uniqueTxHashes = [...new Set(outRefs.map((outRef) => outRef.txHash))];
  const matches: KupoMatch[] = [];
  for (const txHash of uniqueTxHashes) {
    const fetchedMatches = await fetchJson<KupoMatch[]>(`${kupoEndpoint}/matches/*@${txHash}?unspent`, headers);
    matches.push(...fetchedMatches);
  }

  const filteredMatches = matches.filter((match) =>
    outRefs.some((outRef) => match.transaction_id === outRef.txHash && match.output_index === outRef.outputIndex),
  );

  return kupoMatchesToUtxos(kupoEndpoint, filteredMatches, headers);
}

const KUPO_POLICY_ID_PATTERN = /^[0-9a-f]{56}$/;
const KUPO_HASH_PATTERN = /^[0-9a-f]{64}$/;
const KUPO_ASSET_ID_PATTERN = /^[0-9a-f]{56}(?:\.[0-9a-f]{2,64})?$/;
const HEX_BYTES_PATTERN = /^(?:[0-9a-f]{2})+$/;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Malformed Kupo history response: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Malformed Kupo history response: ${label} must be a non-empty string`);
  }
  return value;
}

function requireSafeIndex(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Malformed Kupo history response: ${label} must be a non-negative safe integer`);
  }
  return value;
}

function requireHex(value: unknown, pattern: RegExp, label: string): string {
  const parsed = requireString(value, label);
  if (!pattern.test(parsed)) {
    throw new Error(`Malformed Kupo history response: ${label} is not canonical base16`);
  }
  return parsed;
}

function requireNonNegativeQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Malformed Kupo history response: ${label} must be an integer quantity`);
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`Malformed Kupo history response: ${label} must be a safe integer or decimal string`);
  }
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`Malformed Kupo history response: ${label} must be a non-negative canonical integer`);
  }
  return BigInt(text);
}

function requireHistoryPoint(value: unknown, label: string): KupoHistoryPoint {
  const point = requireRecord(value, label);
  return {
    slotNo: requireSafeIndex(point.slot_no, `${label}.slot_no`),
    headerHash: requireHex(point.header_hash, KUPO_HASH_PATTERN, `${label}.header_hash`),
  };
}

function parseHistoricalValue(
  value: unknown,
  expectedPolicyId: string,
  label: string,
): {
  assets: Record<string, bigint>;
  authToken: KupoHistoricalOutput['authToken'];
} {
  const parsedValue = requireRecord(value, `${label}.value`);
  const assets: Record<string, bigint> = {
    lovelace: requireNonNegativeQuantity(parsedValue.coins, `${label}.value.coins`),
  };
  const parsedAssets = requireRecord(parsedValue.assets, `${label}.value.assets`);
  const matchingTokens: Array<KupoHistoricalOutput['authToken']> = [];

  for (const [assetId, rawQuantity] of Object.entries(parsedAssets)) {
    if (!KUPO_ASSET_ID_PATTERN.test(assetId)) {
      throw new Error(`Malformed Kupo history response: ${label}.value.assets contains invalid asset id`);
    }
    const [policyId, assetName = ''] = assetId.split('.');
    if (assetName.length % 2 !== 0) {
      throw new Error(`Malformed Kupo history response: ${label}.value.assets contains odd-length base16`);
    }
    const quantity = requireNonNegativeQuantity(rawQuantity, `${label}.value.assets[${assetId}]`);
    const unit = `${policyId}${assetName}`;
    assets[unit] = quantity;

    if (policyId === expectedPolicyId) {
      if (!assetName) {
        throw new Error(`Malformed Kupo history response: ${label} has an empty auth-token name`);
      }
      if (quantity !== 1n) {
        throw new Error(`Ambiguous Kupo history response: ${label} auth-token quantity must equal one`);
      }
      matchingTokens.push({ policyId, name: assetName, unit });
    }
  }

  if (matchingTokens.length !== 1) {
    throw new Error(
      `Ambiguous Kupo history response: ${label} must contain exactly one token under policy ${expectedPolicyId}`,
    );
  }

  return { assets, authToken: matchingTokens[0] };
}

function compareHistoricalOutputs(a: KupoHistoricalOutput, b: KupoHistoricalOutput): number {
  return (
    a.createdAt.slotNo - b.createdAt.slotNo ||
    a.transactionIndex - b.transactionIndex ||
    a.outputIndex - b.outputIndex ||
    a.txHash.localeCompare(b.txHash)
  );
}

async function requireKupoHistoryCoverage(
  kupoEndpoint: string,
  address: string,
  policyId: string,
  headers?: Record<string, string>,
): Promise<void> {
  const patterns = [address, `${policyId}.*`];
  const configuredPatterns = await Promise.all(
    patterns.map(async (pattern) => {
      const response = await fetchJson<unknown>(`${kupoEndpoint}/patterns/${encodeURIComponent(pattern)}`, headers);
      if (!Array.isArray(response) || !response.every((item) => typeof item === 'string' && item.length > 0)) {
        throw new Error('Malformed Kupo pattern-coverage response');
      }
      return response;
    }),
  );

  if (configuredPatterns.every((matches) => matches.length === 0)) {
    throw new Error(`Kupo is not configured to retain matches for address ${address} or policy ${policyId}`);
  }
}

/**
 * Fetch all canonical Kupo matches (spent and unspent) for one address/policy.
 *
 * Kupo v2.9 returns both statuses when neither status flag is present. Its
 * documented ordering is reinforced locally so callers never depend on HTTP
 * response order. Historical recovery requires Kupo to run without
 * `--prune-utxo`; a configured address/policy coverage check prevents an empty
 * result from silently standing in for an address Kupo never indexed.
 */
export async function fetchKupoHistoryAtAddressByPolicy(
  kupoEndpoint: string,
  address: string,
  policyId: string,
  headers?: Record<string, string>,
  assetName?: string,
): Promise<KupoHistoricalOutput[]> {
  if (typeof address !== 'string' || address.length === 0 || address.trim() !== address) {
    throw new Error('Invalid Kupo history address');
  }
  if (!KUPO_POLICY_ID_PATTERN.test(policyId)) {
    throw new Error('Invalid Kupo history policy id');
  }
  if (
    assetName !== undefined &&
    (assetName.length === 0 ||
      assetName.length > 64 ||
      assetName.length % 2 !== 0 ||
      !/^[0-9a-f]+$/.test(assetName))
  ) {
    throw new Error('Invalid Kupo history asset name');
  }

  await requireKupoHistoryCoverage(kupoEndpoint, address, policyId, headers);

  // Deliberately omit both `spent` and `unspent`: Kupo's NoStatusFlag query is
  // the single-snapshot API for retrieving both kinds of matches.
  const response = await fetchJson<unknown>(
    `${kupoEndpoint}/matches/${encodeURIComponent(address)}?policy_id=${policyId}` +
      (assetName === undefined ? '' : `&asset_name=${assetName}`),
    headers,
  );
  if (!Array.isArray(response)) {
    throw new Error('Malformed Kupo history response: matches must be an array');
  }

  const resolvedDatums = new Map<string, string>();
  const outputReferences = new Set<string>();
  const slotHeaders = new Map<number, string>();
  const outputs: KupoHistoricalOutput[] = [];

  for (const [index, rawMatch] of response.entries()) {
    const label = `matches[${index}]`;
    const match = requireRecord(rawMatch, label);
    const transactionId = requireHex(match.transaction_id, KUPO_HASH_PATTERN, `${label}.transaction_id`);
    const outputIndex = requireSafeIndex(match.output_index, `${label}.output_index`);
    const transactionIndex = requireSafeIndex(match.transaction_index, `${label}.transaction_index`);
    const matchAddress = requireString(match.address, `${label}.address`);
    if (matchAddress !== address) {
      throw new Error(`Malformed Kupo history response: ${label}.address does not match the requested address`);
    }

    const outputReference = `${transactionId}#${outputIndex}`;
    if (outputReferences.has(outputReference)) {
      throw new Error(`Ambiguous Kupo history response: duplicate output reference ${outputReference}`);
    }
    outputReferences.add(outputReference);

    const createdAt = requireHistoryPoint(match.created_at, `${label}.created_at`);
    const spentAt = match.spent_at === null ? null : requireHistoryPoint(match.spent_at, `${label}.spent_at`);
    if (spentAt && spentAt.slotNo < createdAt.slotNo) {
      throw new Error(`Malformed Kupo history response: ${label} was spent before it was created`);
    }
    for (const point of spentAt ? [createdAt, spentAt] : [createdAt]) {
      const knownHeader = slotHeaders.get(point.slotNo);
      if (knownHeader && knownHeader !== point.headerHash) {
        throw new Error(`Ambiguous Kupo history response: slot ${point.slotNo} has conflicting headers`);
      }
      slotHeaders.set(point.slotNo, point.headerHash);
    }

    if (match.datum_type !== 'inline') {
      throw new Error(`Malformed Kupo history response: ${label} must carry an inline datum`);
    }
    const datumHash = requireHex(match.datum_hash, KUPO_HASH_PATTERN, `${label}.datum_hash`);
    let datum = resolvedDatums.get(datumHash);
    if (!datum) {
      const resolved = await fetchKupoDatum(kupoEndpoint, 'inline', datumHash, headers);
      if (typeof resolved !== 'string' || !HEX_BYTES_PATTERN.test(resolved)) {
        throw new Error(`Malformed Kupo history response: inline datum ${datumHash} could not be resolved`);
      }
      datum = resolved;
      resolvedDatums.set(datumHash, datum);
    }

    const { assets, authToken } = parseHistoricalValue(match.value, policyId, label);
    if (assetName !== undefined && authToken.name !== assetName) {
      throw new Error(
        `Malformed Kupo history response: ${label} auth-token name does not match the requested asset name`,
      );
    }
    outputs.push({
      txHash: transactionId,
      outputIndex,
      transactionIndex,
      address: matchAddress,
      assets,
      datum,
      inlineDatumHash: datumHash,
      createdAt,
      spentAt,
      authToken,
    });
  }

  return outputs.sort(compareHistoricalOutputs);
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  label: string,
  wait: (durationMs: number) => Promise<void> = sleep,
): Promise<T> {
  for (let attempt = 1; attempt <= PROTOCOL_PARAMETERS_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientStartupError(error)) {
        throw error;
      }

      const errorSummary = summarizeError(error);
      if (attempt >= PROTOCOL_PARAMETERS_MAX_ATTEMPTS) {
        throw new Error(
          `[startup] ${label} failed after ${PROTOCOL_PARAMETERS_MAX_ATTEMPTS} attempts: ${errorSummary}`,
        );
      }

      const retryDelayMs = computeProtocolParametersRetryDelayMs(attempt, error);
      console.warn(
        `[startup] ${label} failed (attempt ${attempt}/${PROTOCOL_PARAMETERS_MAX_ATTEMPTS}): ${errorSummary}. Retrying in ${retryDelayMs}ms`,
      );
      await wait(retryDelayMs);
    }
  }

  throw new Error(`[startup] ${label} failed after ${PROTOCOL_PARAMETERS_MAX_ATTEMPTS} attempts`);
}

async function retryRuntimeProviderOperation<T>(operation: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= RUNTIME_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isNonRetryableRuntimeProviderError(error)) {
        throw new Error(
          `[runtime] ${label} failed with non-retryable Cardano provider rejection: ` +
            `${describeRuntimeProviderError(error)}. Not retrying.`,
        );
      }

      if (!isTransientRuntimeProviderError(error) || attempt >= RUNTIME_PROVIDER_MAX_ATTEMPTS) {
        throw error;
      }

      const retryDelayMs = computeRuntimeProviderDelayMs(attempt);
      console.warn(
        `[runtime] ${label} failed with transient provider error (attempt ${attempt}/${RUNTIME_PROVIDER_MAX_ATTEMPTS}): ${summarizeError(error)}. Retrying in ${retryDelayMs}ms`,
      );
      await sleep(retryDelayMs);
    }
  }

  throw new Error(`[runtime] ${label} failed after ${RUNTIME_PROVIDER_MAX_ATTEMPTS} attempts`);
}

export const LucidClient = {
  provide: LUCID_CLIENT,
  useFactory: async (configService: ConfigService) => {
    // Dynamically import Lucid library
    const Lucid = await (eval(`import('@lucid-evolution/lucid')`) as Promise<typeof import('@lucid-evolution/lucid')>);
    // Create Lucid provider and instance
    const kupoApiKey = configService.get('kupoApiKey') ?? process.env.KUPO_API_KEY;
    const ogmiosApiKey = configService.get('ogmiosApiKey') ?? process.env.OGMIOS_API_KEY;
    const rawKupoEndpoint = configService.get('kupoEndpoint');
    const kupoEndpoint = resolveManagedKupoEndpoint(rawKupoEndpoint, kupoApiKey) ?? rawKupoEndpoint;
    const ogmiosEndpoint = resolveManagedOgmiosHttpEndpoint(configService.get('ogmiosEndpoint'), ogmiosApiKey);
    const kupmiosHeaders = withKupoStringQuantityHeader(
      resolveManagedKupmiosHeaders(kupoEndpoint, kupoApiKey, ogmiosEndpoint, ogmiosApiKey),
    );

    installManagedCardanoAuthFetch(
      configService.get('kupoEndpoint'),
      kupoApiKey,
      configService.get('ogmiosEndpoint'),
      ogmiosApiKey,
    );

    const provider: any = new Lucid.Kupmios(kupoEndpoint, ogmiosEndpoint, kupmiosHeaders);
    const historyProvider = provider as typeof provider & KupoHistoryProvider;
    historyProvider.getKupoHistoryAtAddressByPolicy = async (
      address: string,
      policyId: string,
      assetName?: string,
    ) =>
      fetchKupoHistoryAtAddressByPolicy(
        kupoEndpoint,
        address,
        policyId,
        kupmiosHeaders?.kupoHeader,
        assetName,
      );
    console.log(
      `[startup] Lucid provider endpoints kupo=${redactManagedEndpoint(kupoEndpoint, kupoApiKey)} ogmiosHttp=${redactManagedEndpoint(ogmiosEndpoint, ogmiosApiKey)} ogmiosWs=${redactManagedEndpoint(configService.get('ogmiosEndpoint'), ogmiosApiKey)} kupoAuth=${kupoApiKey ? 'set' : 'missing'} ogmiosAuth=${ogmiosApiKey ? 'set' : 'missing'}`,
    );
    if (typeof provider.getUtxos === 'function') {
      provider.getUtxos = async (addressOrCredential: string | { hash: string }) =>
        fetchKupoUtxos(kupoEndpoint, addressOrCredential, kupmiosHeaders?.kupoHeader);
    }
    if (typeof provider.getUtxosWithUnit === 'function') {
      provider.getUtxosWithUnit = async (addressOrCredential: string | { hash: string }, unit: string) =>
        fetchKupoUtxosWithUnit(kupoEndpoint, addressOrCredential, unit, kupmiosHeaders?.kupoHeader);
    }
    if (typeof provider.getUtxoByUnit === 'function') {
      provider.getUtxoByUnit = async (unit: string) =>
        fetchKupoUtxoByUnit(kupoEndpoint, unit, kupmiosHeaders?.kupoHeader);
    }
    const originalGetUtxosByOutRef = provider.getUtxosByOutRef?.bind(provider);
    if (typeof originalGetUtxosByOutRef === 'function') {
      provider.getUtxosByOutRef = async (outRefs: Array<{ txHash: string; outputIndex: number }>) => {
        void originalGetUtxosByOutRef;
        return await fetchKupoUtxosByOutRef(kupoEndpoint, outRefs, kupmiosHeaders?.kupoHeader);
      };
    }
    // DEBUG: `TxBuilder.complete()` uses `provider.evaluateTx(...)` to ask Ogmios for script
    // execution units. When evaluation fails, Lucid throws before we can decode the final
    // transaction body, which makes errors like `Spend[2]` hard to map to actual inputs.
    //
    // By logging the transaction's input ordering *at the evaluation boundary*, we can
    // deterministically map `purpose=spend,index=N` to a concrete `txHash#ix` and then
    // identify which validator/UTxO is failing (HostState vs connection vs wallet input).
    const originalEvaluateTx = provider.evaluateTx?.bind(provider);
    if (typeof originalEvaluateTx === 'function') {
      provider.evaluateTx = async (tx: string, additionalUTxOs?: any[]) => {
        try {
          return await retryRuntimeProviderOperation(
            () => originalEvaluateTx(tx, additionalUTxOs),
            'Kupmios.evaluateTx',
          );
        } catch (error) {
          try {
            const dumpId = Date.now();
            const dumpTxPath = `/tmp/gateway-evaluateTx-failure-${dumpId}.tx`;
            const dumpContextPath = `/tmp/gateway-evaluateTx-failure-${dumpId}.context.json`;
            const latestTxPath = '/tmp/gateway-evaluateTx-last-failure.tx';
            const latestContextPath = '/tmp/gateway-evaluateTx-last-failure.context.json';

            writeFileSync(dumpTxPath, Buffer.from(tx, 'hex'));
            writeFileSync(latestTxPath, Buffer.from(tx, 'hex'));
            console.error(`[DEBUG] Kupmios.evaluateTx dumped failing tx to ${dumpTxPath}`);
            console.error(`[DEBUG] Kupmios.evaluateTx updated latest failing tx at ${latestTxPath}`);

            try {
              const dumpContext = {
                error:
                  error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                      }
                    : String(error),
                additionalUTxOs: additionalUTxOs ?? [],
              };
              const dumpContextJson = JSON.stringify(
                dumpContext,
                (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
                2,
              );
              writeFileSync(dumpContextPath, dumpContextJson);
              writeFileSync(latestContextPath, dumpContextJson);
              console.error(`[DEBUG] Kupmios.evaluateTx dumped failure context to ${dumpContextPath}`);
              console.error(`[DEBUG] Kupmios.evaluateTx updated latest failure context at ${latestContextPath}`);
            } catch (contextError) {
              console.error(`[DEBUG] Kupmios.evaluateTx failed to dump additionalUTxOs:`, contextError);
            }

            const CML = (Lucid as any)?.CML;
            if (CML?.Transaction?.from_cbor_hex) {
              const parsedTx = CML.Transaction.from_cbor_hex(tx);
              const body = parsedTx.body();

              const inputs = body.inputs();
              const inputRefs: string[] = [];
              for (let i = 0; i < inputs.len(); i += 1) {
                const input = inputs.get(i);
                inputRefs.push(`${input.transaction_id().to_hex()}#${input.index()}`);
              }

              const referenceInputs = body.reference_inputs();
              const refInputRefs: string[] = [];
              if (referenceInputs) {
                for (let i = 0; i < referenceInputs.len(); i += 1) {
                  const input = referenceInputs.get(i);
                  refInputRefs.push(`${input.transaction_id().to_hex()}#${input.index()}`);
                }
              }

              console.error(
                `[DEBUG] Kupmios.evaluateTx failed: tx_cbor_len=${tx.length} head=${tx.substring(0, 120)} inputs(${inputRefs.length})=${inputRefs.join(', ')} reference_inputs(${refInputRefs.length})=${refInputRefs.join(', ')} additionalUTxOs=${additionalUTxOs?.length ?? 0}`,
              );

              // Best-effort redeemer pointer dump (helps interpret `purpose=spend,index=N`).
              try {
                const redeemers = parsedTx.witness_set().redeemers();
                if (redeemers) {
                  const mintPolicyIds: string[] = [];
                  try {
                    const mint = body.mint();
                    if (mint) {
                      const keys = mint.keys();
                      for (let i = 0; i < keys.len(); i += 1) {
                        mintPolicyIds.push(keys.get(i).to_hex());
                      }
                    }
                  } catch {
                    // Best-effort only.
                  }

                  const lines: string[] = [];
                  if (redeemers.kind() === CML.RedeemersKind.MapRedeemerKeyToRedeemerVal) {
                    const m = redeemers.as_map_redeemer_key_to_redeemer_val();
                    const keys = m.keys();
                    for (let i = 0; i < keys.len(); i += 1) {
                      const key = keys.get(i);
                      const tag = key.tag();
                      const index = Number(key.index());
                      const tagName = (CML.RedeemerTag as any)[tag] ?? String(tag);
                      const inputLabel =
                        tag === CML.RedeemerTag.Spend
                          ? (inputRefs[index] ?? `<missing input for Spend[${index}]>`)
                          : undefined;
                      lines.push(inputLabel ? `${tagName}[${index}] -> ${inputLabel}` : `${tagName}[${index}]`);
                    }
                  } else {
                    const legacy = redeemers.as_arr_legacy_redeemer();
                    if (legacy) {
                      for (let i = 0; i < legacy.len(); i += 1) {
                        const r = legacy.get(i);
                        const tag = r.tag();
                        const index = Number(r.index());
                        const tagName = (CML.RedeemerTag as any)[tag] ?? String(tag);
                        if (tag === CML.RedeemerTag.Spend) {
                          lines.push(
                            `${tagName}[${index}] -> ${inputRefs[index] ?? `<missing input for Spend[${index}]>`}`,
                          );
                        } else if (tag === CML.RedeemerTag.Mint) {
                          const policy = mintPolicyIds[index];
                          lines.push(policy ? `${tagName}[${index}] -> ${policy}` : `${tagName}[${index}]`);
                        } else {
                          lines.push(`${tagName}[${index}]`);
                        }
                      }
                    } else {
                      lines.push(`legacy_redeemers cbor_head=${redeemers.to_cbor_hex().substring(0, 120)}`);
                    }
                  }
                  console.error(`[DEBUG] Kupmios.evaluateTx redeemers(${lines.length}): ${lines.join(', ')}`);
                }
              } catch {
                // Best-effort only: never mask the original error.
              }
            } else {
              console.error(
                `[DEBUG] Kupmios.evaluateTx failed: tx_cbor_len=${tx.length} head=${tx.substring(0, 120)} additionalUTxOs=${additionalUTxOs?.length ?? 0}`,
              );
            }
          } catch (logError) {
            console.error(`[DEBUG] Kupmios.evaluateTx failed and could not decode tx:`, logError);
          }

          throw error;
        }
      };
    }

    const originalSubmitTx = provider.submitTx?.bind(provider);
    if (typeof originalSubmitTx === 'function') {
      provider.submitTx = async (cbor: string) =>
        retryRuntimeProviderOperation(() => originalSubmitTx(cbor), 'Kupmios.submitTx');
    }

    const originalAwaitTx = provider.awaitTx?.bind(provider);
    if (typeof originalAwaitTx === 'function') {
      provider.awaitTx = async (txHash: string, checkInterval: number = 20_000) => {
        const timeoutMs = Math.max(160_000, checkInterval * 8);
        try {
          await queryTransactionInclusionBlockHeight(configService.get('ogmiosEndpoint'), txHash, 'origin', timeoutMs);
          return true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn(
            `[startup] Ogmios awaitTx fallback did not confirm tx ${txHash} within ${timeoutMs}ms: ${errorMessage}`,
          );
          return false;
        }
      };
    }

    const network = configService.get('cardanoNetwork') as Network;
    console.log('[startup] Fetching Ogmios protocol parameters');
    const protocolParameters = sanitizeProtocolParameters(
      await retryWithBackoff(
        () => queryProtocolParametersCompat(ogmiosEndpoint, kupmiosHeaders?.ogmiosHeader),
        'Ogmios protocol parameters fetch',
      ),
    );
    console.log('[startup] Ogmios protocol parameters loaded');
    console.log(`[startup] Constructing Lucid for network=${network}`);
    const lucid = await Lucid.Lucid(provider, network, {
      presetProtocolParameters: protocolParameters,
    } as any);
    console.log('[startup] Lucid constructed successfully');

    const isDevnetWithRuntimeSlotConfig = network === 'Custom';
    if (isDevnetWithRuntimeSlotConfig) {
      console.log('[startup] Querying Ogmios system start');
      const devnetZeroTime = await retryWithBackoff(
        () => querySystemStart(configService.get('ogmiosEndpoint')),
        'Ogmios system start query',
      );
      console.log('[startup] Ogmios system start loaded');
      Lucid.SLOT_CONFIG_NETWORK[network].zeroTime = devnetZeroTime;
      Lucid.SLOT_CONFIG_NETWORK[network].slotLength = 1000;
    }
    // const lucid = await Lucid.Lucid.new(
    //   new Lucid.Blockfrost('https://cardano-preview.blockfrost.io/api/v0', 'preview2fjKEg2Zh687WPUwB8eljT2Mz2q045GC'),
    //   'Preview',
    // );
    // const defaultSigner = configService.get('signer').address;
    // lucid.selectWalletFrom({
    //   address: defaultSigner,
    // });
    // lucid.selectWalletFromPrivateKey(configService.get('signer').sk);

    return lucid;
  },
  inject: [ConfigService],
};

export const LucidImporter = {
  provide: LUCID_IMPORTER,
  useFactory: async () => {
    // Dynamically import Lucid library
    return await (eval(`import('@lucid-evolution/lucid')`) as Promise<typeof import('@lucid-evolution/lucid')>);
  },
};
