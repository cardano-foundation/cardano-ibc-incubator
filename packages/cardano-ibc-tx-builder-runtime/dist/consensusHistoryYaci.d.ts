import type { UTxO } from "@lucid-evolution/lucid";
import { type HistoryDeployment, type HistorySource } from "./consensusHistoryRecovery.ts";
/** An exclusively leased connection, e.g. pg PoolClient, NOT Pool.query. */
export interface YaciHistorySqlClient {
    query(sql: string, values?: unknown[]): Promise<{
        rows: unknown[];
    }>;
}
/** Discover creation from canonical raw history, never an application cache. */
export declare function discoverYaciHistoryBootstrap(client: YaciHistorySqlClient, deployment: Pick<HistoryDeployment, "clientToken" | "stateAddress">): Promise<HistoryDeployment["bootstrap"]>;
/**
 * Read canonical historical state transactions directly from Yaci's raw tables.
 * Spent address_utxo rows and transaction_cbor must be retained. No bridge
 * projection, application snapshot, schema changes or new dependencies are used.
 *
 * Resume inclusively from a checkpoint authenticated against the same read
 * snapshot as its subsequent pages. Only a missing/replaced canonical block is
 * an intersection failure: lag or incomplete transaction evidence is not a fork.
 * Intermediate replay checkpoints may be retained, but consume the iterator
 * completely before publishing an index: after COMMIT it rechecks the captured
 * block against a fresh database snapshot. The recovery caller must additionally
 * compare independently read live NFT anchors before publishing. This adapter
 * does not authenticate the database itself.
 * Body-only CBOR is paired with the canonical transaction.invalid flag, never a
 * synthesized full transaction. NULL or invalid flags fail closed.
 * The caller owns/release()s the idle connection; do not share it or begin an
 * outer transaction during iteration.
 * If ROLLBACK fails, discard the connection; this source refuses further reads.
 */
export declare function createYaciHistorySource(client: YaciHistorySqlClient, deployment: HistoryDeployment, readCurrentState: () => Promise<UTxO>, options?: {
    pageSize?: number;
}): HistorySource;
