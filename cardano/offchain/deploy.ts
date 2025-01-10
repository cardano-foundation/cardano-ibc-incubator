import {
  Kupmios,
  Lucid,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import { createDeployment } from "./src/create_deployment.ts";
import { load } from "@std/dotenv";
import { querySystemStart } from "./src/utils.ts";
import { KUPMIOS_ENV } from "./src/constants.ts";

const env = await load();

(async () => {
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