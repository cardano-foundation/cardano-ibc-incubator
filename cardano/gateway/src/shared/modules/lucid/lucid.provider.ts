import { ConfigService } from '@nestjs/config';
import { querySystemStart, queryTransactionInclusionBlockHeight } from '../../helpers/time';
import { Network } from '@lucid-evolution/lucid';
import { applyDoubleCborEncoding } from '@lucid-evolution/utils';
import {
  installManagedCardanoAuthFetch,
  resolveManagedKupmiosHeaders,
  resolveManagedKupoEndpoint,
  resolveManagedOgmiosHttpEndpoint,
} from '../../helpers/managed-cardano-endpoints';
export const LUCID_CLIENT = 'LUCID_CLIENT';
export const LUCID_IMPORTER = 'LUCID_IMPORTER';

const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;
const PROTOCOL_PARAMETERS_MAX_ATTEMPTS = 20;
const PROTOCOL_PARAMETERS_BASE_DELAY_MS = 1000;
const PROTOCOL_PARAMETERS_MAX_DELAY_MS = 5000;
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
  '429',
  'unexpected server response: 429',
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

function sanitizeProtocolParameters(protocolParameters: any): any {
  if (!protocolParameters?.costModels) {
    return protocolParameters;
  }

  let sanitizedEntries = 0;
  const sanitizedCostModels: Record<string, Record<string, number>> = {};

  for (const [version, model] of Object.entries(protocolParameters.costModels as Record<string, Record<string, unknown>>)) {
    const sanitizedModel: Record<string, number> = {};
    for (const [index, value] of Object.entries(model ?? {})) {
      const sanitized = toSafeCostModelInteger(value);
      if (sanitized !== value) {
        sanitizedEntries += 1;
      }
      sanitizedModel[index] = sanitized;
    }
    sanitizedCostModels[version] = sanitizedModel;
  }

  if (sanitizedEntries > 0) {
    console.warn(
      `Normalized ${sanitizedEntries} cost model value(s) to safe integers before Lucid initialization.`,
    );
  }

  return {
    ...protocolParameters,
    costModels: sanitizedCostModels,
  };
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

      visit(record.cause, depth + 1);
      visit(record.error, depth + 1);
      visit(record.originalError, depth + 1);

      for (const key of Object.getOwnPropertyNames(value)) {
        if (
          [
            'message',
            'name',
            'code',
            'reason',
            'details',
            'type',
            'statusText',
            'stack',
          ].includes(key)
        ) {
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

function isTransientStartupError(error: unknown): boolean {
  const normalizedSignals = collectErrorSignals(error).map((signal) =>
    signal.toLowerCase(),
  );
  if (normalizedSignals.length === 0) {
    return false;
  }

  return normalizedSignals.some((signal) =>
    TRANSIENT_STARTUP_ERROR_MARKERS.some((marker) => signal.includes(marker)),
  );
}

export function isNonRetryableRuntimeProviderError(error: unknown): boolean {
  const normalized = collectErrorSignals(error)
    .map((signal) => signal.toLowerCase())
    .join('\n');
  if (normalized.length === 0) {
    return false;
  }

  return NON_RETRYABLE_RUNTIME_PROVIDER_ERROR_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

export function isTransientRuntimeProviderError(error: unknown): boolean {
  if (isNonRetryableRuntimeProviderError(error)) {
    return false;
  }

  const normalizedSignals = collectErrorSignals(error).map((signal) =>
    signal.toLowerCase(),
  );
  if (normalizedSignals.length === 0) {
    return false;
  }

  return normalizedSignals.some((signal) =>
    TRANSIENT_RUNTIME_PROVIDER_ERROR_MARKERS.some((marker) =>
      signal.includes(marker),
    ),
  );
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
    parts.push(
      `validation_error=${validationErrorMatch[1]
        .replace(/\\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()}`,
    );
  }

  parts.push(`summary=${summarizeError(error)}`);
  return parts.join('; ');
}

function computeJitteredBackoffDelayMs(failedAttempt: number): number {
  const backoffDelay =
    PROTOCOL_PARAMETERS_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(Math.min(backoffDelay, PROTOCOL_PARAMETERS_MAX_DELAY_MS) * jitterMultiplier);
}

function computeRuntimeProviderDelayMs(failedAttempt: number): number {
  const backoffDelay =
    RUNTIME_PROVIDER_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(Math.min(backoffDelay, RUNTIME_PROVIDER_MAX_DELAY_MS) * jitterMultiplier);
}

type KupoValue = {
  coins: number;
  assets: Record<string, number>;
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

const DEFAULT_KUPMIOS_LOOKUP_MAX_ATTEMPTS = 30;
const KUPMIOS_LOOKUP_BASE_DELAY_MS = 500;
const KUPMIOS_LOOKUP_MAX_DELAY_MS = 5000;

class KupoFetchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'KupoFetchError';
  }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRetryableKupoLookupError(error: Error): boolean {
  if (error instanceof KupoFetchError) {
    return (
      error.status === 401 ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }

  return isTransientRuntimeProviderError(error);
}

function computeKupoLookupDelayMs(failedAttempt: number): number {
  const backoffDelay =
    KUPMIOS_LOOKUP_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(Math.min(backoffDelay, KUPMIOS_LOOKUP_MAX_DELAY_MS) * jitterMultiplier);
}

function toAssets(value: KupoValue): Record<string, bigint> {
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
  const maxAttempts = readPositiveIntegerEnv(
    'KUPMIOS_LOOKUP_MAX_ATTEMPTS',
    DEFAULT_KUPMIOS_LOOKUP_MAX_ATTEMPTS,
  );
  const requestHeaders = { ...(headers ?? {}) };
  try {
    const parsedUrl = new URL(url);
    const configuredKupoApiKey = process.env.KUPO_API_KEY;
    const usesAuthenticatedDemeterHost = configuredKupoApiKey
      ? parsedUrl.host.startsWith(`${configuredKupoApiKey}.`)
      : false;
    if (
      parsedUrl.host.includes('kupo-m1.dmtr.host') &&
      !usesAuthenticatedDemeterHost &&
      !requestHeaders['dmtr-api-key'] &&
      configuredKupoApiKey
    ) {
      requestHeaders['dmtr-api-key'] = configuredKupoApiKey;
    }
  } catch {
    // Let fetch surface malformed URLs below.
  }

  while (attempt <= maxAttempts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new KupoFetchError(
          response.status,
          `HTTP ${response.status} GET ${url} authHeader=${requestHeaders['dmtr-api-key'] ? 'set' : 'missing'}${body ? `: ${body}` : ''}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetryableKupoLookupError(lastError) || attempt >= maxAttempts) {
        throw lastError;
      }

      const delayMs = computeKupoLookupDelayMs(attempt);
      console.warn(
        `[runtime] Kupo GET failed with retryable provider error (attempt ${attempt}/${maxAttempts}): ${summarizeError(lastError)}. Retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
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
      assets: toAssets(match.value),
      datumHash: match.datum_type === 'hash' ? match.datum_hash ?? undefined : undefined,
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
    const fetchedMatches = await fetchJson<KupoMatch[]>(
      `${kupoEndpoint}/matches/*@${txHash}?unspent`,
      headers,
    );
    matches.push(...fetchedMatches);
  }

  const filteredMatches = matches.filter((match) =>
    outRefs.some((outRef) =>
      match.transaction_id === outRef.txHash && match.output_index === outRef.outputIndex
    )
  );

  return kupoMatchesToUtxos(kupoEndpoint, filteredMatches, headers);
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  for (
    let attempt = 1;
    attempt <= PROTOCOL_PARAMETERS_MAX_ATTEMPTS;
    attempt += 1
  ) {
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

      const retryDelayMs = computeJitteredBackoffDelayMs(attempt);
      console.warn(
        `[startup] ${label} failed (attempt ${attempt}/${PROTOCOL_PARAMETERS_MAX_ATTEMPTS}): ${errorSummary}. Retrying in ${retryDelayMs}ms`,
      );
      await sleep(retryDelayMs);
    }
  }

  throw new Error(
    `[startup] ${label} failed after ${PROTOCOL_PARAMETERS_MAX_ATTEMPTS} attempts`,
  );
}

async function retryRuntimeProviderOperation<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
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

  throw new Error(
    `[runtime] ${label} failed after ${RUNTIME_PROVIDER_MAX_ATTEMPTS} attempts`,
  );
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
    const kupoEndpoint = resolveManagedKupoEndpoint(
      rawKupoEndpoint,
      kupoApiKey,
    ) ?? rawKupoEndpoint;
    const ogmiosEndpoint = resolveManagedOgmiosHttpEndpoint(
      configService.get('ogmiosEndpoint'),
      ogmiosApiKey,
    );
    const kupmiosHeaders = resolveManagedKupmiosHeaders(
      kupoEndpoint,
      kupoApiKey,
      ogmiosEndpoint,
      ogmiosApiKey,
    );

    installManagedCardanoAuthFetch(
      configService.get('kupoEndpoint'),
      kupoApiKey,
      configService.get('ogmiosEndpoint'),
      ogmiosApiKey,
    );

    const provider: any = new Lucid.Kupmios(kupoEndpoint, ogmiosEndpoint, kupmiosHeaders);
    console.log(
      `[startup] Lucid provider endpoints kupo=${kupoEndpoint} ogmiosHttp=${ogmiosEndpoint} ogmiosWs=${configService.get('ogmiosEndpoint')} kupoAuth=${kupoApiKey ? 'set' : 'missing'} ogmiosAuth=${ogmiosApiKey ? 'set' : 'missing'}`,
    );
    if (typeof provider.getUtxos === 'function') {
      provider.getUtxos = async (addressOrCredential: string | { hash: string }) =>
        fetchKupoUtxos(kupoEndpoint, addressOrCredential, kupmiosHeaders?.kupoHeader);
    }
    if (typeof provider.getUtxosWithUnit === 'function') {
      provider.getUtxosWithUnit = async (
        addressOrCredential: string | { hash: string },
        unit: string,
      ) => fetchKupoUtxosWithUnit(kupoEndpoint, addressOrCredential, unit, kupmiosHeaders?.kupoHeader);
    }
    if (typeof provider.getUtxoByUnit === 'function') {
      provider.getUtxoByUnit = async (unit: string) =>
        fetchKupoUtxoByUnit(kupoEndpoint, unit, kupmiosHeaders?.kupoHeader);
    }
    const originalGetUtxosByOutRef = provider.getUtxosByOutRef?.bind(provider);
    if (typeof originalGetUtxosByOutRef === 'function') {
      provider.getUtxosByOutRef = async (
        outRefs: Array<{ txHash: string; outputIndex: number }>,
      ) => {
        void originalGetUtxosByOutRef;
        return await fetchKupoUtxosByOutRef(
          kupoEndpoint,
          outRefs,
          kupmiosHeaders?.kupoHeader,
        );
      };
    }
    const originalEvaluateTx = provider.evaluateTx?.bind(provider);
    if (typeof originalEvaluateTx === 'function') {
      provider.evaluateTx = async (tx: string, additionalUTxOs?: any[]) =>
        retryRuntimeProviderOperation(
          () => originalEvaluateTx(tx, additionalUTxOs),
          'Kupmios.evaluateTx',
        );
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
          await queryTransactionInclusionBlockHeight(
            configService.get('ogmiosEndpoint'),
            txHash,
            'origin',
            timeoutMs,
          );
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
    console.log('[startup] Fetching Kupmios protocol parameters');
    const protocolParameters = sanitizeProtocolParameters(
      await retryWithBackoff(
        () => provider.getProtocolParameters(),
        'Kupmios protocol parameters fetch',
      ),
    );
    console.log('[startup] Kupmios protocol parameters loaded');
    console.log(`[startup] Constructing Lucid for network=${network}`);
    const lucid = await Lucid.Lucid(provider, network, {
      presetProtocolParameters: protocolParameters,
    } as any);
    console.log('[startup] Lucid constructed successfully');

    console.log('[startup] Querying Ogmios system start');
    let chainZeroTime = Lucid.SLOT_CONFIG_NETWORK[network].zeroTime;
    try {
      chainZeroTime = await retryWithBackoff(
        () => querySystemStart(configService.get('ogmiosEndpoint')),
        'Ogmios system start query',
      );
      console.log('[startup] Ogmios system start loaded');
    } catch (error) {
      const fallbackPreprodZeroTime = Date.parse('2022-06-01T00:00:00Z');
      if (network === 'Preprod') {
        chainZeroTime = fallbackPreprodZeroTime;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[startup] Falling back to configured slot zero time for ${network}: ${chainZeroTime} (${message})`,
      );
    }
    Lucid.SLOT_CONFIG_NETWORK[network].zeroTime = chainZeroTime;
    Lucid.SLOT_CONFIG_NETWORK[network].slotLength = 1000;
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
