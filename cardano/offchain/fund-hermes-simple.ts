import { Kupmios, Lucid, SLOT_CONFIG_NETWORK } from "@lucid-evolution/lucid";
import { querySystemStart } from "./src/utils.ts";

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL") || "http://localhost:1442";
const ogmiosUrl = Deno.env.get("OGMIOS_URL") || "http://localhost:1337";

if (!deployerSk) {
  throw new Error("DEPLOYER_SK is not set");
}

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;

const lucid = await Lucid(provider, "Preview");
lucid.selectWallet.fromPrivateKey(deployerSk);

// Use the Bech32 address from Python output (corrected)
const hermesAddr = "addr_test1qypuya826kt9m4k2dz4zatg20xr46sp685evwgwznr30ntqv9ljvq";

console.log("Sending 50 ADA to Hermes wallet:", hermesAddr);

const tx = lucid.newTx().pay.ToAddress(hermesAddr, { lovelace: 50_000_000n });

const [, , txSignBuilder] = await tx.chain();
const signedTx = await txSignBuilder.sign.withWallet().complete();
const txHash = await signedTx.submit();

console.log("Transaction submitted:", txHash);
