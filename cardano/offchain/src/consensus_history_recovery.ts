import {
  CML,
  Constr,
  coreToUtxo,
  Data,
  type UTxO,
} from "@lucid-evolution/lucid";
import { DatabaseSync } from "node:sqlite";
import { Buffer } from "node:buffer";
import { blake2b } from "@noble/hashes/blake2b";
import {
  Cbor,
  CborArray,
  CborBytes,
  CborMap,
  type CborObj,
  CborTag,
  CborUInt,
  LazyCborArray,
} from "@harmoniclabs/cbor";
import {
  type ConsensusHistoryClientToken,
  type ConsensusHistoryHeight,
  consensusHistoryKey,
  type ConsensusHistoryRecord,
  type ConsensusHistoryWitness,
  decodeConsensusHistoryRecord,
  encodeConsensusHistoryRecord,
  recordFromConstr,
} from "./consensus_history_commitment.ts";
import {
  IncrementalIbcTree,
  verifyIbcTreeWitness,
} from "./incremental_ibc_tree.ts";
import { publicClientCommitmentValues } from "./plutus_serialise.ts";

// Decoder for consensus_history_prototype.State, not the production HostState
// protocol. Replay copies MPFS's published-data/incremental-index pattern, not
// its owner authorization or its incompatible Blake2b commitment format.
export interface HistoryDeployment {
  readonly clientToken: ConsensusHistoryClientToken;
  readonly stateAddress: string;
  readonly bootstrap: { readonly txHash: string; readonly outputIndex: number };
}

export interface HistoryPoint {
  readonly txHash: string;
  readonly blockHash: string;
  readonly blockHeight: number;
  readonly slot: number;
  readonly transactionIndex: number;
}

export interface HistoryTransaction extends HistoryPoint {
  readonly cbor: string;
}

/** The saved point is no longer on the source's canonical chain. */
export class HistoryIntersectionError extends Error {}

/** A pinned source snapshot rolled back while it was being consumed. */
export class HistorySnapshotChangedError extends Error {}

export interface HistorySource {
  // Canonical, ordered, full transactions, including spent state outputs. The
  // source must preserve history independently of this disposable database.
  // Resume INCLUSIVELY at an independently checked canonical point. An orphaned
  // point throws HistoryIntersectionError before yielding any transactions.
  // A lagging source must fail without declaring the saved point orphaned.
  transactions(after?: HistoryPoint): AsyncIterable<HistoryTransaction>;
  // Read the unique live NFT output independently of the rebuilt database.
  currentState(): Promise<UTxO>;
}

interface State {
  root: string;
  clientValue: string;
  consensusValue: string;
  record: ConsensusHistoryRecord;
}

interface JournalRow {
  sequence: number;
  tx_hash: string;
  output_index: number;
  block_hash: string;
  block_height: number;
  slot: number;
  transaction_index: number;
  datum: string;
  undo: string;
}

const stored = (data: Data) =>
  Data.to<Data>(data, undefined, { canonical: true });
const ref = (value: { txHash: string; outputIndex: number }) =>
  `${value.txHash}#${value.outputIndex}`;

function fields(data: Data, count: number, label: string): Data[] {
  if (
    !(data instanceof Constr) || data.index !== 0 ||
    data.fields.length !== count
  ) throw new Error(`invalid ${label}`);
  return data.fields;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function natural(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function single(data: Data, label: string): [Data, Data] {
  if (!(data instanceof Map) || data.size !== 1) {
    throw new Error(`${label} must contain exactly the latest checkpoint`);
  }
  return [...data][0];
}

function state(datum: string, deployment: HistoryDeployment): State {
  const [client, root] = fields(Data.from<Data>(datum), 2, "prototype state");
  const [clientDatum, token] = fields(client, 2, "client datum");
  const [clientState, consensus, times, heights] = fields(
    clientDatum,
    4,
    "client state datum",
  );
  const clientFields = fields(clientState, 8, "client state");
  const [height, value] = single(consensus, "consensus states");
  const [timeHeight, time] = single(times, "processing times");
  const [processedHeightKey, processedHeight] = single(
    heights,
    "processing heights",
  );
  if (
    stored(height) !== stored(clientFields[6]) ||
    stored(height) !== stored(timeHeight) ||
    stored(height) !== stored(processedHeightKey)
  ) throw new Error("checkpoint and processing metadata heights disagree");
  const record = recordFromConstr(
    new Constr(0, [token, height, value, time, processedHeight]),
  );
  if (
    record.clientToken.policyId !== deployment.clientToken.policyId ||
    record.clientToken.name !== deployment.clientToken.name
  ) throw new Error("checkpoint belongs to a different client");
  hash(record.consensusState.nextValidatorsHash, "next validators hash");
  hash(record.consensusState.root, "consensus root");
  return {
    root: hash(root, "state root"),
    ...publicClientCommitmentValues(datum),
    record,
  };
}

function mapValue(data: CborObj, key: bigint): CborObj | undefined {
  if (!(data instanceof CborMap)) {
    throw new Error("invalid transaction CBOR map");
  }
  const entries = data.map.filter(({ k }) =>
    k instanceof CborUInt && k.num === key
  );
  if (entries.length > 1) throw new Error("duplicate transaction CBOR field");
  return entries[0]?.v;
}

function transaction(evidence: HistoryTransaction): {
  tx: CML.Transaction;
  rawOutputs: CborObj[];
} {
  hash(evidence.txHash, "transaction hash");
  hash(evidence.blockHash, "block hash");
  natural(evidence.blockHeight, "block height");
  natural(evidence.slot, "slot");
  natural(evidence.transactionIndex, "transaction index");
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(evidence.cbor)) {
    throw new Error("invalid historical transaction CBOR hex");
  }
  let decoded: CML.Transaction;
  let bodyBytes: Uint8Array;
  try {
    const { parsed, offset } = Cbor.parseLazyWithOffset(evidence.cbor);
    if (
      !(parsed instanceof LazyCborArray) || parsed.array.length !== 4 ||
      offset !== evidence.cbor.length / 2
    ) throw new Error("not a complete transaction");
    bodyBytes = parsed.array[0];
    decoded = CML.Transaction.from_cbor_hex(evidence.cbor);
  } catch {
    throw new Error("history requires full transaction CBOR, not just a body");
  }
  // Hash the original body, not a decoded/re-encoded body. In particular CML
  // can normalize tagged bignums inside inline datums while decoding them.
  if (
    Buffer.from(blake2b(bodyBytes, { dkLen: 32 })).toString("hex") !==
      evidence.txHash
  ) {
    throw new Error("historical transaction hash does not match CBOR");
  }
  if (!decoded.is_valid()) {
    throw new Error("phase-2-invalid transaction cannot publish a checkpoint");
  }
  const rawOutputs = mapValue(Cbor.parse(bodyBytes), 1n);
  if (!(rawOutputs instanceof CborArray)) {
    throw new Error("missing transaction outputs");
  }
  return { tx: decoded, rawOutputs: rawOutputs.array };
}

function outputs(
  tx: CML.Transaction,
  evidence: HistoryTransaction,
  unit: string,
  rawOutputs: CborObj[],
): UTxO[] {
  const result: UTxO[] = [];
  const txOutputs = tx.body().outputs();
  for (let i = 0; i < txOutputs.len(); i++) {
    const utxo = coreToUtxo(CML.TransactionUnspentOutput.new(
      CML.TransactionInput.new(
        CML.TransactionHash.from_hex(evidence.txHash),
        BigInt(i),
      ),
      txOutputs.get(i),
    ));
    if (utxo.assets[unit] !== undefined) {
      // Inline Plutus Data is embedded as tag-24 CBOR bytes. Keep those exact
      // bytes so public commitments retain all ledger Data representations.
      const datum = mapValue(rawOutputs[i], 2n);
      if (
        !(datum instanceof CborArray) || datum.array.length !== 2 ||
        !(datum.array[0] instanceof CborUInt) || datum.array[0].num !== 1n ||
        !(datum.array[1] instanceof CborTag) || datum.array[1].tag !== 24n ||
        !(datum.array[1].data instanceof CborBytes)
      ) throw new Error("historical state requires original inline datum CBOR");
      utxo.datum = Buffer.from(datum.array[1].data.bytes).toString("hex");
      result.push(utxo);
    }
  }
  return result;
}

/** A disposable, single-deployment history index with atomic fork recovery. */
export class ConsensusHistoryRecovery {
  readonly #db: DatabaseSync;
  readonly #tree: IncrementalIbcTree;
  readonly #deployment: HistoryDeployment;
  readonly #unit: string;
  readonly #clientKey: string;
  #ready = false;
  #recovering = false;
  #closed = false;
  #checkedDataVersion: number | undefined;
  #publishedRoot: string | undefined;

  constructor(path: string, deployment: HistoryDeployment) {
    this.#deployment = structuredClone(deployment);
    hash(deployment.bootstrap.txHash, "bootstrap transaction hash");
    natural(deployment.bootstrap.outputIndex, "bootstrap output index");
    if (!/^[0-9a-f]{56}$/.test(deployment.clientToken.policyId)) {
      throw new Error("invalid client policy");
    }
    // Match auth.extract_token_sequence's 24-byte prefix and decimal suffix.
    if (!/^(?:[0-9a-f]{2}){25,32}$/.test(deployment.clientToken.name)) {
      throw new Error("invalid client token name");
    }
    const suffix = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(
        deployment.clientToken.name.slice(48).match(/../g)!,
        (pair) => parseInt(pair, 16),
      ),
    );
    if (!/^(0|[1-9][0-9]*)$/.test(suffix)) {
      throw new Error("client token must have a decimal sequence suffix");
    }
    this.#unit = deployment.clientToken.policyId + deployment.clientToken.name;
    this.#clientKey = `clients/07-tendermint-${suffix}/clientState`;
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec(`
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS history_deployment (
          id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS history_journal (
          sequence INTEGER PRIMARY KEY,
          tx_hash TEXT NOT NULL UNIQUE, output_index INTEGER NOT NULL,
          block_hash TEXT NOT NULL, block_height INTEGER NOT NULL,
          slot INTEGER NOT NULL, transaction_index INTEGER NOT NULL,
          datum TEXT NOT NULL, undo TEXT NOT NULL
        );
      `);
      const config = JSON.stringify({
        version: 1,
        clientToken: deployment.clientToken,
        stateAddress: deployment.stateAddress,
        bootstrap: deployment.bootstrap,
      });
      const existing = this.#db.prepare(
        "SELECT config FROM history_deployment WHERE id = 1",
      ).get();
      if (existing && existing.config !== config) {
        throw new Error("history database belongs to a different deployment");
      }
      this.#db.prepare(
        "INSERT OR IGNORE INTO history_deployment VALUES (1, ?)",
      ).run(config);
      this.#tree = new IncrementalIbcTree(this.#db);
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  async recover(
    source: HistorySource,
    options: { maxPasses?: number } = {},
  ): Promise<{
    root: string;
    transactions: number;
    milliseconds: number;
  }> {
    this.open();
    if (this.#recovering) throw new Error("history recovery already running");
    const maxPasses = natural(options.maxPasses ?? 8, "recovery pass limit");
    if (maxPasses < 1) throw new Error("recovery pass limit must be positive");
    this.#recovering = true;
    this.#ready = false;
    const started = performance.now();
    try {
      this.atomic(() => this.checkCache());
      let replayed = 0;
      let passes = 0;
      while (passes < maxPasses) {
        passes++;
        const checkpoint = this.tip();
        const point = checkpoint && this.point(checkpoint);
        let sequence = checkpoint ? checkpoint.sequence - 1 : 0;
        let previous: HistoryTransaction | undefined;
        try {
          for await (const evidence of source.transactions(point)) {
            if (
              point && !previous &&
              (evidence.txHash !== point.txHash ||
                evidence.blockHash !== point.blockHash ||
                evidence.blockHeight !== point.blockHeight ||
                evidence.slot !== point.slot ||
                evidence.transactionIndex !== point.transactionIndex)
            ) {
              throw new Error(
                "history source did not resume at the saved point",
              );
            }
            if (
              previous &&
              (evidence.blockHeight < previous.blockHeight ||
                evidence.slot < previous.slot ||
                (evidence.blockHeight === previous.blockHeight &&
                  (evidence.blockHash !== previous.blockHash ||
                    evidence.slot !== previous.slot ||
                    evidence.transactionIndex <= previous.transactionIndex)))
            ) {
              throw new Error(
                "historical transactions are not in canonical order",
              );
            }
            const { tx, rawOutputs } = transaction(evidence);
            const resuming = point !== undefined && previous === undefined;
            previous = evidence;
            const candidates = outputs(tx, evidence, this.#unit, rawOutputs);
            if (candidates.length === 0) {
              const current = this.row(sequence);
              if (resuming || (current && this.spends(tx, current))) {
                throw new Error(
                  "unsupported history transition without state output",
                );
              }
              continue;
            }
            if (candidates.length !== 1) {
              throw new Error("ambiguous historical state NFT outputs");
            }
            const output = candidates[0];
            this.checkOutput(output);
            sequence++;
            // Commit the tree, exact output and undo together. These durable
            // checkpoints are not permission to serve proofs: publication still
            // requires a fully consumed canonical source and a live root match.
            this.atomic(() => {
              this.checkCache();
              if (resuming) {
                this.matchAnchor(output, this.row(sequence)!);
              } else {
                if ((this.tip()?.sequence ?? 0) !== sequence - 1) {
                  throw new Error(
                    "history database changed during recovery, retry",
                  );
                }
                this.apply(sequence, evidence, tx, output);
                replayed++;
              }
            });
          }
        } catch (error) {
          if (
            error instanceof HistoryIntersectionError && checkpoint && !previous
          ) {
            this.atomic(() => {
              this.checkCache();
              const current = this.tip();
              if (current?.tx_hash !== checkpoint.tx_hash) {
                throw new Error(
                  "history database changed during recovery, retry",
                );
              }
              this.rewind(checkpoint.sequence - 1);
              this.checkCache();
            });
            // Each lost intersection removes one saved point. Deep rollbacks
            // also obey the pass limit and resume on the next recovery call.
            continue;
          }
          if (error instanceof HistorySnapshotChangedError) {
            continue;
          }
          throw error;
        }
        if (!previous) {
          throw new Error(
            "history is missing the bootstrap or saved transaction",
          );
        }
        const tip = this.tip();
        if (!tip) {
          throw new Error("history is missing the bootstrap transaction");
        }
        const anchor = structuredClone(await source.currentState());
        this.checkOutput(anchor);
        if (ref(anchor) !== `${tip.tx_hash}#${tip.output_index}`) continue;
        this.matchAnchor(anchor, tip);
        const fresh = structuredClone(await source.currentState());
        this.checkOutput(fresh);
        if (ref(fresh) !== ref(anchor) || fresh.datum !== anchor.datum) {
          continue;
        }
        this.atomic(() => {
          this.checkCache();
          this.matchAnchor(fresh, this.tip()!);
          this.#publishedRoot = this.#tree.getRoot();
        });
        this.#ready = true;
        return {
          root: this.#publishedRoot!,
          transactions: replayed,
          milliseconds: Math.round(performance.now() - started),
        };
      }
      throw new Error(
        "history has not caught up to the live state, progress saved; retry",
      );
    } finally {
      this.#recovering = false;
    }
  }

  witness(
    token: ConsensusHistoryClientToken,
    height: ConsensusHistoryHeight,
  ): ConsensusHistoryWitness {
    this.open();
    if (!this.#ready || this.#recovering) {
      throw new Error("history has not been matched to the live state");
    }
    if (
      token.policyId !== this.#deployment.clientToken.policyId ||
      token.name !== this.#deployment.clientToken.name
    ) throw new Error("witness requested for a different client");
    this.#db.exec("BEGIN");
    let checkingCache = true;
    try {
      this.checkCache();
      if (this.#tree.getRoot() !== this.#publishedRoot) {
        throw new Error(
          "history changed since live state validation, recover again",
        );
      }
      checkingCache = false;
      const key = consensusHistoryKey(token, height);
      const value = this.#tree.get(key);
      if (value === undefined) throw new Error("historical record not found");
      checkingCache = true;
      const witness = {
        root: this.#tree.getRoot(),
        key,
        value,
        record: decodeConsensusHistoryRecord(value),
        siblings: this.#tree.getSiblings(key),
      };
      if (
        consensusHistoryKey(
            witness.record.clientToken,
            witness.record.height,
          ) !== key ||
        encodeConsensusHistoryRecord(witness.record) !== value ||
        !verifyIbcTreeWitness(key, value, witness.siblings, witness.root)
      ) {
        throw new Error(
          "history cache is inconsistent, rebuild from chain history",
        );
      }
      this.#db.exec("COMMIT");
      return witness;
    } catch (error) {
      if (checkingCache) this.#ready = false;
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (this.#recovering) {
      throw new Error("cannot close during history recovery");
    }
    if (!this.#closed) this.#db.close();
    this.#closed = true;
    this.#ready = false;
  }

  private open(): void {
    if (this.#closed) throw new Error("history database is closed");
  }

  private row(sequence: number): JournalRow | undefined {
    return this.#db.prepare(
      "SELECT * FROM history_journal WHERE sequence = ?",
    ).get(sequence) as JournalRow | undefined;
  }

  private tip(): JournalRow | undefined {
    return this.#db.prepare(
      "SELECT * FROM history_journal ORDER BY sequence DESC LIMIT 1",
    ).get() as JournalRow | undefined;
  }

  private point(row: JournalRow): HistoryPoint {
    return {
      txHash: row.tx_hash,
      blockHash: row.block_hash,
      blockHeight: row.block_height,
      slot: row.slot,
      transactionIndex: row.transaction_index,
    };
  }

  private atomic<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  private checkCache(): void {
    // Own commits leave data_version unchanged. Audit once per connection and
    // again after another connection writes, not once per header. Call inside a
    // transaction so the audit and subsequent reads use one SQLite snapshot.
    const version = this.#db.prepare("PRAGMA data_version").get()!
      .data_version as number;
    if (version !== this.#checkedDataVersion) {
      this.#tree.assertIntegrity();
      this.#checkedDataVersion = version;
    }
    const tip = this.tip();
    const expected = tip
      ? state(tip.datum, this.#deployment).root
      : "00".repeat(32);
    if (this.#tree.getRoot() !== expected) {
      throw new Error(
        "history cache checkpoint is inconsistent, rebuild from chain history",
      );
    }
  }

  private checkOutput(output: UTxO): void {
    hash(output.txHash, "state transaction hash");
    natural(output.outputIndex, "state output index");
    if (
      output.address !== this.#deployment.stateAddress ||
      output.assets[this.#unit] !== 1n || !output.datum ||
      Object.keys(output.assets).some((key) =>
        key !== "lovelace" && key !== this.#unit
      )
    ) throw new Error("invalid authenticated state output");
    state(output.datum, this.#deployment);
  }

  private matchAnchor(anchor: UTxO, tip: JournalRow): void {
    if (
      ref(anchor) !== `${tip.tx_hash}#${tip.output_index}` ||
      anchor.datum !== tip.datum ||
      state(anchor.datum!, this.#deployment).root !== this.#tree.getRoot()
    ) throw new Error("replayed history does not match the live NFT output");
  }

  private spends(tx: CML.Transaction, previous: JournalRow): boolean {
    const inputs = tx.body().inputs();
    for (let i = 0; i < inputs.len(); i++) {
      const input = inputs.get(i);
      if (
        input.transaction_id().to_hex() === previous.tx_hash &&
        input.index() === BigInt(previous.output_index)
      ) return true;
    }
    return false;
  }

  private consensusKey(record: ConsensusHistoryRecord): string {
    return this.#clientKey.replace(
      /clientState$/,
      `consensusStates/${record.height.revisionHeight}`,
    );
  }

  private apply(
    sequence: number,
    evidence: HistoryTransaction,
    tx: CML.Transaction,
    output: UTxO,
  ): void {
    const next = state(output.datum!, this.#deployment);
    const undo: Array<[string, string | null]> = [];
    const put = (key: string, value: string, insert = false) => {
      const old = this.#tree.get(key);
      if (insert && old !== undefined) {
        throw new Error(
          "history transition would overwrite an existing record",
        );
      }
      undo.push([key, old ?? null]);
      this.#tree.set(key, value);
    };
    if (sequence === 1) {
      if (ref(output) !== ref(this.#deployment.bootstrap)) {
        throw new Error("history is missing the configured bootstrap output");
      }
      // Only the two leaves completely disclosed by the initial datum may be
      // present. An opaque pre-seeded root cannot be recovered from history.
      if (this.#tree.getRoot() !== "00".repeat(32)) {
        throw new Error("bootstrap requires an empty history index");
      }
      put(this.#clientKey, next.clientValue, true);
      put(this.consensusKey(next.record), next.consensusValue, true);
    } else {
      const previous = this.row(sequence - 1)!;
      if (!this.spends(tx, previous)) {
        throw new Error("history is missing a predecessor or crosses a fork");
      }
      const old = state(previous.datum, this.#deployment);
      if (
        old.root !== this.#tree.getRoot() ||
        next.record.height.revisionNumber !==
          old.record.height.revisionNumber ||
        next.record.height.revisionHeight <= old.record.height.revisionHeight
      ) throw new Error("unsupported checkpoint transition");
      put(this.#clientKey, next.clientValue);
      put(this.consensusKey(next.record), next.consensusValue, true);
      // Exact metadata from the consumed datum, never wall-clock/block time.
      put(
        consensusHistoryKey(old.record.clientToken, old.record.height),
        encodeConsensusHistoryRecord(old.record),
        true,
      );
    }
    if (this.#tree.getRoot() !== next.root) {
      throw new Error("reconstructed tree differs from the transaction root");
    }
    this.#db.prepare(`
      INSERT INTO history_journal VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sequence,
      evidence.txHash,
      output.outputIndex,
      evidence.blockHash,
      evidence.blockHeight,
      evidence.slot,
      evidence.transactionIndex,
      output.datum!,
      JSON.stringify(undo),
    );
  }

  private rewind(sequence: number): void {
    const rows = this.#db.prepare(
      "SELECT * FROM history_journal WHERE sequence > ? ORDER BY sequence DESC",
    ).all(sequence) as unknown as JournalRow[];
    for (const row of rows) {
      const undo = JSON.parse(row.undo) as Array<[string, string | null]>;
      for (const [key, value] of undo.reverse()) {
        this.#tree.set(key, value ?? "");
      }
      this.#db.prepare("DELETE FROM history_journal WHERE sequence = ?").run(
        row.sequence,
      );
    }
  }
}
