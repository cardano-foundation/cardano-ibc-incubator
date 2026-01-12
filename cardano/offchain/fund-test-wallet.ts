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

// First, generate the test wallet address using Lucid with the same mnemonic
const testLucid = await Lucid(provider, "Preview");
testLucid.selectWallet.fromSeed("test walk nut penalty hip pave soap entry language right filter choice", { addressType: 'Enterprise' });
const testWalletAddr = await testLucid.wallet().address();

console.log("Test wallet address:", testWalletAddr);
console.log("Sending 10 ADA to test wallet...");

const tx = lucid.newTx().pay.ToAddress(testWalletAddr, { lovelace: 10_000_000n });

const [, , txSignBuilder] = await tx.chain();
const signedTx = await txSignBuilder.sign.withWallet().complete();
const txHash = await signedTx.submit();

console.log("Transaction submitted:", txHash);
