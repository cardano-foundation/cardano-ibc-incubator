import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  Cbor,
  CborArray,
  CborBytes,
  CborMap,
  type CborObj,
  CborTag,
  CborUInt,
} from "@harmoniclabs/cbor";
import { Buffer } from "node:buffer";
import { blake2b } from "@noble/hashes/blake2b";
import {
  CML,
  Constr,
  Data,
  type UTxO,
  utxoToCore,
} from "@lucid-evolution/lucid";
import { DatabaseSync } from "node:sqlite";
import {
  consensusHistoryKey,
  type ConsensusHistoryRecord,
  encodeConsensusHistoryRecord,
  recordToConstr,
} from "./consensus_history_commitment.ts";
import {
  ConsensusHistoryRecovery,
  type HistoryDeployment,
  HistoryIntersectionError,
  type HistoryPoint,
  HistorySnapshotChangedError,
  type HistorySource,
  type HistoryTransaction,
} from "./consensus_history_recovery.ts";
import { IncrementalIbcTree } from "./incremental_ibc_tree.ts";
import { publicClientCommitmentValues } from "./plutus_serialise.ts";

// These unsigned transactions test the index's replay rules, not ledger
// acceptance. The companion emulator suite submits signed, script-checked txs.
const token = { policyId: "11".repeat(28), name: "22".repeat(24) + "30" };
const unit = token.policyId + token.name;
const address = CML.EnterpriseAddress.new(
  0,
  CML.Credential.new_script(CML.ScriptHash.from_hex("33".repeat(28))),
).to_address().to_bech32();
const encode = (data: Data) =>
  Data.to<Data>(data, undefined, { canonical: true });
const height = (n: bigint) => new Constr(0, [1n, n]);
const clientKey = "clients/07-tendermint-0/clientState";
const publicKey = (n: bigint) => `clients/07-tendermint-0/consensusStates/${n}`;

interface Publication {
  transaction: HistoryTransaction;
  output: UTxO;
  record: ConsensusHistoryRecord;
}

function publications(heights: bigint[], variant = 0): Publication[] {
  const db = new DatabaseSync(":memory:");
  const tree = new IncrementalIbcTree(db);
  const result: Publication[] = [];
  try {
    for (const n of heights) {
      const record: ConsensusHistoryRecord = {
        clientToken: token,
        height: { revisionNumber: 1n, revisionHeight: n },
        consensusState: {
          timestamp: 1000n + n + (n > 1n ? BigInt(variant) : 0n),
          nextValidatorsHash: "44".repeat(32),
          root: "55".repeat(32),
        },
        processedTime: 2000n + n,
        processedHeight: 10n + n,
      };
      const consensus = recordToConstr(record).fields[2];
      const clientState = new Constr(0, [
        "636861696e2d31",
        new Constr(0, [1n, 3n]),
        100_000n,
        200_000n,
        100n,
        new Constr(0, [0n, 0n]),
        height(n),
        [],
      ]);
      const client = new Constr(0, [
        new Constr(0, [
          clientState,
          new Map([[height(n), consensus]]),
          new Map([[height(n), record.processedTime]]),
          new Map([[height(n), record.processedHeight]]),
        ]),
        new Constr(0, [token.policyId, token.name]),
      ]);
      tree.set(clientKey, encode(clientState));
      tree.set(publicKey(n), encode(consensus));
      const previous = result.at(-1);
      if (previous) {
        tree.set(
          consensusHistoryKey(token, previous.record.height),
          encodeConsensusHistoryRecord(previous.record),
        );
      }
      const output: UTxO = {
        txHash: "00".repeat(32),
        outputIndex: 0,
        address,
        assets: { lovelace: 10_000_000n, [unit]: 1n },
        datum: encode(new Constr(0, [client, tree.getRoot()])),
      };
      const inputs = CML.TransactionInputList.new();
      inputs.add(CML.TransactionInput.new(
        CML.TransactionHash.from_hex(
          previous?.output.txHash ?? "aa".repeat(32),
        ),
        0n,
      ));
      const outputs = CML.TransactionOutputList.new();
      outputs.add(utxoToCore(output).output());
      const body = CML.TransactionBody.new(inputs, outputs, 200_000n);
      const tx = CML.Transaction.new(
        body,
        CML.TransactionWitnessSet.new(),
        true,
      );
      output.txHash = CML.hash_transaction(body).to_hex();
      result.push({
        record,
        output,
        transaction: {
          txHash: output.txHash,
          cbor: tx.to_cbor_hex(),
          blockHeight: result.length + 1,
          blockHash: (result.length + 1).toString(16).padStart(64, "0"),
          slot: result.length + 1,
          transactionIndex: 0,
        },
      });
    }
    return result;
  } finally {
    db.close();
  }
}

function source(items: Publication[]): HistorySource {
  return {
    async *transactions(after) {
      const start = after
        ? items.findIndex(({ transaction: tx }) =>
          tx.txHash === after.txHash && tx.blockHash === after.blockHash &&
          tx.blockHeight === after.blockHeight && tx.slot === after.slot &&
          tx.transactionIndex === after.transactionIndex
        )
        : 0;
      if (start < 0) {
        throw new HistoryIntersectionError("saved point was rolled back");
      }
      for (const item of items.slice(start)) {
        yield structuredClone(item.transaction);
      }
    },
    currentState: () => Promise.resolve(structuredClone(items.at(-1)!.output)),
  };
}

function deployment(first: Publication): HistoryDeployment {
  return {
    clientToken: token,
    stateAddress: address,
    bootstrap: { txHash: first.output.txHash, outputIndex: 0 },
  };
}

Deno.test("recovery replaces an orphaned branch and its metadata atomically", async () => {
  const original = publications([1n, 2n, 3n]);
  const replacement = publications([1n, 2n, 4n], 100);
  assertEquals(original[0].output.txHash, replacement[0].output.txHash);
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(original[0]),
  );
  try {
    await history.recover(source(original));
    assertEquals(
      history.witness(token, original[1].record.height).record,
      original[1].record,
    );
    const result = await history.recover(source(replacement));
    assertEquals(result.transactions, 2);
    assertEquals(
      history.witness(token, replacement[1].record.height).record,
      replacement[1].record,
    );
    assertThrows(() =>
      history.witness(token, { revisionNumber: 1n, revisionHeight: 3n })
    );
    assertEquals((await history.recover(source(replacement))).transactions, 0);
  } finally {
    history.close();
  }
});

Deno.test("interrupted replay saves progress without serving it and can rewind it", async () => {
  const items = publications([1n, 2n, 3n, 4n]);
  const old = items.slice(0, 3);
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(items[0]),
  );
  try {
    const before = await history.recover(source(old));
    const interrupted = source(items);
    interrupted.transactions = async function* (after) {
      yield* source(items).transactions(after);
      throw new Error("historical block source disconnected");
    };
    await assertRejects(
      () => history.recover(interrupted),
      Error,
      "disconnected",
    );
    assertThrows(
      () => history.witness(token, old[1].record.height),
      Error,
      "live state",
    );
    const after = await history.recover(source(old));
    assertEquals(after.root, before.root);
    assertEquals(
      after.transactions,
      0,
      "the orphaned checkpoint is undone without replaying the common ancestor",
    );
    assertThrows(() =>
      history.witness(token, { revisionNumber: 1n, revisionHeight: 3n })
    );
  } finally {
    history.close();
  }
});

Deno.test("recovery rejects reordered or incomplete history and never publishes a moving anchor", async () => {
  const items = publications([1n, 2n, 3n]);
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(items[0]),
  );
  try {
    const incomplete = source([items[0], items[2]]);
    await assertRejects(
      () => history.recover(incomplete),
      Error,
      "predecessor",
    );
    await assertRejects(
      () => history.recover(source([items[1], items[0], items[2]])),
      Error,
      "predecessor",
    );
    const reordered = source(items);
    reordered.transactions = async function* () {
      for (const item of items) {
        yield { ...item.transaction, blockHeight: 1, slot: 1 };
      }
    };
    await assertRejects(
      () => history.recover(reordered),
      Error,
      "canonical order",
    );
    let reads = 0;
    const moving = source(items);
    moving.currentState = () =>
      Promise.resolve(items[reads++ === 0 ? 2 : 1].output);
    await assertRejects(() => history.recover(moving), Error, "progress saved");
    assertThrows(() => history.witness(token, items[0].record.height));
    assertEquals((await history.recover(source(items))).transactions, 0);
  } finally {
    history.close();
  }
});

Deno.test("cold recovery catches up while new checkpoints arrive without rescanning", async () => {
  const items = publications([1n, 2n, 3n, 4n, 5n, 6n]);
  let visible = 3;
  const starts: Array<string | undefined> = [];
  let decoded = 0;
  const moving: HistorySource = {
    async *transactions(after) {
      starts.push(after?.txHash);
      const snapshot = source(items.slice(0, visible));
      for await (const tx of snapshot.transactions(after)) {
        decoded++;
        yield tx;
        // The original scan still has three transactions. Catch-up must resume
        // at its last checkpoint rather than discarding that scan's progress.
        visible = items.length;
      }
    },
    currentState: () => Promise.resolve(items[visible - 1].output),
  };
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(items[0]),
  );
  try {
    const result = await history.recover(moving);
    assertEquals(result.transactions, 6);
    assertEquals(starts, [undefined, items[2].output.txHash]);
    assertEquals(decoded, 7);
    assertEquals(
      history.witness(token, items[4].record.height).record,
      items[4].record,
    );
    decoded = 0;
    starts.length = 0;
    assertEquals((await history.recover(moving)).transactions, 0);
    assertEquals(starts, [items[5].output.txHash]);
    assertEquals(
      decoded,
      1,
      "warm recovery only validates the saved intersection",
    );
  } finally {
    history.close();
  }
});

Deno.test("a disconnected cold replay resumes its durable checkpoint after restart", async () => {
  const items = publications(
    Array.from({ length: 12 }, (_, n) => BigInt(n + 1)),
  );
  const directory = await Deno.makeTempDir({ prefix: "ibc-history-resume-" });
  const path = `${directory}/history.sqlite`;
  let history = new ConsensusHistoryRecovery(path, deployment(items[0]));
  try {
    await assertRejects(
      () =>
        history.recover({
          ...source(items),
          async *transactions(after) {
            yield* source(items.slice(0, 8)).transactions(after);
            throw new Error("connection lost after checkpoint eight");
          },
        }),
      Error,
      "connection lost",
    );
    assertThrows(
      () => history.witness(token, items[0].record.height),
      Error,
      "live state",
    );
    history.close();
    history = new ConsensusHistoryRecovery(path, deployment(items[0]));
    let count = 0;
    let resumed: HistoryPoint | undefined;
    const result = await history.recover({
      ...source(items),
      async *transactions(after) {
        resumed = after;
        for await (const tx of source(items).transactions(after)) {
          count++;
          yield tx;
        }
      },
    });
    assertEquals(resumed?.txHash, items[7].output.txHash);
    assertEquals(count, 5);
    assertEquals(result.transactions, 4);
    assertEquals(
      history.witness(token, items[0].record.height).record,
      items[0].record,
    );
  } finally {
    history.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("catch-up retry limits preserve progress without publishing a stale root", async () => {
  const items = publications([1n, 2n, 3n, 4n]);
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(items[0]),
  );
  const starts: Array<string | undefined> = [];
  let visible = 2;
  const moving: HistorySource = {
    async *transactions(after) {
      starts.push(after?.txHash);
      yield* source(items.slice(0, visible)).transactions(after);
      visible++;
    },
    currentState: () => Promise.resolve(items[visible - 1].output),
  };
  try {
    await assertRejects(
      () => history.recover(moving, { maxPasses: 2 }),
      Error,
      "progress saved",
    );
    assertEquals(starts, [undefined, items[1].output.txHash]);
    assertThrows(
      () => history.witness(token, items[0].record.height),
      Error,
      "live state",
    );
    assertEquals((await history.recover(source(items))).transactions, 1);
    assertEquals(
      history.witness(token, items[2].record.height).record,
      items[2].record,
    );
    await assertRejects(
      () => history.recover(source(items), { maxPasses: 0 }),
      Error,
      "positive",
    );
  } finally {
    history.close();
  }
});

Deno.test("recovery rolls back a snapshot that changed and replays same-block replacements", async () => {
  const original = publications([1n, 2n, 3n]);
  const replacement = publications([1n, 2n, 4n], 100);
  for (
    const [branch, blockHash] of [[original, "aa".repeat(32)], [
      replacement,
      "bb".repeat(32),
    ]] as const
  ) {
    for (const [n, item] of branch.entries()) {
      if (n > 0) {
        item.transaction = {
          ...item.transaction,
          blockHeight: 2,
          slot: 2,
          blockHash,
          transactionIndex: n - 1,
        };
      }
    }
  }
  let rolledBack = false;
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(original[0]),
  );
  try {
    await history.recover({
      async *transactions(after) {
        yield* source(rolledBack ? replacement : original).transactions(after);
        if (!rolledBack) {
          rolledBack = true;
          throw new HistorySnapshotChangedError("canonical snapshot changed");
        }
      },
      currentState: () => Promise.resolve(replacement.at(-1)!.output),
    });
    assertEquals(
      history.witness(token, replacement[1].record.height).record,
      replacement[1].record,
    );
    assertThrows(
      () => history.witness(token, { revisionNumber: 1n, revisionHeight: 99n }),
      Error,
      "not found",
    );
    assertThrows(
      () => history.witness(token, { revisionNumber: -1n, revisionHeight: 1n }),
      Error,
      "nonnegative",
    );
    // A request for an absent/malformed height must not disable a healthy index.
    assertEquals(
      history.witness(token, replacement[0].record.height).record,
      replacement[0].record,
    );
  } finally {
    history.close();
  }
});

Deno.test("deep fork rewinds obey the retry limit and resume at the remaining checkpoint", async () => {
  const original = publications([1n, 2n, 3n, 4n, 5n]);
  const replacement = publications([1n, 2n, 3n, 4n, 6n], 100);
  const starts: string[] = [];
  const fork: HistorySource = {
    ...source(replacement),
    async *transactions(after) {
      starts.push(after!.txHash);
      yield* source(replacement).transactions(after);
    },
  };
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(original[0]),
  );
  try {
    await history.recover(source(original));
    await assertRejects(
      () => history.recover(fork, { maxPasses: 2 }),
      Error,
      "progress saved",
    );
    assertEquals(starts, [
      original[4].output.txHash,
      original[3].output.txHash,
    ]);
    starts.length = 0;
    await history.recover(fork);
    assertEquals(starts[0], original[2].output.txHash);
    assertEquals(
      history.witness(token, replacement[3].record.height).record,
      replacement[3].record,
    );
  } finally {
    history.close();
  }
});

Deno.test("warm recovery rejects damaged cache data even when the root row is unchanged", async () => {
  const items = publications([1n, 2n, 3n]);
  const directory = await Deno.makeTempDir({
    prefix: "ibc-history-corruption-",
  });
  try {
    for (
      const mutation of ["leaf", "node", "consistent replacement"] as const
    ) {
      const path = `${directory}/${mutation}.sqlite`;
      let history = new ConsensusHistoryRecovery(path, deployment(items[0]));
      try {
        await history.recover(source(items));
        const external = new DatabaseSync(path);
        try {
          const key = consensusHistoryKey(token, items[0].record.height);
          const changed = encodeConsensusHistoryRecord({
            ...items[0].record,
            processedTime: 999999n,
          });
          if (mutation === "leaf") {
            external.prepare(
              "UPDATE ibc_tree_leaves SET value = ? WHERE key = ?",
            ).run(changed, Buffer.from(key));
          } else if (mutation === "node") {
            external.exec("DELETE FROM ibc_tree_nodes WHERE height = 0");
          } else {
            new IncrementalIbcTree(external).set(key, changed);
          }
        } finally {
          external.close();
        }
        await assertRejects(
          () => history.recover(source(items)),
          Error,
          "rebuild",
        );
        assertThrows(
          () => history.witness(token, items[0].record.height),
          Error,
          "live state",
        );
        history.close();
        history = new ConsensusHistoryRecovery(path, deployment(items[0]));
        await assertRejects(
          () => history.recover(source(items)),
          Error,
          "rebuild",
        );
      } finally {
        history.close();
      }
    }
    const rebuilt = new ConsensusHistoryRecovery(
      `${directory}/rebuilt.sqlite`,
      deployment(items[0]),
    );
    try {
      await rebuilt.recover(source(items));
      assertEquals(
        rebuilt.witness(token, items[0].record.height).record,
        items[0].record,
      );
    } finally {
      rebuilt.close();
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("proof serving detects external cache damage without a recovery call", async () => {
  const items = publications([1n, 2n, 3n]);
  const directory = await Deno.makeTempDir({ prefix: "ibc-history-witness-" });
  const path = `${directory}/history.sqlite`;
  const history = new ConsensusHistoryRecovery(path, deployment(items[0]));
  try {
    await history.recover(source(items));
    const external = new DatabaseSync(path);
    try {
      external.exec("UPDATE ibc_tree_leaves SET value = '00'");
    } finally {
      external.close();
    }
    assertThrows(
      () => history.witness(token, items[0].record.height),
      Error,
      "rebuild",
    );
    assertThrows(
      () => history.witness(token, items[1].record.height),
      Error,
      "live state",
    );
  } finally {
    history.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recovery database cannot be reused for a different deployment", async () => {
  const directory = await Deno.makeTempDir({ prefix: "ibc-history-identity-" });
  const path = `${directory}/history.sqlite`;
  const first = publications([1n])[0];
  const config = deployment(first);
  const history = new ConsensusHistoryRecovery(path, config);
  try {
    history.close();
    assertThrows(
      () =>
        new ConsensusHistoryRecovery(path, {
          ...config,
          bootstrap: { ...config.bootstrap, txHash: "ff".repeat(32) },
        }),
      Error,
      "different deployment",
    );
  } finally {
    history.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recovery hashes original transaction bytes and preserves tagged integer data", async () => {
  const first = publications([1n])[0];
  const fields = (data: CborObj) => {
    assert(data instanceof CborTag && data.data instanceof CborArray);
    return data.data.array;
  };
  const rawDatum = Cbor.parse(first.output.datum!);
  const clientFields = fields(fields(fields(rawDatum)[0])[0]);
  const trustLevel = fields(fields(clientFields[0])[1]);
  trustLevel[0] = new CborTag(2, new CborBytes(new Uint8Array([0, 1])));
  const values = publicClientCommitmentValues(Cbor.encode(rawDatum).toString());
  const db = new DatabaseSync(":memory:");
  let expected: string;
  try {
    const tree = new IncrementalIbcTree(db);
    tree.set(clientKey, values.clientValue);
    tree.set(publicKey(1n), values.consensusValue);
    expected = tree.getRoot();
  } finally {
    db.close();
  }
  fields(rawDatum)[1] = new CborBytes(Buffer.from(expected, "hex"));
  first.output.datum = Cbor.encode(rawDatum).toString();

  const rawTransaction = Cbor.parse(first.transaction.cbor);
  assert(rawTransaction instanceof CborArray);
  const body = rawTransaction.array[0];
  assert(body instanceof CborMap);
  const outputList =
    body.map.find(({ k }) => k instanceof CborUInt && k.num === 1n)!.v;
  assert(outputList instanceof CborArray);
  const output = outputList.array[0];
  assert(output instanceof CborMap);
  const datum =
    output.map.find(({ k }) => k instanceof CborUInt && k.num === 2n)!.v;
  assert(datum instanceof CborArray);
  datum.array[1] = new CborTag(
    24,
    new CborBytes(Buffer.from(first.output.datum, "hex")),
  );
  const cbor = Cbor.encode(rawTransaction).toString();
  const txHash = Buffer.from(
    blake2b(Buffer.from(Cbor.encode(body).toString(), "hex"), { dkLen: 32 }),
  ).toString("hex");
  // This is why using CML.hash_transaction(decoded.body()) is insufficient.
  assert(
    CML.hash_transaction(CML.Transaction.from_cbor_hex(cbor).body())
      .to_hex() !== txHash,
  );
  first.output.txHash = txHash;
  first.transaction = { ...first.transaction, cbor, txHash };
  const history = new ConsensusHistoryRecovery(":memory:", deployment(first));
  try {
    assertEquals((await history.recover(source([first]))).root, expected);
  } finally {
    history.close();
  }
});
