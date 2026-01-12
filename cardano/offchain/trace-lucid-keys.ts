import { Lucid, Kupmios, SLOT_CONFIG_NETWORK, C } from "@lucid-evolution/lucid";
import { querySystemStart } from "./src/utils.ts";

const kupoUrl = "http://localhost:1442";
const ogmiosUrl = "http://localhost:1337";
const mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const chainZeroTime = await querySystemStart(ogmiosUrl);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;

const lucid = await Lucid(provider, "Preview");
lucid.selectWallet.fromSeed(mnemonic, { addressType: 'Enterprise', accountIndex: 0 });

const addr = await lucid.wallet().address();
console.log("Lucid address:", addr);

// Try to access the public key via lucid's internal API
try {
  const pubKeyHash = lucid.utils.getAddressDetails(addr);
  console.log("Address details:", JSON.stringify(pubKeyHash, null, 2));
} catch (e) {
  console.log("Could not get address details:", e.message);
}
