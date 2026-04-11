import { Kupmios } from "@lucid-evolution/lucid";
import { buildLucidWithCompatibleProtocolParameters } from "../src/protocol_parameters.ts";

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!deployerSk || !kupoUrl || !ogmiosUrl || !cardanoNetworkMagic) {
  throw new Error(
    "Missing required env for wallet UTxO probe: DEPLOYER_SK, KUPO_URL, OGMIOS_URL, CARDANO_NETWORK_MAGIC",
  );
}

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const lucid = await buildLucidWithCompatibleProtocolParameters(
  provider,
  ogmiosUrl,
  cardanoNetworkMagic,
);
lucid.selectWallet.fromPrivateKey(deployerSk);

const walletAddress = await lucid.wallet().address();
const utxos = await lucid.wallet().getUtxos();

if (utxos.length === 0) {
  throw new Error(
    `No wallet UTxOs are visible yet for ${walletAddress} via ${kupoUrl}`,
  );
}

console.log(
  `Wallet UTxOs visible for ${walletAddress}: ${utxos.length} via ${kupoUrl}`,
);
