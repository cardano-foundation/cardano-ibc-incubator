import { ConfigService } from '@nestjs/config';
import { querySystemStart, queryTransactionInclusionBlockHeight } from '../../helpers/time';
import { Network } from '@lucid-evolution/lucid';
import { applyDoubleCborEncoding } from '@lucid-evolution/utils';
import { writeFileSync } from 'fs';
import {
  installManagedCardanoAuthFetch,
  resolveManagedKupmiosHeaders,
  resolveManagedOgmiosHttpEndpoint,
} from '../../helpers/managed-cardano-endpoints';
export const LUCID_CLIENT = 'LUCID_CLIENT';
export const LUCID_IMPORTER = 'LUCID_IMPORTER';

const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;
const PROTOCOL_PARAMETERS_MAX_ATTEMPTS = 5;
const PROTOCOL_PARAMETERS_BASE_DELAY_MS = 1000;
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

function computeJitteredBackoffDelayMs(failedAttempt: number): number {
  const backoffDelay =
    PROTOCOL_PARAMETERS_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.round(backoffDelay * jitterMultiplier);
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

const KUPMIOs_LOOKUP_ATTEMPTS = 5;
const KUPMIOS_LOOKUP_BASE_DELAY_MS = 300;

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

  while (attempt <= KUPMIOs_LOOKUP_ATTEMPTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} GET ${url}${body ? `: ${body}` : ''}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= KUPMIOs_LOOKUP_ATTEMPTS) {
        break;
      }
      const delayMs = KUPMIOS_LOOKUP_BASE_DELAY_MS * 2 ** (attempt - 1);
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

  const result = await fetchJson<KupoDatum>(`${kupoEndpoint}/datums/${datumHash}`, headers);
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

  const utxos: any[] = [];
  for (const match of filteredMatches) {
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

export const LucidClient = {
  provide: LUCID_CLIENT,
  useFactory: async (configService: ConfigService) => {
    // Dynamically import Lucid library
    const Lucid = await (eval(`import('@lucid-evolution/lucid')`) as Promise<typeof import('@lucid-evolution/lucid')>);
    // Create Lucid provider and instance
    const kupoEndpoint = configService.get('kupoEndpoint');
    const ogmiosEndpoint = resolveManagedOgmiosHttpEndpoint(
      configService.get('ogmiosEndpoint'),
      configService.get('ogmiosApiKey'),
    );
    const kupmiosHeaders = resolveManagedKupmiosHeaders(
      kupoEndpoint,
      configService.get('kupoApiKey'),
      ogmiosEndpoint,
      configService.get('ogmiosApiKey'),
    );

    installManagedCardanoAuthFetch(
      configService.get('kupoEndpoint'),
      configService.get('kupoApiKey'),
      configService.get('ogmiosEndpoint'),
      configService.get('ogmiosApiKey'),
    );

    const provider: any = new Lucid.Kupmios(kupoEndpoint, ogmiosEndpoint, kupmiosHeaders);
    console.log(
      `[startup] Lucid provider endpoints kupo=${kupoEndpoint} ogmiosHttp=${ogmiosEndpoint} ogmiosWs=${configService.get('ogmiosEndpoint')}`,
    );
    const originalGetUtxosByOutRef = provider.getUtxosByOutRef?.bind(provider);
    if (typeof originalGetUtxosByOutRef === 'function') {
      provider.getUtxosByOutRef = async (
        outRefs: Array<{ txHash: string; outputIndex: number }>,
      ) => {
        try {
          return await fetchKupoUtxosByOutRef(
            kupoEndpoint,
            outRefs,
            kupmiosHeaders?.kupoHeader,
          );
        } catch (error) {
          console.warn(
            `[startup] custom Kupo out-ref lookup failed, falling back to provider default: ${summarizeError(error)}`,
          );
          return await originalGetUtxosByOutRef(outRefs);
        }
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
          return await originalEvaluateTx(tx, additionalUTxOs);
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
