import {
  Kupmios,
  Lucid,
  SLOT_CONFIG_NETWORK,
} from "npm:@cuonglv0297/lucid-custom@latest";
import { createDeployment } from "./create_deployment.ts";
import { load } from "https://deno.land/std@0.213.0/dotenv/mod.ts";
import { querySystemStart } from "./utils.ts";
import { KUPMIOS_ENV } from "./constants.ts";

const env = await load();

const deployerSk = env["DEPLOYER_SK"];
const kupoUrl = env["KUPO_URL"];
const ogmiosUrl = env["OGMIOS_URL"];

console.log(deployerSk, kupoUrl, ogmiosUrl);

if (!deployerSk || !kupoUrl || !ogmiosUrl) {
  throw new Error("Unable to load environment variables");
}

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
console.log({ chainZeroTime });

const lucid = await Lucid.new(provider, "Preview");
lucid.selectWalletFromPrivateKey(deployerSk);

console.log("=".repeat(70));
await createDeployment(lucid, provider, KUPMIOS_ENV);
