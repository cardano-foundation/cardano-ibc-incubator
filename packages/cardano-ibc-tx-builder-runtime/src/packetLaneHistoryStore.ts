import { DatabaseSync } from "node:sqlite";
import { type Constr, Data, type UTxO } from "@lucid-evolution/lucid";
import { IbcTreeNodeStore } from "./incrementalIbcTree.ts";
import { PacketLaneHistory } from "./packetLaneHistory.ts";
import {
  PacketLaneTree,
  PacketMerkleTree,
  type PacketTreeState,
} from "./packetLaneTree.ts";

export type PacketLaneCheckpoint = {
  unit: string;
  batchPolicy: string;
  history: PacketLaneHistory;
  blockNo: number;
  blockHash: string;
  txIndex: number;
};

export function packetLaneVersion(output: UTxO): bigint {
  const value = (Data.from(output.datum!) as Constr<Data>).fields[4];
  if (typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn) {
    throw new Error("Invalid packet lane version");
  }
  return value;
}

/** Disposable, per-deployment version index over shared immutable SQLite nodes.
 * Canonical block anchors must be rechecked by the history source before reuse.
 */
export class PacketLaneHistoryStore {
  private readonly db: DatabaseSync;
  private readonly nodes: IbcTreeNodeStore;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    // This is a disposable cache. WAL keeps immutable-node writes cheap while
    // SQLite transactions keep checkpoint publication consistent after crashes.
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000",
    );
    this.nodes = new IbcTreeNodeStore(this.db);
    this.db.exec(`CREATE TABLE IF NOT EXISTS packet_lane_versions (
      namespace TEXT NOT NULL, tx_hash TEXT NOT NULL, output_index INTEGER NOT NULL,
      version TEXT NOT NULL, block_no INTEGER NOT NULL, block_hash TEXT NOT NULL,
      tx_index INTEGER NOT NULL, state TEXT NOT NULL, output TEXT NOT NULL,
      PRIMARY KEY (namespace, tx_hash, output_index)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS packet_lane_version_order ON packet_lane_versions(namespace, version DESC, block_no DESC)`);
  }

  empty(unit: string, batchPolicy: string): PacketLaneHistory {
    return new PacketLaneHistory(
      unit,
      batchPolicy,
      new PacketLaneTree(new PacketMerkleTree(this.nodes)),
    );
  }

  find(
    unit: string,
    batchPolicy: string,
    output: UTxO,
  ): PacketLaneCheckpoint | undefined {
    const row = this.db.prepare(
      "SELECT * FROM packet_lane_versions WHERE namespace = ? AND tx_hash = ? AND output_index = ?",
    )
      .get(`${unit}:${batchPolicy}`, output.txHash, output.outputIndex);
    return row ? this.restore(unit, batchPolicy, row) : undefined;
  }

  before(
    unit: string,
    batchPolicy: string,
    version: bigint,
    height: number,
  ): PacketLaneCheckpoint | undefined {
    const row = this.db.prepare(
      "SELECT * FROM packet_lane_versions WHERE namespace = ? AND version <= ? AND block_no <= ? ORDER BY version DESC, block_no DESC LIMIT 1",
    )
      .get(
        `${unit}:${batchPolicy}`,
        version.toString().padStart(20, "0"),
        height,
      );
    return row ? this.restore(unit, batchPolicy, row) : undefined;
  }

  discard(checkpoint: PacketLaneCheckpoint): void {
    const output = checkpoint.history.current()!;
    this.db.prepare(
      "DELETE FROM packet_lane_versions WHERE namespace = ? AND tx_hash = ? AND output_index = ?",
    )
      .run(
        `${checkpoint.unit}:${checkpoint.batchPolicy}`,
        output.txHash,
        output.outputIndex,
      );
  }

  publish(checkpoints: PacketLaneCheckpoint[]): void {
    if (!checkpoints.length) return;
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO packet_lane_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.db.exec("SAVEPOINT packet_versions_publish");
    try {
      for (const checkpoint of checkpoints) {
        const output = checkpoint.history.current()!;
        insert.run(
          `${checkpoint.unit}:${checkpoint.batchPolicy}`,
          output.txHash,
          output.outputIndex,
          packetLaneVersion(output).toString().padStart(20, "0"),
          checkpoint.blockNo,
          checkpoint.blockHash,
          checkpoint.txIndex,
          JSON.stringify(checkpoint.history.at(output).tree.state()),
          JSON.stringify(
            output,
            (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
          ),
        );
      }
      this.db.exec("RELEASE packet_versions_publish");
    } catch (error) {
      this.db.exec(
        "ROLLBACK TO packet_versions_publish; RELEASE packet_versions_publish",
      );
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private restore(
    unit: string,
    batchPolicy: string,
    row: Record<string, unknown>,
  ): PacketLaneCheckpoint {
    const output = JSON.parse(row.output as string) as UTxO;
    output.assets = Object.fromEntries(
      Object.entries(output.assets).map(([key, value]) => [key, BigInt(value)]),
    );
    const state = JSON.parse(row.state as string) as PacketTreeState;
    if (
      [
        state.root,
        state.indices.commitments,
        state.indices.receipts,
        state.indices.acks,
      ].some((value) => !/^[0-9a-f]{64}$/.test(value))
    ) throw new Error("Invalid packet tree checkpoint");
    if (
      output.txHash !== row.tx_hash ||
      output.outputIndex !== row.output_index ||
      packetLaneVersion(output).toString().padStart(20, "0") !== row.version
    ) throw new Error("Packet checkpoint metadata mismatch");
    const tree = new PacketMerkleTree(this.nodes, state);
    if (
      tree.size() !==
        tree.count("commitments") + tree.count("receipts") + tree.count("acks")
    ) {
      throw new Error(
        "Packet checkpoint sequence indices disagree with its root",
      );
    }
    return {
      unit,
      batchPolicy,
      history: PacketLaneHistory.restore(
        unit,
        batchPolicy,
        output,
        new PacketLaneTree(tree),
      ),
      blockNo: Number(row.block_no),
      blockHash: String(row.block_hash),
      txIndex: Number(row.tx_index),
    };
  }
}
