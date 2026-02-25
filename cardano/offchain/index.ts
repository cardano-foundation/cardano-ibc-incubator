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

const KUPMIOS_SUBMIT_ATTEMPTS = 6;
const KUPMIOS_SUBMIT_RETRY_DELAY_MS = 2000;

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

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const kupmiosSubmitTx = provider.submitTx.bind(provider);
provider.submitTx = async (cbor: string): Promise<string> => {
  for (let attempt = 1; attempt <= KUPMIOS_SUBMIT_ATTEMPTS; attempt++) {
    try {
      return await kupmiosSubmitTx(cbor);
    } catch (error) {
      if (attempt === KUPMIOS_SUBMIT_ATTEMPTS) {
        throw error;
      }
      console.warn(
        `Kupmios submit retry ${attempt}/${KUPMIOS_SUBMIT_ATTEMPTS} after error:`,
        error,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, KUPMIOS_SUBMIT_RETRY_DELAY_MS)
      );
    }
  }
  throw new Error("Kupmios submit retries exhausted");
};
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
