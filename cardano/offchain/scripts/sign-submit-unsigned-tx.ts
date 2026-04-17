import { Buffer } from "node:buffer";
import {
  installManagedCardanoAuthFetch,
  resolveManagedKupoUrl,
  resolveManagedOgmiosUrl,
  resolveManagedKupmiosHeaders,
} from "../src/http_auth.ts";
const {
  parseNetwork,
  queryProtocolParametersCompat,
  resolveOgmiosHttpUrl,
  querySystemStart,
  sanitizeProtocolParameters,
} = await import("../src/external_cardano.ts");

const unsignedTxPath = Deno.args[0];
if (!unsignedTxPath) {
  throw new Error("Usage: sign-submit-unsigned-tx.ts <unsigned-tx-base64-file>");
}

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const kupoApiKey = Deno.env.get("KUPO_API_KEY")?.trim();
const ogmiosApiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();
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

installManagedCardanoAuthFetch();
const chainZeroTime = await querySystemStart(ogmiosUrl);
const protocolParameters = sanitizeProtocolParameters(
  await queryProtocolParametersCompat(ogmiosUrl),
);
const { Kupmios, Lucid, SLOT_CONFIG_NETWORK } = await import("@lucid-evolution/lucid");
const { awaitWalletTx } = await import("../src/utils.ts");
const provider = new Kupmios(
  resolveManagedKupoUrl(kupoUrl, kupoApiKey),
  resolveManagedOgmiosUrl(resolveOgmiosHttpUrl(ogmiosUrl), ogmiosApiKey),
  resolveManagedKupmiosHeaders(
    kupoUrl,
    resolveManagedOgmiosUrl(resolveOgmiosHttpUrl(ogmiosUrl), ogmiosApiKey),
    kupoApiKey,
    ogmiosApiKey,
  ),
);
SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
const lucid = await Lucid(
  provider,
  parseNetwork(cardanoNetworkMagic),
  {
    presetProtocolParameters: protocolParameters,
  } as any,
);
lucid.selectWallet.fromPrivateKey(deployerSk);

const signedTx = await lucid.fromTx(resolveUnsignedTxHex(unsignedTxBase64)).sign.withWallet().complete();
// Use the signed body hash as the source of truth so submit retries and
// adoption checks still work if Ogmios accepts the tx but drops the response.
const txHash = signedTx.toHash();
const submittedHash = await signedTx.submit();
if (submittedHash !== txHash) {
  throw new Error(
    `Provider returned tx hash ${submittedHash}, but signed body hash is ${txHash}`,
  );
}
await awaitWalletTx(lucid, txHash, 1000);

console.log(
  JSON.stringify({
    tx_hash: txHash,
  }),
);
