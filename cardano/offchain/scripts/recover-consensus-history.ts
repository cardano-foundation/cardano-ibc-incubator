import type { HistoryDeployment } from "../src/consensus_history_recovery.ts";

const HELP = `Usage:
  recover-consensus-history.ts <deployment.json> <history.sqlite> [<revisionNumber> <revisionHeight>]

One-shot recovery of a client's local proof-backed history index from
canonical Yaci transaction history. The deployment JSON must contain clientToken,
stateAddress, and bootstrap { txHash, outputIndex } (HistoryDeployment format).
Recovery supports the production client datum with its private history root.
The optional height prints a regenerated historical witness after root validation.

Required environment (no default credentials):
  YACI_STORE_ENDPOINT  Base URL for the native Yaci REST API
  KUPO_URL       Kupo endpoint for independently reading the live state NFT
  OGMIOS_URL     Ogmios endpoint used to configure the Kupmios provider

Yaci REST must retain asset and address transaction history and raw block CBOR
from bootstrap. Transaction validity comes from the raw block validity list.
This only writes the specified local SQLite index. It never signs, submits, or
publishes a transaction; it does not activate Gateway integration or watch blocks.
The production index follows one client, not the shared public HostState tree.
Run with Deno --allow-env --allow-read --allow-write --allow-net.
`;

/** Preserve original bigints even if another module installed BigInt.toJSON. */
export function recoveryJson(value: unknown): string {
  return JSON.stringify(value, function (key, converted) {
    const original = this[key];
    return typeof original === "bigint" ? original.toString() : converted;
  }, 2);
}

function environment(name: string, protocols: string[]): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute endpoint URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} has an unsupported URL protocol`);
  }
  return value;
}

function natural(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a nonnegative decimal integer`);
  }
  return BigInt(value);
}

export async function recoverHistoryCommand(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(HELP);
    return;
  }
  if (args.length !== 2 && args.length !== 4) {
    throw new Error("Expected deployment JSON and SQLite paths; use --help");
  }
  const height = args.length === 4
    ? {
      revisionNumber: natural(args[2], "revisionNumber"),
      revisionHeight: natural(args[3], "revisionHeight"),
    }
    : undefined;
  const endpoint = environment("YACI_STORE_ENDPOINT", ["http:", "https:"]);
  const kupo = environment("KUPO_URL", ["http:", "https:"]);
  const ogmios = environment("OGMIOS_URL", ["http:", "https:", "ws:", "wss:"]);
  const deployment: HistoryDeployment = JSON.parse(
    await Deno.readTextFile(args[0]),
  );
  const { ConsensusHistoryRecovery } = await import(
    "../src/consensus_history_recovery.ts"
  );
  // Constructor validates and pins a defensive deployment copy in SQLite.
  const recovery = new ConsensusHistoryRecovery(args[1], deployment);
  let result: unknown;
  try {
    const [{ Kupmios }, { YaciRestClient }, { YaciRestHistory }, { createRestHistorySource }] = await Promise.all([
      import("@lucid-evolution/lucid"),
      import("../../../packages/cardano-ibc-tx-builder-runtime/src/yaciRest.ts"),
      import("../../../packages/cardano-ibc-tx-builder-runtime/src/yaciRestHistory.ts"),
      import("../../../packages/cardano-ibc-tx-builder-runtime/src/consensusHistoryRest.ts"),
    ]);
    const provider = new Kupmios(kupo, ogmios);
    const source = createRestHistorySource(new YaciRestHistory(new YaciRestClient(endpoint)), deployment,
      () => provider.getUtxoByUnit(deployment.clientToken.policyId + deployment.clientToken.name));
    const recovered = await recovery.recover(source);
    result = { ...recovered, ...(height ? { witness: recovery.witness(deployment.clientToken, height) } : {}) };
  } finally {
    recovery.close();
  }
  console.log(recoveryJson(result));
}

if (import.meta.main) {
  try {
    await recoverHistoryCommand(Deno.args);
  } catch (error) {
    // Provider/driver errors can embed endpoints and credentials. Never print
    // raw URLs or stacks; retain useful non-endpoint diagnostic text only.
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(
      "History recovery failed: " + message.replace(
        /(?:postgres(?:ql)?|https?|wss?):\/\/[^\s"'<>)]*/gi,
        "[redacted endpoint]",
      ),
    );
    Deno.exitCode = 1;
  }
}
