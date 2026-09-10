import type { HistoryDeployment } from "../src/consensus_history_recovery.ts";
import type { YaciHistorySqlClient } from "../src/consensus_history_yaci.ts";

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

Optional environment:
  HISTORY_DB_QUERY_TIMEOUT_MS  Query timeout, default 30000, maximum 600000

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

interface HistoryDatabaseClient extends YaciHistorySqlClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export function historyQueryTimeout(value: string | undefined): number {
  if (value === undefined) return 30_000;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 600_000) {
    throw new Error("HISTORY_DB_QUERY_TIMEOUT_MS must be between 1 and 600000");
  }
  return Number(value);
}

type WaitForDatabase = <T>(operation: () => Promise<T>) => Promise<T>;

/** Own one connection, including errors emitted between SQL queries. */
export async function withHistoryDatabase<T>(
  client: HistoryDatabaseClient,
  operation: (
    sql: YaciHistorySqlClient,
    wait: WaitForDatabase,
  ) => Promise<T>,
): Promise<T> {
  const failed = new AbortController();
  // Keep this listener through shutdown, including errors emitted after end().
  // The closed one-shot client is discarded, never returned to a pool.
  client.on("error", (error) => {
    if (!failed.signal.aborted) {
      failed.abort(new Error("PostgreSQL connection failed", { cause: error }));
    }
  });
  const wait: WaitForDatabase = <V>(
    operation: () => Promise<V>,
  ): Promise<V> => {
    return new Promise<V>((resolve, reject) => {
      const abort = () => reject(failed.signal.reason);
      if (failed.signal.aborted) return abort();
      failed.signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => failed.signal.removeEventListener("abort", abort);
      Promise.resolve().then(() => {
        failed.signal.throwIfAborted();
        return operation();
      }).then((value) => {
        cleanup();
        if (failed.signal.aborted) abort();
        else resolve(value);
      }, (error) => {
        cleanup();
        reject(error);
      });
    });
  };
  let result: T | undefined;
  const errors: unknown[] = [];
  try {
    await wait(() => client.connect());
    result = await operation({
      query: (sql, values) => wait(() => client.query(sql, values)),
    }, wait);
  } catch (error) {
    errors.push(error);
  }
  try {
    // Let recovery unwind first. Racing its entire promise could close SQLite
    // while it was still replaying or attempting to roll back a transaction.
    await client.end();
  } catch (error) {
    errors.push(error);
  }
  if (failed.signal.aborted && !errors.includes(failed.signal.reason)) {
    errors.unshift(failed.signal.reason);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "History database recovery or cleanup failed",
    );
  }
  return result as T;
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
  const queryTimeout = historyQueryTimeout(
    Deno.env.get("HISTORY_DB_QUERY_TIMEOUT_MS"),
  );
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
    // Match cardano/gateway/package-lock.json. Load only on the recovery path,
    // so --help neither reads connection configuration nor opens a connection.
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 15_000,
      query_timeout: queryTimeout,
      statement_timeout: queryTimeout,
    });
    result = await withHistoryDatabase(client, async (sql, wait) => {
      const [{ Kupmios }, { createYaciHistorySource }] = await wait(() =>
        Promise.all([
          import("@lucid-evolution/lucid"),
          import("../src/consensus_history_yaci.ts"),
        ])
      );
      const provider = new Kupmios(kupo, ogmios);
      const unit = deployment.clientToken.policyId +
        deployment.clientToken.name;
      const source = createYaciHistorySource(
        sql,
        deployment,
        () => wait(() => provider.getUtxoByUnit(unit)),
      );
      const recovered = await recovery.recover(source);
      return {
        ...recovered,
        ...(height
          ? { witness: recovery.witness(deployment.clientToken, height) }
          : {}),
      };
    });
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
