import {
  Kupmios,
  Lucid,
  Network,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import { createDeployment } from "./src/create_deployment.ts";
import { querySystemStart } from "./src/utils.ts";
import { KUPMIOS_ENV } from "./src/constants.ts";

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!cardanoNetworkMagic) {
  throw new Error("CARDANO_NETWORK_MAGIC is not set in the environment variables");
}

let cardanoNetwork: Network = 'Custom';
if (cardanoNetworkMagic === '1') {
  cardanoNetwork = 'Preprod';
} else if (cardanoNetworkMagic === '2') {
  cardanoNetwork = 'Preview';
} else if (cardanoNetworkMagic === '764824073') {
  cardanoNetwork = 'Mainnet';
}

if (!deployerSk || !kupoUrl || !ogmiosUrl) {
  throw new Error("Unable to load environment variables");
}

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;

const lucid = await Lucid(
  provider,
  cardanoNetwork
);

lucid.selectWallet.fromPrivateKey(deployerSk);

console.log("=".repeat(70));
try {
  await createDeployment(lucid, KUPMIOS_ENV);
} catch (error) {
  console.error("ERR: ", error);
  throw error;
}
