import type { HistoryDeployment } from "../src/consensus_history_recovery.ts";
import {
  createYaciHistorySource,
  type YaciHistorySqlClient,
} from "../src/consensus_history_yaci.ts";

const HELP = `Usage:
  recover-consensus-history.ts <deployment.json> <history.sqlite> [<revisionNumber> <revisionHeight>]

One-shot recovery of the proof-history prototype's local SQLite index from
canonical Yaci transaction history. The deployment JSON must contain clientToken,
stateAddress, and bootstrap { txHash, outputIndex } (HistoryDeployment format).
The optional height prints a regenerated historical witness after root validation.

Required environment (no default credentials):
  HISTORY_DB_URL  PostgreSQL connection URL for a history-retaining Yaci Store
  KUPO_URL       Kupo endpoint for independently reading the live state NFT
  OGMIOS_URL     Ogmios endpoint used to configure the Kupmios provider

Yaci must retain spent address_utxo rows and full transaction_cbor from bootstrap.
This only writes the specified local SQLite index. It never signs, submits, or
publishes a transaction; it does not activate Gateway integration or watch blocks.
Only the combined-output prototype datum is supported, not production HostState.
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

interface LeasedClient extends YaciHistorySqlClient {
  release(destroy?: boolean): void;
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
  const connectionString = environment("HISTORY_DB_URL", [
    "postgres:",
    "postgresql:",
  ]);
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
  let pool:
    | { connect(): Promise<LeasedClient>; end(): Promise<void> }
    | undefined;
  let client: LeasedClient | undefined;
  let result: unknown;
  try {
    // Match cardano/gateway/package-lock.json. Load only on the recovery path,
    // so --help neither reads connection configuration nor opens a connection.
    const { default: pg } = await import("pg");
    pool = new pg.Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 15_000,
    });
    client = await pool!.connect();
    const { Kupmios } = await import("@lucid-evolution/lucid");
    const provider = new Kupmios(kupo, ogmios);
    const unit = deployment.clientToken.policyId + deployment.clientToken.name;
    const source = createYaciHistorySource(
      client,
      deployment,
      () => provider.getUtxoByUnit(unit),
    );
    const recovered = await recovery.recover(source);
    result = {
      ...recovered,
      ...(height
        ? { witness: recovery.witness(deployment.clientToken, height) }
        : {}),
    };
  } finally {
    try {
      recovery.close();
    } finally {
      try {
        // This is a one-shot lease. Destroy it even on failure, avoiding reuse
        // of a connection whose rollback/connection status may be uncertain.
        client?.release(true);
      } finally {
        await pool?.end();
      }
    }
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
