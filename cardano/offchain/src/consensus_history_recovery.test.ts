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
    async *transactions() {
      for (const item of items) yield structuredClone(item.transaction);
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

Deno.test("interrupted replay preserves the committed tree but disables proof serving", async () => {
  const items = publications([1n, 2n, 3n, 4n]);
  const old = items.slice(0, 3);
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(items[0]),
  );
  try {
    const before = await history.recover(source(old));
    const interrupted = source(items);
    interrupted.transactions = async function* () {
      for (const item of items) yield item.transaction;
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
      "partial replay must not commit its new leaf",
    );
    assertThrows(() =>
      history.witness(token, { revisionNumber: 1n, revisionHeight: 3n })
    );
  } finally {
    history.close();
  }
});

Deno.test("recovery rejects reordered history, missing predecessor and a moving live anchor", async () => {
  const items = publications([1n, 2n, 3n]);
  const history = new ConsensusHistoryRecovery(
    ":memory:",
    deployment(items[0]),
  );
  try {
    await assertRejects(
      () => history.recover(source([items[0], items[2]])),
      Error,
      "predecessor",
    );
    await assertRejects(
      () => history.recover(source([items[1], items[0], items[2]])),
      Error,
      "bootstrap",
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
    await assertRejects(() => history.recover(moving), Error, "changed during");
    assertEquals((await history.recover(source(items))).transactions, 3);
  } finally {
    history.close();
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
