import {
  Kupmios,
  Lucid,
  Network,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import { createDeployment } from "./src/deployment.ts";
import { querySystemStart } from "./src/utils.ts";
import { KUPMIOS_ENV } from "./src/constants.ts";

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!cardanoNetworkMagic) {
  throw new Error(
    "CARDANO_NETWORK_MAGIC is not set in the environment variables",
  );
}

let cardanoNetwork: Network = "Custom";
if (cardanoNetworkMagic === "1") {
  cardanoNetwork = "Preprod";
} else if (cardanoNetworkMagic === "2") {
  cardanoNetwork = "Preview";
} else if (cardanoNetworkMagic === "764824073") {
  cardanoNetwork = "Mainnet";
}

if (!deployerSk || !kupoUrl || !ogmiosUrl) {
  throw new Error("Unable to load environment variables");
}

const DEFAULT_KUPMIOS_SUBMIT_TIMEOUT_MS = 60000;

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const rawValue = Deno.env.get(name);
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `Invalid ${name} value '${rawValue}', using default ${defaultValue}.`,
    );
    return defaultValue;
  }

  return parsed;
}

class KupmiosWithExtendedSubmitTimeout extends Kupmios {
  #ogmiosUrl: string;
  #submitTimeoutMs: number;

  constructor(kupoUrl: string, ogmiosUrl: string, submitTimeoutMs: number) {
    super(kupoUrl, ogmiosUrl);
    this.#ogmiosUrl = ogmiosUrl;
    this.#submitTimeoutMs = submitTimeoutMs;
  }

  override async submitTx(cbor: string): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      this.#submitTimeoutMs,
    );

    try {
      const response = await fetch(this.#ogmiosUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "submitTransaction",
          params: {
            transaction: {
              cbor,
            },
          },
          id: null,
        }),
      });

      const responseBody = await response.text();
      if (!response.ok) {
        throw new Error(
          `submitTransaction HTTP ${response.status}: ${responseBody}`,
        );
      }

      let parsedResponse: any;
      try {
        parsedResponse = JSON.parse(responseBody);
      } catch (_parseError) {
        throw new Error(
          `submitTransaction returned non-JSON response: ${responseBody}`,
        );
      }

      if (parsedResponse.error) {
        const errorCode = parsedResponse.error.code ?? "unknown";
        const errorMessage = parsedResponse.error.message ?? responseBody;
        throw new Error(
          `submitTransaction JSON-RPC error ${errorCode}: ${errorMessage}`,
        );
      }

      const transactionId = parsedResponse?.result?.transaction?.id;
      if (!transactionId) {
        throw new Error(
          `submitTransaction returned no transaction id: ${responseBody}`,
        );
      }

      return transactionId;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(
          `submitTransaction timed out after ${this.#submitTimeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

const MAX_SAFE_COST_MODEL_VALUE = Number.MAX_SAFE_INTEGER;

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
    return parsedValue > 0
      ? MAX_SAFE_COST_MODEL_VALUE
      : -MAX_SAFE_COST_MODEL_VALUE;
  }

  return parsedValue;
}

function sanitizeProtocolParameters(protocolParameters: any): any {
  if (!protocolParameters?.costModels) {
    return protocolParameters;
  }

  let sanitizedEntries = 0;
  const sanitizedCostModels: Record<string, Record<string, number>> = {};

  for (
    const [version, model] of Object.entries(
      protocolParameters.costModels as Record<string, Record<string, unknown>>,
    )
  ) {
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

const kupmiosSubmitTimeoutMs = parsePositiveIntEnv(
  "KUPMIOS_SUBMIT_TIMEOUT_MS",
  DEFAULT_KUPMIOS_SUBMIT_TIMEOUT_MS,
);
const provider = new KupmiosWithExtendedSubmitTimeout(
  kupoUrl,
  ogmiosUrl,
  kupmiosSubmitTimeoutMs,
);
if (kupmiosSubmitTimeoutMs !== 10000) {
  console.log(
    `Using extended Kupmios submit timeout: ${kupmiosSubmitTimeoutMs}ms`,
  );
}
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
const protocolParameters = sanitizeProtocolParameters(
  await provider.getProtocolParameters(),
);

const lucid = await Lucid(
  provider,
  cardanoNetwork,
  {
    presetProtocolParameters: protocolParameters,
  } as any,
);

lucid.selectWallet.fromPrivateKey(deployerSk);

console.log("=".repeat(70));
try {
  await createDeployment(lucid, KUPMIOS_ENV);
} catch (error) {
  console.error("ERR: ", error);
  throw error;
}
