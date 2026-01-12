import { Kupmios, Lucid, SLOT_CONFIG_NETWORK } from "@lucid-evolution/lucid";
import { querySystemStart } from "./src/utils.ts";
import { bech32 } from "bech32";

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

// Hermes's actual address (from hermes keys list)
const hermesAddrHex = "0103c274ead5965dd6ca68aa2ead0a79875d403a3d32c721c298e2f9ac";
const addrBytes = Buffer.from(hermesAddrHex, 'hex');
const words = bech32.toWords(addrBytes);
const hermesAddr = bech32.encode('addr_test', words, 1000);

console.log("Hermes address (Bech32):", hermesAddr);
console.log("Sending 50 ADA to Hermes wallet...");

const tx = lucid.newTx().pay.ToAddress(hermesAddr, { lovelace: 50_000_000n });

const [, , txSignBuilder] = await tx.chain();
const signedTx = await txSignBuilder.sign.withWallet().complete();
const txHash = await signedTx.submit();

console.log("Transaction submitted:", txHash);
