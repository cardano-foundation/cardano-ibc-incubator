#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
// Provisions the Injective testnet relayer key used by `caribic keys add --chain injective-888`.
//
// - Generates a BIP-39 mnemonic at the Ethermint HD path m/44'/60'/0'/0/0 (the
//   path Hermes uses for Injective) or reuses an existing one at
//   ~/.caribic/injective-testnet.mnemonic.
// - Derives the inj... address and prints faucet instructions (the Injective
//   testnet faucet is captcha-protected, so funding is a manual step).
// - Polls the public testnet LCD until the address holds INJ, then prints the
//   `caribic keys add` command.
//
// Usage:
//   deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-injective-testnet-key.ts [--no-wait]

import { HDNodeWallet, Mnemonic, getBytes } from "npm:ethers@6.13.4";
import { bech32 } from "npm:bech32@2.0.0";

const MNEMONIC_PATH = `${Deno.env.get("HOME")}/.caribic/injective-testnet.mnemonic`;
const FAUCET_WEB_URL = "https://testnet.faucet.injective.network/";
const LCD_BALANCES_URL =
  "https://testnet.sentry.lcd.injective.network/cosmos/bank/v1beta1/balances";
const HD_PATH = "m/44'/60'/0'/0/0";
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 120; // 30 minutes

const noWait = Deno.args.includes("--no-wait");

async function loadOrGenerateMnemonic(): Promise<string> {
  try {
    const existing = (await Deno.readTextFile(MNEMONIC_PATH)).trim();
    if (Mnemonic.isValidMnemonic(existing)) {
      console.log(`Reusing existing mnemonic at ${MNEMONIC_PATH}`);
      return existing;
    }
  } catch {
    // no existing mnemonic, generate one below
  }
  const phrase = Mnemonic.fromEntropy(crypto.getRandomValues(new Uint8Array(32)))
    .phrase;
  await Deno.mkdir(MNEMONIC_PATH.substring(0, MNEMONIC_PATH.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(MNEMONIC_PATH, `${phrase}\n`);
  await Deno.chmod(MNEMONIC_PATH, 0o600);
  console.log(`Generated new mnemonic at ${MNEMONIC_PATH}`);
  return phrase;
}

function deriveInjectiveAddress(mnemonic: string): string {
  const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, HD_PATH);
  const addressBytes = getBytes(wallet.address);
  return bech32.encode("inj", bech32.toWords(addressBytes));
}

async function queryBalanceInj(address: string): Promise<bigint> {
  const response = await fetch(`${LCD_BALANCES_URL}/${address}`);
  if (!response.ok) {
    throw new Error(`LCD returned ${response.status}`);
  }
  const result = await response.json();
  const injBalance = (result.balances ?? []).find(
    (balance: { denom: string; amount: string }) => balance.denom === "inj",
  );
  return BigInt(injBalance?.amount ?? "0");
}

const mnemonic = await loadOrGenerateMnemonic();
const address = deriveInjectiveAddress(mnemonic);
console.log(`Relayer address (injective-888): ${address}`);

const initialBalance = await queryBalanceInj(address).catch(() => 0n);
if (initialBalance > 0n) {
  console.log(`Address already funded: ${initialBalance} inj (wei)`);
} else {
  console.log("\nRequest testnet funds manually (the faucet is captcha-protected):");
  console.log(`  1. Open ${FAUCET_WEB_URL}`);
  console.log(`  2. Paste this address: ${address}\n`);
  if (noWait) {
    console.log("Skipping balance polling (--no-wait).");
  } else {
    console.log("Waiting for funds to arrive (checking the LCD every 15s)...");
    let funded = false;
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const balance = await queryBalanceInj(address).catch(() => 0n);
      if (balance > 0n) {
        console.log(`Funded: ${balance} inj (wei)`);
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

console.log(
  "\nNext step — AFTER `caribic start --network preprod` has run (it writes the",
);
console.log(
  "injective-888 chain block into ~/.hermes/config.toml, which `keys add` requires),",
);
console.log("register the key with Hermes via caribic:");
console.log(
  `  caribic keys add --chain injective-888 --mnemonic-file ${MNEMONIC_PATH} \\\n    --key-name injective-888-relayer --hd-path "${HD_PATH}" --overwrite`,
);
