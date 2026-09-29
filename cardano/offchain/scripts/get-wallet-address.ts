import {
  installManagedCardanoAuthFetch,
  resolveManagedKupmiosHeaders,
  resolveManagedKupoUrl,
  resolveManagedOgmiosUrl,
} from "../src/http_auth.ts";
import { createCardanoScalusEvaluator } from "../src/scalus-evaluator.ts";
const {
  parseNetwork,
  queryProtocolParametersCompat,
  resolveOgmiosHttpUrl,
  queryLocalSlotConfig,
  sanitizeProtocolParameters,
} = await import("../src/external_cardano.ts");

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const kupoApiKey = Deno.env.get("KUPO_API_KEY")?.trim();
const ogmiosApiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!deployerSk || !kupoUrl || !ogmiosUrl || !cardanoNetworkMagic) {
  throw new Error(
    "Missing required env: DEPLOYER_SK, KUPO_URL, OGMIOS_URL, CARDANO_NETWORK_MAGIC",
  );
}

installManagedCardanoAuthFetch();
const protocolParameters = sanitizeProtocolParameters(
  await queryProtocolParametersCompat(ogmiosUrl),
);
const { Kupmios, Lucid, SLOT_CONFIG_NETWORK } = await import(
  "@lucid-evolution/lucid"
);
const provider = new Kupmios(
  resolveManagedKupoUrl(kupoUrl, kupoApiKey),
  resolveManagedOgmiosUrl(resolveOgmiosHttpUrl(ogmiosUrl), ogmiosApiKey),
  resolveManagedKupmiosHeaders(
    kupoUrl,
    resolveManagedOgmiosUrl(resolveOgmiosHttpUrl(ogmiosUrl), ogmiosApiKey),
    kupoApiKey,
    ogmiosApiKey,
  ),
);
const network = parseNetwork(cardanoNetworkMagic);
const slotConfig = network === "Custom"
  ? await queryLocalSlotConfig(ogmiosUrl)
  : SLOT_CONFIG_NETWORK[network];
const lucid = await Lucid(
  provider,
  network,
  {
    presetProtocolParameters: protocolParameters,
    evaluator: createCardanoScalusEvaluator(),
    slotConfig,
  } as any,
);
lucid.selectWallet.fromPrivateKey(deployerSk);

console.log(
  JSON.stringify({
    address: await lucid.wallet().address(),
  }),
);
