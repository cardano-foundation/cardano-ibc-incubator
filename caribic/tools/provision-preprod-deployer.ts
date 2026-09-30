#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
// Provisions a Cardano public-testnet deployer key used as DEPLOYER_SK.
//
// - Generates a bech32 ed25519 private key (the `ed25519_sk1...` format DEPLOYER_SK
//   expects, matching the Lucid wallet used by cardano/offchain/index.ts) or reuses
//   an existing one under ~/.caribic/.
// - Derives the Cardano testnet enterprise address for the selected network and
//   requests faucet funds (automatically when a faucet API key is set, otherwise
//   via the web UI).
// - Polls Blockfrost until the address is funded, then prints the export line.
//
// Usage:
//   deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-preprod-deployer.ts [--network preprod|preview] [--no-wait]

import { ed25519 } from "npm:@noble/curves@1.6.0/ed25519";
import { blake2b } from "npm:@noble/hashes@1.5.0/blake2b";
import { bech32 } from "npm:bech32@2.0.0";

type CardanoTestNetwork = "preprod" | "preview";

type Options = {
  network: CardanoTestNetwork;
  noWait: boolean;
  keyPath?: string;
  help: boolean;
};

type NetworkProfile = {
  network: CardanoTestNetwork;
  label: string;
  keyPath: string;
  faucetUrl: string;
  faucetApiKeyEnv: string;
  blockfrostUrl: string;
};

const SUPPORTED_NETWORKS = ["preprod", "preview"] as const;
const FAUCET_WEB_URL = "https://docs.cardano.org/cardano-testnets/tools/faucet";
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 120; // 30 minutes

function usage(): string {
  return `Usage:
  deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-preprod-deployer.ts [options]

Options:
  --network <preprod|preview>  Cardano testnet to fund/poll (default: preprod)
  --key-path <path>            Override output key path
  --no-wait                    Skip balance polling after faucet instructions/request
  -h, --help                   Show this help

Environment:
  CARDANO_<NETWORK>_FAUCET_API_KEY  Network-specific faucet API key, e.g. CARDANO_PREVIEW_FAUCET_API_KEY
  CARDANO_FAUCET_API_KEY            Fallback faucet API key used when the network-specific key is unset
  CARDANO_BLOCKFROST_PROJECT_ID     Blockfrost project id for the selected network
`;
}

function parseNetwork(raw: string | undefined): CardanoTestNetwork {
  if (!raw || raw.startsWith("--")) {
    throw new Error(
      `--network requires one of: ${
        SUPPORTED_NETWORKS.join(", ")
      }\n\n${usage()}`,
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (SUPPORTED_NETWORKS.includes(normalized as CardanoTestNetwork)) {
    return normalized as CardanoTestNetwork;
  }
  throw new Error(
    `Unsupported Cardano network '${raw}'. Expected one of: ${
      SUPPORTED_NETWORKS.join(", ")
    }.`,
  );
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value\n\n${usage()}`);
  }
  return value;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    network: "preprod",
    noWait: false,
    help: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--no-wait") {
      options.noWait = true;
    } else if (arg === "--network") {
      options.network = parseNetwork(args[++index]);
    } else if (arg.startsWith("--network=")) {
      options.network = parseNetwork(arg.slice("--network=".length));
    } else if (arg === "--key-path" || arg === "--output") {
      options.keyPath = requireValue(arg, args[++index]);
    } else if (arg.startsWith("--key-path=")) {
      options.keyPath = requireValue(
        "--key-path",
        arg.slice("--key-path=".length),
      );
    } else if (arg.startsWith("--output=")) {
      options.keyPath = requireValue("--output", arg.slice("--output=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

function homeDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error(
      "HOME is not set; pass --key-path to choose an explicit output location.",
    );
  }
  return home;
}

function networkProfile(
  network: CardanoTestNetwork,
  keyPath?: string,
): NetworkProfile {
  return {
    network,
    label: network === "preprod" ? "Preprod" : "Preview",
    keyPath: keyPath ?? `${homeDir()}/.caribic/${network}-deployer.sk`,
    faucetUrl: `https://faucet.${network}.world.dev.cardano.org/send-money`,
    faucetApiKeyEnv: `CARDANO_${network.toUpperCase()}_FAUCET_API_KEY`,
    blockfrostUrl: Deno.env.get("CARDANO_BLOCKFROST_ENDPOINT")?.trim() ||
      `https://cardano-${network}.blockfrost.io/api/v0`,
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const separatorIndex = filePath.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return;
  }
  await Deno.mkdir(filePath.slice(0, separatorIndex), { recursive: true });
}

async function loadOrGenerateKey(keyPath: string): Promise<string> {
  try {
    const existing = (await Deno.readTextFile(keyPath)).trim();
    if (existing.startsWith("ed25519_sk1")) {
      console.log(`Reusing existing deployer key at ${keyPath}`);
      return existing;
    }
  } catch {
    // no existing key, generate one below
  }

  const seed = crypto.getRandomValues(new Uint8Array(32));
  const key = bech32.encode("ed25519_sk", bech32.toWords(seed));
  await ensureParentDirectory(keyPath);
  await Deno.writeTextFile(keyPath, `${key}\n`);
  await Deno.chmod(keyPath, 0o600);
  console.log(`Generated new deployer key at ${keyPath}`);
  return key;
}

function decodePrivateKey(privateKey: string): Uint8Array {
  const decoded = bech32.decode(privateKey, 1023);
  if (decoded.prefix !== "ed25519_sk") {
    throw new Error(`Expected ed25519_sk private key, got ${decoded.prefix}`);
  }
  const seed = new Uint8Array(bech32.fromWords(decoded.words));
  if (seed.length !== 32) {
    throw new Error(`Expected 32-byte ed25519 seed, got ${seed.length} bytes`);
  }
  return seed;
}

// Enterprise (payment-only) Cardano testnet address, the address type Lucid uses
// for private-key wallets. Both preprod and preview use address network id 0:
// header 0x60 (enterprise, network id 0) + blake2b-224 of the public key.
function deriveAddress(privateKey: string): string {
  const seed = decodePrivateKey(privateKey);
  const publicKey = ed25519.getPublicKey(seed);
  const paymentKeyHash = blake2b(publicKey, { dkLen: 28 });
  const addressBytes = new Uint8Array([0x60, ...paymentKeyHash]);
  return bech32.encode("addr_test", bech32.toWords(addressBytes), 1023);
}

function blockfrostProjectId(network: CardanoTestNetwork): string | undefined {
  return (Deno.env.get("CARDANO_BLOCKFROST_PROJECT_ID") ??
    Deno.env.get(`BLOCKFROST_PROJECT_ID_${network.toUpperCase()}`) ??
    Deno.env.get("BLOCKFROST_PROJECT_ID"))?.trim() || undefined;
}

function blockfrostHeaders(
  network: CardanoTestNetwork,
): Record<string, string> {
  const projectId = blockfrostProjectId(network);
  if (!projectId) {
    throw new Error(
      "CARDANO_BLOCKFROST_PROJECT_ID is required to poll the deployer balance",
    );
  }
  return { project_id: projectId };
}

async function queryBalanceLovelace(
  profile: NetworkProfile,
  address: string,
): Promise<bigint> {
  const response = await fetch(
    `${profile.blockfrostUrl.replace(/\/+$/, "")}/addresses/${address}`,
    {
      headers: blockfrostHeaders(profile.network),
    },
  );
  if (response.status === 404) return 0n;
  if (!response.ok) {
    throw new Error(`${profile.label} Blockfrost returned ${response.status}`);
  }
  const info = await response.json() as {
    amount?: { unit?: string; quantity?: string }[];
  };
  const lovelace = info.amount?.find((entry) => entry.unit === "lovelace")
    ?.quantity;
  if (lovelace === undefined) {
    throw new Error("Blockfrost omitted the address's lovelace balance");
  }
  return BigInt(lovelace);
}

async function requestFaucetFunds(
  profile: NetworkProfile,
  address: string,
): Promise<void> {
  const apiKey = Deno.env.get(profile.faucetApiKeyEnv) ??
    Deno.env.get("CARDANO_FAUCET_API_KEY");
  if (!apiKey) {
    console.log(
      `\nNeither ${profile.faucetApiKeyEnv} nor CARDANO_FAUCET_API_KEY is set; request funds manually:`,
    );
    console.log(`  1. Open ${FAUCET_WEB_URL}`);
    console.log(`  2. Select the '${profile.label}' network`);
    console.log(`  3. Paste this address: ${address}\n`);
    return;
  }

  const response = await fetch(
    `${profile.faucetUrl}/${address}?api_key=${apiKey}`,
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

async function run(): Promise<void> {
  const options = parseArgs(Deno.args);
  if (options.help) {
    console.log(usage());
    return;
  }

  const profile = networkProfile(options.network, options.keyPath);
  const privateKey = await loadOrGenerateKey(profile.keyPath);
  const address = deriveAddress(privateKey);
  console.log(`Deployer address (${profile.network}): ${address}`);

  const initialBalance = options.noWait && !blockfrostProjectId(profile.network)
    ? 0n
    : await queryBalanceLovelace(profile, address);
  if (initialBalance > 0n) {
    console.log(
      `Address already funded on ${profile.network}: ${initialBalance} lovelace`,
    );
  } else {
    await requestFaucetFunds(profile, address);
    if (options.noWait) {
      console.log("Skipping balance polling (--no-wait).");
    } else {
      console.log(
        `Waiting for ${profile.network} funds to arrive (checking Blockfrost every 15s)...`,
      );
      let funded = false;
      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const balance = await queryBalanceLovelace(profile, address).catch(() =>
          0n
        );
        if (balance > 0n) {
          console.log(`Funded: ${balance} lovelace`);
          funded = true;
          break;
        }
        console.log(`  [${attempt}/${MAX_POLL_ATTEMPTS}] not funded yet`);
      }
      if (!funded) {
        console.error(
          "Timed out waiting for faucet funds. Re-run to keep waiting.",
        );
        Deno.exit(1);
      }
    }
  }

  console.log(
    "\nNext step — export the key before starting caribic or Cardano offchain tooling:",
  );
  console.log(`  export DEPLOYER_SK=$(cat ${profile.keyPath})`);
}

await run();
