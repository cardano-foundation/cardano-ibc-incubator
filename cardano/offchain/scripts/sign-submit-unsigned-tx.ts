import { Buffer } from "node:buffer";
import { Kupmios } from "@lucid-evolution/lucid";
import { buildLucidWithCompatibleProtocolParameters } from "../src/protocol_parameters.ts";

const unsignedTxPath = Deno.args[0];
if (!unsignedTxPath) {
  throw new Error("Usage: sign-submit-unsigned-tx.ts <unsigned-tx-base64-file>");
}

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!deployerSk || !kupoUrl || !ogmiosUrl || !cardanoNetworkMagic) {
  throw new Error(
    "Missing required env: DEPLOYER_SK, KUPO_URL, OGMIOS_URL, CARDANO_NETWORK_MAGIC",
  );
}

const unsignedTxBase64 = (await Deno.readTextFile(unsignedTxPath)).trim();
if (!unsignedTxBase64) {
  throw new Error(`Unsigned transaction file ${unsignedTxPath} is empty`);
}

function resolveUnsignedTxHex(serialized: string): string {
  const normalized = serialized.trim();
  if (/^[0-9a-fA-F]+$/.test(normalized)) {
    return normalized;
  }

  const decoded = Buffer.from(normalized, "base64");
  const decodedText = decoded.toString("utf8").trim();
  if (/^[0-9a-fA-F]+$/.test(decodedText)) {
    return decodedText;
  }

  return decoded.toString("hex");
}

const provider = new Kupmios(kupoUrl, ogmiosUrl);
const lucid = await buildLucidWithCompatibleProtocolParameters(
  provider,
  ogmiosUrl,
  cardanoNetworkMagic,
);
lucid.selectWallet.fromPrivateKey(deployerSk);

const signedTx = await lucid.fromTx(resolveUnsignedTxHex(unsignedTxBase64)).sign.withWallet().complete();
const txHash = await signedTx.submit();
await lucid.awaitTx(txHash, 1000);

console.log(
  JSON.stringify({
    tx_hash: txHash,
  }),
);
