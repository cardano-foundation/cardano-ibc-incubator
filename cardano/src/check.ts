import { Kupmios, Lucid } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { load } from "https://deno.land/std@0.213.0/dotenv/mod.ts";
import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { ClientDatum } from "./types/client_datum.ts";

let spendClientAddress = Deno.args[0];

if (Deno.args.length < 1) {
  spendClientAddress =
    "addr_test1wppdu5hwndn4dxdz37te8a5qyyvpcydd24a97wxxs4hw4ecddq98k";
} else {
  spendClientAddress = Deno.args[0];
}

const env = await load();

const deployerSk = env["DEPLOYER_SK"];
const kupoUrl = env["KUPO_URL"];
const ogmiosUrl = env["OGMIOS_URL"];

console.log(deployerSk, kupoUrl, ogmiosUrl);

if (!deployerSk || !kupoUrl || !ogmiosUrl) {
  throw new Error("Unable to load environment variables");
}

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const lucid = await Lucid.new(provider, "Preview");
lucid.selectWalletFromPrivateKey(deployerSk);

const clientUtxos = await lucid.utxosAt(spendClientAddress);

clientUtxos.forEach((utxo) => {
  console.log(Data.from(utxo.datum!, ClientDatum));
});
