import { Lucid, Kupmios, SLOT_CONFIG_NETWORK } from "@lucid-evolution/lucid";
import { querySystemStart } from "./src/utils.ts";

const kupoUrl = "http://localhost:1442";
const ogmiosUrl = "http://localhost:1337";
const mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;

const lucid = await Lucid(provider, "Preview");

// Get the wallet's public key
lucid.selectWallet.fromSeed(mnemonic, { addressType: 'Enterprise', accountIndex: 0 });
const addr = await lucid.wallet().address();
const paymentCred = lucid.utils.getAddressDetails(addr).paymentCredential;

console.log("Lucid Enterprise address:", addr);
console.log("Payment credential:", JSON.stringify(paymentCred, null, 2));

// Try to access the public key if possible
const rewardAddr = await lucid.wallet().rewardAddress();
console.log("Reward address:", rewardAddr);
