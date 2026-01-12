import { Lucid, Kupmios, SLOT_CONFIG_NETWORK } from "@lucid-evolution/lucid";
import { querySystemStart } from "./src/utils.ts";

const kupoUrl = "http://localhost:1442";
const ogmiosUrl = "http://localhost:1337";
const mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;

const lucid = await Lucid(provider, "Preview");

// Test Enterprise
lucid.selectWallet.fromSeed(mnemonic, { addressType: 'Enterprise' });
const enterpriseAddr = await lucid.wallet().address();
console.log("Lucid Enterprise:", enterpriseAddr);

// Test Base (default)
lucid.selectWallet.fromSeed(mnemonic, { addressType: 'Base' });
const baseAddr = await lucid.wallet().address();
console.log("Lucid Base:", baseAddr);

// Test with account index
lucid.selectWallet.fromSeed(mnemonic, { addressType: 'Enterprise', accountIndex: 0 });
const enterpriseAddr0 = await lucid.wallet().address();
console.log("Lucid Enterprise (account 0):", enterpriseAddr0);
