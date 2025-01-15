import {
  Kupmios,
  Lucid,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import { createDeployment } from "./src/create_deployment.ts";
import { querySystemStart } from "./src/utils.ts";
import { KUPMIOS_ENV } from "./src/constants.ts";

(async () => {

  const deployerSk = Deno.env.get("DEPLOYER_SK");
  const kupoUrl = Deno.env.get("KUPO_URL");
  const ogmiosUrl = Deno.env.get("OGMIOS_URL");

  console.log(deployerSk, kupoUrl, ogmiosUrl);

  if (!deployerSk || !kupoUrl || !ogmiosUrl) {
    throw new Error("Unable to load environment variables");
  }

  const provider = new Kupmios(kupoUrl, ogmiosUrl);
  const chainZeroTime = await querySystemStart(ogmiosUrl);
  SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
  console.log({ chainZeroTime });

  const lucid = await Lucid(
    provider,
    "Preview"
  );
  lucid.selectWallet.fromPrivateKey(deployerSk);

  console.log("=".repeat(70));
  try {
    await createDeployment(lucid, provider, KUPMIOS_ENV);
  } catch (error) {
    console.error("ERR: ", error);
    throw error;
  }
})();