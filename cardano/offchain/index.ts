import { Kupmios } from "@lucid-evolution/lucid";
import { createDeployment } from "./src/deployment.ts";
import { KUPMIOS_ENV } from "./src/constants.ts";
import { buildLucidWithCompatibleProtocolParameters } from "./src/protocol_parameters.ts";

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!cardanoNetworkMagic) {
  throw new Error("CARDANO_NETWORK_MAGIC is not set in the environment variables");
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
const lucid = await buildLucidWithCompatibleProtocolParameters(
  provider,
  ogmiosUrl,
  cardanoNetworkMagic,
);

lucid.selectWallet.fromPrivateKey(deployerSk);

console.log("=".repeat(70));
try {
  await createDeployment(lucid, KUPMIOS_ENV);
} catch (error) {
  console.error("ERR: ", error);
  throw error;
}
