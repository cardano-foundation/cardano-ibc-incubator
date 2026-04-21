import { ConfigService } from '@nestjs/config';
import { querySystemStart, queryTransactionInclusionBlockHeight } from '../../helpers/time';
import { Network } from '@lucid-evolution/lucid';
import { applyDoubleCborEncoding } from '@lucid-evolution/utils';
import { writeFileSync } from 'fs';
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
    if (value == null || depth > 3 || visited.has(value)) {
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

const KUPMIOs_LOOKUP_ATTEMPTS = 10;
const KUPMIOS_LOOKUP_BASE_DELAY_MS = 300;
const KUPMIOS_LOOKUP_MAX_DELAY_MS = 3000;

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
  const requestHeaders = { ...(headers ?? {}) };
  try {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.host.includes('kupo-m1.dmtr.host') &&
      !requestHeaders['dmtr-api-key'] &&
      process.env.KUPO_API_KEY
    ) {
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
          `HTTP ${response.status} GET ${url} authHeader=${requestHeaders['dmtr-api-key'] ? 'set' : 'missing'}${body ? `: ${body}` : ''}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= KUPMIOs_LOOKUP_ATTEMPTS) {
        break;
      }
      const delayMs = Math.min(
        KUPMIOS_LOOKUP_BASE_DELAY_MS * 2 ** (attempt - 1),
        KUPMIOS_LOOKUP_MAX_DELAY_MS,
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
                          ? inputRefs[index] ?? `<missing input for Spend[${index}]>`
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
    const chainZeroTime = await retryWithBackoff(
      () => querySystemStart(configService.get('ogmiosEndpoint')),
      'Ogmios system start query',
    );
    console.log('[startup] Ogmios system start loaded');
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
