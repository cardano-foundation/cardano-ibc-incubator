import {
  Kupmios,
  Lucid,
  Network,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import { querySystemStart } from "../src/utils.ts";

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!deployerSk || !kupoUrl || !ogmiosUrl || !cardanoNetworkMagic) {
  throw new Error(
    "Missing required env for wallet UTxO probe: DEPLOYER_SK, KUPO_URL, OGMIOS_URL, CARDANO_NETWORK_MAGIC",
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

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;

const protocolParameters = await provider.getProtocolParameters();
const lucid = await Lucid(
  provider,
  cardanoNetwork,
  {
    presetProtocolParameters: protocolParameters,
  } as any,
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
