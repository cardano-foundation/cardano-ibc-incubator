import {
  Lucid,
  type LucidEvolution,
  type Network,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import { querySystemStart } from "./utils.ts";

const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;

export function parseNetwork(networkMagic: string): Network {
  switch (networkMagic) {
    case "1":
      return "Preprod";
    case "2":
      return "Preview";
    case "764824073":
      return "Mainnet";
    default:
      return "Custom";
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

function resolveOgmiosHttpRequestConfig(ogmiosUrl: string): {
  url: string;
  headers: Record<string, string>;
} {
  const apiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();
  let httpUrl = Deno.env.get("OGMIOS_HTTP_URL")?.trim() || ogmiosUrl;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  try {
    const parsedUrl = new URL(httpUrl);
    parsedUrl.protocol = parsedUrl.protocol === "wss:" ? "https:" : parsedUrl.protocol === "ws:" ? "http:" : parsedUrl.protocol;
    httpUrl = parsedUrl.toString();
    // DMTR authenticated hosts already carry the credential in the subdomain.
    if (apiKey && !parsedUrl.host.startsWith(`${apiKey}.`)) {
      headers["Dmtr-api-key"] = apiKey;
    }
  } catch {
    // Keep the original URL if it cannot be parsed; the later fetch error
    // will report the actual failing endpoint.
    if (apiKey) {
      headers["Dmtr-api-key"] = apiKey;
    }
  }

  return { url: httpUrl, headers };
}

export async function queryProtocolParametersCompat(ogmiosUrl: string) {
  const requestConfig = resolveOgmiosHttpRequestConfig(ogmiosUrl);
  const response = await fetch(requestConfig.url, {
    method: "POST",
    headers: requestConfig.headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "queryLedgerState/protocolParameters",
      params: {},
      id: null,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `queryLedgerState/protocolParameters HTTP ${response.status} at ${requestConfig.url}: ${responseText}`,
    );
  }

  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(responseText);
  } catch (_error) {
    throw new Error(
      `queryLedgerState/protocolParameters returned non-JSON response: ${responseText}`,
    );
  }

  if (parsedResponse.error) {
    const errorCode = parsedResponse.error.code ?? "unknown";
    const errorMessage = parsedResponse.error.message ?? responseText;
    throw new Error(
      `queryLedgerState/protocolParameters JSON-RPC error ${errorCode}: ${errorMessage}`,
    );
  }

  const result = parsedResponse.result;
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

export async function buildLucidWithCompatibleProtocolParameters(
  provider: unknown,
  ogmiosUrl: string,
  networkMagic: string,
): Promise<LucidEvolution> {
  const chainZeroTime = await querySystemStart(ogmiosUrl);
  SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
  const protocolParameters = sanitizeProtocolParameters(
    await queryProtocolParametersCompat(ogmiosUrl),
  );

  return await Lucid(
    provider as any,
    parseNetwork(networkMagic),
    {
      presetProtocolParameters: protocolParameters,
    } as any,
  );
}
