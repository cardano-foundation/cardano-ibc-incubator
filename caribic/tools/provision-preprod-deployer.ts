#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
// Provisions the Cardano preprod deployer key used by `caribic start --network preprod`.
//
// - Generates a bech32 ed25519 private key (the `ed25519_sk1...` format DEPLOYER_SK
//   expects, matching the Lucid wallet used by cardano/offchain/index.ts) or reuses
//   an existing one at ~/.caribic/preprod-deployer.sk.
// - Derives the preprod enterprise address and requests funds from the faucet
//   (automatically when CARDANO_FAUCET_API_KEY is set, otherwise via the web UI).
// - Polls Koios until the address is funded, then prints the export line.
//
// Usage:
//   deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-preprod-deployer.ts [--no-wait]

import { ed25519 } from "npm:@noble/curves@1.6.0/ed25519";
import { blake2b } from "npm:@noble/hashes@1.5.0/blake2b";
import { bech32 } from "npm:bech32@2.0.0";

const KEY_PATH = `${Deno.env.get("HOME")}/.caribic/preprod-deployer.sk`;
const FAUCET_URL = "https://faucet.preprod.world.dev.cardano.org/send-money";
const FAUCET_WEB_URL = "https://docs.cardano.org/cardano-testnets/tools/faucet";
const KOIOS_ADDRESS_INFO_URL = "https://preprod.koios.rest/api/v1/address_info";
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 120; // 30 minutes

const noWait = Deno.args.includes("--no-wait");

async function loadOrGenerateKey(): Promise<string> {
  try {
    const existing = (await Deno.readTextFile(KEY_PATH)).trim();
    if (existing.startsWith("ed25519_sk1")) {
      console.log(`Reusing existing deployer key at ${KEY_PATH}`);
      return existing;
    }
  } catch {
    // no existing key, generate one below
  }
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const key = bech32.encode("ed25519_sk", bech32.toWords(seed));
  await Deno.mkdir(KEY_PATH.substring(0, KEY_PATH.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(KEY_PATH, `${key}\n`);
  await Deno.chmod(KEY_PATH, 0o600);
  console.log(`Generated new deployer key at ${KEY_PATH}`);
  return key;
}

// Enterprise (payment-only) preprod address, the address type Lucid uses for
// private-key wallets: header 0x60 (enterprise, network id 0) + blake2b-224 of
// the public key.
function deriveAddress(privateKey: string): string {
  const seed = new Uint8Array(bech32.fromWords(bech32.decode(privateKey).words));
  const publicKey = ed25519.getPublicKey(seed);
  const paymentKeyHash = blake2b(publicKey, { dkLen: 28 });
  const addressBytes = new Uint8Array([0x60, ...paymentKeyHash]);
  return bech32.encode("addr_test", bech32.toWords(addressBytes), 1023);
}

async function queryBalanceLovelace(address: string): Promise<bigint> {
  const response = await fetch(KOIOS_ADDRESS_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ _addresses: [address] }),
  });
  if (!response.ok) {
    throw new Error(`Koios returned ${response.status}`);
  }
  const info = await response.json();
  return BigInt(info[0]?.balance ?? "0");
}

async function requestFaucetFunds(address: string): Promise<void> {
  const apiKey = Deno.env.get("CARDANO_FAUCET_API_KEY");
  if (!apiKey) {
    console.log("\nCARDANO_FAUCET_API_KEY is not set, request funds manually:");
    console.log(`  1. Open ${FAUCET_WEB_URL}`);
    console.log("  2. Select the 'Preprod' network");
    console.log(`  3. Paste this address: ${address}\n`);
    return;
  }
  const response = await fetch(
    `${FAUCET_URL}/${address}?api_key=${apiKey}`,
    { method: "POST" },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(
      `Faucet request failed (${response.status}): ${JSON.stringify(result)}`,
    );
    console.log(`Fall back to the web faucet: ${FAUCET_WEB_URL}`);
    return;
  }
  console.log(`Faucet request accepted: ${JSON.stringify(result)}`);
}

const privateKey = await loadOrGenerateKey();
const address = deriveAddress(privateKey);
console.log(`Deployer address (preprod): ${address}`);

const initialBalance = await queryBalanceLovelace(address).catch(() => 0n);
if (initialBalance > 0n) {
  console.log(`Address already funded: ${initialBalance} lovelace`);
} else {
  await requestFaucetFunds(address);
  if (noWait) {
    console.log("Skipping balance polling (--no-wait).");
  } else {
    console.log("Waiting for funds to arrive (checking Koios every 15s)...");
    let funded = false;
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const balance = await queryBalanceLovelace(address).catch(() => 0n);
      if (balance > 0n) {
        console.log(`Funded: ${balance} lovelace`);
        funded = true;
        break;
      }
      console.log(`  [${attempt}/${MAX_POLL_ATTEMPTS}] not funded yet`);
    }
    if (!funded) {
      console.error("Timed out waiting for faucet funds. Re-run to keep waiting.");
      Deno.exit(1);
    }
  }
}

console.log("\nNext step — export the key before starting caribic:");
console.log(`  export DEPLOYER_SK=$(cat ${KEY_PATH})`);
