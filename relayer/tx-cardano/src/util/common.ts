import { Blockfrost, Kupmios, Lucid, Network } from "lucid-cardano";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

export function HexStringToByteArray(hexString) {
  if (hexString.length % 2 !== 0) {
    throw "Must have an even number of hex digits to convert to bytes";
  }
  var numBytes = hexString.length / 2;
  var byteArray = new Uint8Array(numBytes);
  for (var i = 0; i < numBytes; i++) {
    byteArray[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  return byteArray;
}

export async function InitLucidBlockfrost() {
  let network: Network = "Preprod";

  if (process.env.NETWORK == "Preview") {
    network = "Preview";
  }

  const lucid = await Lucid.new(
    new Blockfrost(process.env.BLOCKFROST_URL, process.env.PROJECID),
    network
  );
  return lucid;
}

export async function InitLucidKupmios() {
  let network: Network = "Preprod";

  if (process.env.NETWORK == "Preview") {
    network = "Preview";
  }
  const lucid = await Lucid.new(
    new Kupmios(process.env.KUPO_DEV_NET, process.env.OGMIOS_DEV_NET),
    network
  );
  return lucid;
}

export async function InitLucid() {
  if (process.env.USE_DEV_NET == "TRUE") {
    const lucid = await InitLucidKupmios();
    return lucid;
  } else {
    const Lucid = await InitLucidBlockfrost();
    return Lucid;
  }
}
