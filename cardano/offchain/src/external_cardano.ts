const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;
import WebSocket, { type RawData } from "npm:ws";

export function parseNetwork(networkMagic: string) {
  switch (networkMagic) {
    case "1":
      return "Preprod" as const;
    case "2":
      return "Preview" as const;
    case "764824073":
      return "Mainnet" as const;
    default:
      return "Custom" as const;
  }
}

function toSafeCostModelInteger(value: unknown): number {
  let parsedValue: number;

  if (typeof value === "number") {
    parsedValue = value;
  } else if (typeof value === "bigint") {
    parsedValue = Number(value);
  } else if (typeof value === "string") {
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

function parseRatio(value: string): number {
  const [numerator, denominator] = value.split("/").map((entry) =>
    Number.parseFloat(entry)
  );
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error(`Invalid Ogmios ratio value: ${value}`);
  }
  return numerator / denominator;
}

function toCostModelEntries(values: unknown[] | undefined): Record<string, number> {
  return Object.fromEntries(
    (values ?? []).map((value, index) => [
      index.toString(),
      toSafeCostModelInteger(value),
    ]),
  );
}

export function resolveOgmiosHttpUrl(ogmiosUrl: string): string {
  const explicitHttpUrl = Deno.env.get("OGMIOS_HTTP_URL")?.trim();
  if (explicitHttpUrl) {
    return explicitHttpUrl.replace(/\/$/, "");
  }

  try {
    const parsedUrl = new URL(ogmiosUrl);
    if (parsedUrl.protocol === "wss:") {
      parsedUrl.protocol = "https:";
      return parsedUrl.toString().replace(/\/$/, "");
    }
    if (parsedUrl.protocol === "ws:") {
      parsedUrl.protocol = "http:";
      return parsedUrl.toString().replace(/\/$/, "");
    }
  } catch {
    // Fall through and let the caller surface the original URL in errors.
  }

  return ogmiosUrl.replace(/\/$/, "");
}

function resolveOgmiosWsUrl(ogmiosUrl: string): string {
  const explicitWsUrl = Deno.env.get("OGMIOS_WS_URL")?.trim();
  const apiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();
  const rawUrl = explicitWsUrl || ogmiosUrl;

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol === "https:") {
      parsedUrl.protocol = "wss:";
    } else if (parsedUrl.protocol === "http:") {
      parsedUrl.protocol = "ws:";
    }

    if (apiKey && parsedUrl.host.startsWith(`${apiKey}.`)) {
      parsedUrl.host = parsedUrl.host.replace(`${apiKey}.`, "");
    }

    return parsedUrl.toString();
  } catch {
    return rawUrl;
  }
}

function resolveOgmiosWsHeaders(): Record<string, string> | undefined {
  const apiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();
  if (!apiKey) {
    return undefined;
  }

  return {
    "dmtr-api-key": apiKey,
  };
}

function resolveOgmiosWsVariants(ogmiosUrl: string): Array<{
  url: string;
  headers?: Record<string, string>;
}> {
  const rawUrl = resolveOgmiosWsUrl(ogmiosUrl);
  const apiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();
  const defaultHeaders = resolveOgmiosWsHeaders();
  const variants: Array<{
    url: string;
    headers?: Record<string, string>;
  }> = [];
  const seen = new Set<string>();

  const pushVariant = (
    url: string,
    headers?: Record<string, string>,
  ) => {
    const dedupeKey = `${url}|${JSON.stringify(headers ?? {})}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    variants.push({ url, headers });
  };

  pushVariant(rawUrl);
  pushVariant(rawUrl, defaultHeaders);

  if (apiKey) {
    try {
      const parsedUrl = new URL(rawUrl);
      if (parsedUrl.host.startsWith(`${apiKey}.`)) {
        parsedUrl.host = parsedUrl.host.replace(`${apiKey}.`, "");
        pushVariant(parsedUrl.toString(), defaultHeaders);
      }
    } catch {
      // Keep the direct variants when the managed websocket URL cannot be parsed.
    }
  }

  return variants;
}

export function sanitizeProtocolParameters(protocolParameters: any): any {
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

export async function queryProtocolParametersCompat(ogmiosUrl: string) {
  const { result } = await queryOgmiosJsonRpc(
    ogmiosUrl,
    "queryLedgerState/protocolParameters",
    {},
    20000,
    15,
  );
  const plutusCostModels = result?.plutusCostModels ?? {};
  const plutusV2CostModel = plutusCostModels["plutus:v2"] ?? [];
  return {
    minFeeA: result.minFeeCoefficient,
    minFeeB: result.minFeeConstant.ada.lovelace,
    maxTxSize: result.maxTransactionSize.bytes,
    maxValSize: result.maxValueSize.bytes,
    keyDeposit: BigInt(result.stakeCredentialDeposit.ada.lovelace),
    poolDeposit: BigInt(result.stakePoolDeposit.ada.lovelace),
    drepDeposit: BigInt(result.delegateRepresentativeDeposit?.ada?.lovelace ?? 0),
    govActionDeposit: BigInt(result.governanceActionDeposit?.ada?.lovelace ?? 0),
    priceMem: parseRatio(result.scriptExecutionPrices.memory),
    priceStep: parseRatio(result.scriptExecutionPrices.cpu),
    maxTxExMem: BigInt(result.maxExecutionUnitsPerTransaction.memory),
    maxTxExSteps: BigInt(result.maxExecutionUnitsPerTransaction.cpu),
    coinsPerUtxoByte: BigInt(
      result.utxoCostPerByte ?? result.minUtxoDepositCoefficient,
    ),
    collateralPercentage: result.collateralPercentage,
    maxCollateralInputs: result.maxCollateralInputs,
    minFeeRefScriptCostPerByte: result.minFeeReferenceScripts?.base ?? 0,
    costModels: {
      PlutusV1: toCostModelEntries(plutusCostModels["plutus:v1"]),
      PlutusV2: toCostModelEntries(plutusV2CostModel),
      PlutusV3: toCostModelEntries(plutusCostModels["plutus:v3"] ?? plutusV2CostModel),
    },
  };
}

export async function queryOgmiosJsonRpc(
  ogmiosUrl: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10000,
  attempts = 1,
): Promise<any> {
  let lastError: unknown = null;
  const wsVariants = resolveOgmiosWsVariants(ogmiosUrl);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const wsVariant of wsVariants) {
      const client = new WebSocket(wsVariant.url, {
        headers: wsVariant.headers,
      });

      try {
        return await new Promise<any>((resolve, reject) => {
          let settled = false;
          const timeoutHandle = setTimeout(() => {
            settled = true;
            client.close();
            reject(new Error(`Timed out waiting for ${method} response`));
          }, timeoutMs);

          client.on("open", () => {
            client.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method,
                params,
                id: null,
              }),
            );
          });

          client.on("message", (msg: RawData) => {
            settled = true;
            clearTimeout(timeoutHandle);
            const messageText = typeof msg === "string" ? msg : msg.toString();
            try {
              const payload = JSON.parse(messageText);
              if (payload.error) {
                const errorCode = payload.error.code ?? "unknown";
                const errorMessage = payload.error.message ?? messageText;
                reject(new Error(`${method} JSON-RPC error ${errorCode}: ${errorMessage}`));
                return;
              }
              resolve(payload);
            } catch (error) {
              reject(error);
            } finally {
              client.close();
            }
          });

          client.on("error", (error: Error) => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timeoutHandle);
            reject(error);
          });

          client.on("close", (code: number, reason: unknown) => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timeoutHandle);
            const reasonText = Array.isArray(reason)
              ? reason.map((chunk) => String(chunk)).join("")
              : String(reason);
            reject(
              new Error(
                `WebSocket closed before ${method} returned a response (code=${code}, reason=${reasonText})`,
              ),
            );
          });
        });
      } catch (error) {
        lastError = error;
      } finally {
        if (
          client.readyState === WebSocket.OPEN ||
          client.readyState === WebSocket.CONNECTING
        ) {
          client.close();
        }
      }
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw lastError ?? new Error(`Failed to query ${method}`);
}

export const querySystemStart = async (ogmiosUrl: string) => {
  const { result: systemStart } = await queryOgmiosJsonRpc(
    ogmiosUrl,
    "queryNetwork/startTime",
    {},
    20000,
    15,
  );

  return Date.parse(systemStart);
};
