import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  CML,
  Constr,
  Data,
  type UTxO,
  utxoToCore,
} from "@lucid-evolution/lucid";
import {
  ConsensusHistoryRecovery,
  type HistorySource,
  type HistoryTransaction,
} from "./consensusHistoryRecovery.ts";
import {
  consensusHistoryKey,
  type ConsensusHistoryRecord,
  encodeConsensusHistoryRecord,
  recordToConstr,
} from "./consensusHistory.ts";
import {
  IncrementalIbcTree,
  verifyIbcTreeWitness,
} from "./incrementalIbcTree.ts";
import { discoverYaciHistoryBootstrap } from "./consensusHistoryYaci.ts";

const token = { policyId: "11".repeat(28), name: "22".repeat(24) + "30" };
const unit = token.policyId + token.name;
const address = CML.EnterpriseAddress.new(
  0,
  CML.Credential.new_script(CML.ScriptHash.from_hex("33".repeat(28))),
).to_address().to_bech32();
const height = (n: bigint) => new Constr(0, [1n, n]);
const encode = (data: Data) =>
  Data.to<Data>(data, undefined, { canonical: true });
type Publication = {
  output: UTxO;
  record: ConsensusHistoryRecord;
  transaction: HistoryTransaction;
};

// Unsigned CBOR fixtures exercise recovery, not script authorization. Production
// ledger acceptance is covered separately by the signed integration fixtures.
function publications(heights: bigint[], bodyOnly = false, migrationAddresses?: string[]): Publication[] {
  const db = new DatabaseSync(":memory:");
  const tree = new IncrementalIbcTree(db);
  const result: Publication[] = [];
  try {
    for (const n of heights) {
      const previous = result.at(-1);
      const frozen = previous?.record.height.revisionHeight === n;
      const record: ConsensusHistoryRecord = {
        clientToken: token,
        height: { revisionNumber: 1n, revisionHeight: n },
        consensusState: {
          timestamp: 1000n + n,
          nextValidatorsHash: "44".repeat(32),
          root: "55".repeat(32),
        },
        processedTime: 2000n + n,
        processedHeight: 10n + n,
      };
      if (previous && !frozen) {
        tree.set(
          consensusHistoryKey(token, previous.record.height),
          encodeConsensusHistoryRecord(previous.record),
        );
      }
      const state = new Constr(0, [
        new Constr(0, [
          "636861696e2d31",
          new Constr(0, [1n, 3n]),
          100_000n,
          200_000n,
          100n,
          new Constr(0, [0n, frozen ? 1n : 0n]),
          height(n),
          [],
        ]),
        new Map([[height(n), recordToConstr(record).fields[2]]]),
        new Map([[height(n), record.processedTime]]),
        new Map([[height(n), record.processedHeight]]),
      ]);
      const output: UTxO = {
        txHash: "00".repeat(32),
        outputIndex: 0,
        address: migrationAddresses?.[result.length] ?? address,
        assets: { lovelace: 10_000_000n, [unit]: 1n },
        datum: encode(
          new Constr(0, [
            state,
            new Constr(0, [token.policyId, token.name]),
            tree.getRoot(),
          ]),
        ),
      };
      if (migrationAddresses && previous && frozen) output.datum = previous.output.datum;
      const inputs = CML.TransactionInputList.new();
      inputs.add(
        CML.TransactionInput.new(
          CML.TransactionHash.from_hex(
            previous?.output.txHash ?? "aa".repeat(32),
          ),
          0n,
        ),
      );
      const outputs = CML.TransactionOutputList.new();
      outputs.add(utxoToCore(output).output());
      const body = CML.TransactionBody.new(inputs, outputs, 200_000n);
      if (!previous) {
        const mint = CML.Mint.new();
        mint.set(
          CML.ScriptHash.from_hex(token.policyId),
          CML.AssetName.from_hex(token.name),
          1n,
        );
        body.set_mint(mint);
      }
      const tx = CML.Transaction.new(
        body,
        CML.TransactionWitnessSet.new(),
        true,
      );
      output.txHash = CML.hash_transaction(body).to_hex();
      result.push({
        output,
        record,
        transaction: {
          txHash: output.txHash,
          blockHash: (result.length + 1).toString(16).padStart(64, "0"),
          blockHeight: result.length + 1,
          slot: result.length + 1,
          transactionIndex: 0,
          cbor: bodyOnly ? body.to_cbor_hex() : tx.to_cbor_hex(),
          ...(bodyOnly ? { valid: true } : {}),
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
      const index = after
        ? items.findIndex((entry) => entry.transaction.txHash === after.txHash)
        : 0;
      assert(index >= 0);
      for (const entry of items.slice(index)) {
        yield structuredClone(entry.transaction);
      }
    },
    currentState: () => Promise.resolve(structuredClone(items.at(-1)!.output)),
  };
}

function recovery(items: Publication[]) {
  return new ConsensusHistoryRecovery(":memory:", {
    clientToken: token,
    stateAddress: address,
    bootstrap: { txHash: items[0].output.txHash, outputIndex: 0 },
  });
}

function replaceDatum(
  item: Publication,
  change: (datum: Constr<Data>) => void,
): void {
  const datum = Data.from<Data>(item.output.datum!);
  assert(datum instanceof Constr);
  change(datum);
  item.output.datum = encode(datum);
  const original = CML.Transaction.from_cbor_hex(item.transaction.cbor).body();
  const outputs = CML.TransactionOutputList.new();
  outputs.add(utxoToCore(item.output).output());
  const body = CML.TransactionBody.new(
    original.inputs(),
    outputs,
    original.fee(),
  );
  const mint = original.mint();
  if (mint) body.set_mint(mint);
  const tx = CML.Transaction.new(body, CML.TransactionWitnessSet.new(), true);
  item.output.txHash = CML.hash_transaction(body).to_hex();
  item.transaction = {
    ...item.transaction,
    txHash: item.output.txHash,
    cbor: tx.to_cbor_hex(),
  };
}

test("production private root replays creation, update, freeze and recovery-height jump", async () => {
  for (const bodyOnly of [false, true]) {
    const items = publications([1n, 2n, 2n, 7n], bodyOnly);
    const index = recovery(items);
    try {
      const result = await index.recover(source(items));
      assert.equal(result.transactions, 4);
      assert.equal(index.current().utxo.txHash, items[3].output.txHash);
      assert.equal(
        index.current().record.processedTime,
        items[3].record.processedTime,
      );
      const proof = index.witness(token, items[1].record.height);
      assert(
        verifyIbcTreeWitness(
          proof.key,
          proof.value,
          proof.siblings,
          result.root,
        ),
      );
      const records = [];
      for await (const entry of index.records()) records.push(entry);
      assert.deepEqual(
        records.map((
          entry,
        ) => [entry.record.height.revisionHeight, entry.archived]),
        [[1n, true], [2n, true], [7n, false]],
      );
      assert.deepEqual(
        await index.heights(),
        items.filter((_, i) => i !== 2).map((entry) => entry.record.height),
      );
      assert.deepEqual(
        await index.heights({ after: items[1].record.height, limit: 1 }),
        [items[3].record.height],
      );
      const before = index.current();
      const insertion = index.insertionWitness();
      assert(
        verifyIbcTreeWitness(
          insertion.key,
          "",
          insertion.siblings,
          insertion.root,
        ),
      );
      assert(
        verifyIbcTreeWitness(
          insertion.key,
          insertion.value,
          insertion.siblings,
          insertion.newRoot,
        ),
      );
      assert.deepEqual(index.current(), before);
      assert.equal((await index.recover(source(items))).transactions, 0);
    } finally {
      index.close();
    }
  }
});

test("production genesis has an empty private root and no archived membership", async () => {
  const items = publications([1n]);
  const index = recovery(items);
  try {
    assert.equal((await index.recover(source(items))).root, "00".repeat(32));
    assert.throws(
      () => index.witness(token, items[0].record.height),
      /not found/,
    );
    assert.equal(index.current().record.height.revisionHeight, 1n);
  } finally {
    index.close();
  }
});

test("production rejects an undisclosed genesis root and same-height metadata mutation", async () => {
  const genesis = publications([1n]);
  replaceDatum(genesis[0], (datum) => {
    datum.fields[2] = "ff".repeat(32);
  });
  const seeded = recovery(genesis);
  try {
    await assert.rejects(
      seeded.recover(source(genesis)),
      /reconstructed tree differs/,
    );
  } finally {
    seeded.close();
  }
  const items = publications([1n, 1n]);
  replaceDatum(items[1], (datum) => {
    const state = datum.fields[0] as Constr<Data>;
    state.fields[2] = new Map([[height(1n), 9000n]]);
  });
  const changed = recovery(items);
  try {
    await assert.rejects(
      changed.recover(source(items)),
      /same-height transition changed immutable/,
    );
  } finally {
    changed.close();
  }
});

test("body-only history cannot invent ledger validity or accept a body hash mismatch", async () => {
  for (const invalid of [undefined, false, "true"]) {
    const items = publications([1n], true);
    (items[0].transaction as { valid?: unknown }).valid = invalid;
    const index = recovery(items);
    try {
      await assert.rejects(
        index.recover(source(items)),
        /validity|invalid transaction/,
      );
    } finally {
      index.close();
    }
  }
  const items = publications([1n], true);
  (items[0].transaction as { txHash: string }).txHash = "ff".repeat(32);
  const index = recovery(items);
  try {
    await assert.rejects(index.recover(source(items)), /hash does not match/);
  } finally {
    index.close();
  }
});

test("bootstrap discovery checks raw positive NFT mint and closes its read snapshot", async () => {
  const first = publications([1n], true)[0];
  const calls: string[] = [];
  const sql = {
    async query(query: string, values?: unknown[]) {
      await Promise.resolve();
      calls.push(query.trim());
      if (!query.includes("consensus-history:discover")) return { rows: [] };
      assert.deepEqual(values, [address, unit]);
      return {
        rows: [{
          tx_hash: first.transaction.txHash,
          block_hash: first.transaction.blockHash,
          block_height: first.transaction.blockHeight,
          slot: first.transaction.slot,
          transaction_index: 0,
          output_index: 0,
          cbor: first.transaction.cbor,
          invalid: false,
        }],
      };
    },
  };
  assert.deepEqual(
    await discoverYaciHistoryBootstrap(sql, {
      clientToken: token,
      stateAddress: address,
    }),
    { txHash: first.output.txHash, outputIndex: 0 },
  );
  assert.equal(calls.at(-1), "COMMIT");
  const missingMint = publications([1n, 2n], true)[1];
  const badSql = {
    async query(query: string) {
      await Promise.resolve();
      calls.push(query.trim());
      return {
        rows: query.includes("consensus-history:discover")
          ? [{
            tx_hash: missingMint.transaction.txHash,
            block_hash: missingMint.transaction.blockHash,
            block_height: 2,
            slot: 2,
            transaction_index: 0,
            output_index: 0,
            cbor: missingMint.transaction.cbor,
            invalid: false,
          }]
          : [],
      };
    },
  };
  await assert.rejects(
    discoverYaciHistoryBootstrap(badSql, {
      clientToken: token,
      stateAddress: address,
    }),
    /must mint exactly/,
  );
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("recovery rejects the retired combined-tree layout before opening its cache", () => {
  const item = publications([1n])[0];
  const deployment = {
    layout: "prototype",
    clientToken: token,
    stateAddress: address,
    bootstrap: { txHash: item.output.txHash, outputIndex: 0 },
  };
  assert.throws(
    () => new ConsensusHistoryRecovery(":memory:", deployment as never),
    /invalid history datum layout/,
  );
});

test("recovery rejects a combined client and public-root datum", async () => {
  const items = publications([1n]);
  replaceDatum(items[0], (datum) => {
    const client = new Constr(0, [...datum.fields]);
    datum.fields = [client, "00".repeat(32)];
  });
  const history = recovery(items);
  try {
    await assert.rejects(
      history.recover(source(items)),
      /invalid client datum/,
    );
  } finally {
    history.close();
  }
});

// These are canonical-CBOR replay tests. Actual spending-script authorization
// is exercised separately by the compiled-validator migration rehearsal.
test("cold history follows V1 to V2 to V3 NFT custody and keeps pre-migration witnesses", async () => {
  const v2 = CML.EnterpriseAddress.new(0, CML.Credential.new_script(CML.ScriptHash.from_hex("66".repeat(28)))).to_address().to_bech32();
  const v3 = CML.EnterpriseAddress.new(0, CML.Credential.new_script(CML.ScriptHash.from_hex("77".repeat(28)))).to_address().to_bech32();
  const items = publications([1n, 2n, 2n, 3n, 3n, 4n], false, [address, address, v2, v2, v3, v3]);
  // A fresh database for every historical boundary, and again after a rollback
  // to V2: no cached address whitelist or local migration checkpoint is used.
  for (const length of [2, 3, 4, 5, 6, 4]) {
    const prefix = items.slice(0, length);
    const index = new ConsensusHistoryRecovery(":memory:", {clientToken: token, stateAddress: prefix.at(-1)!.output.address,
      allowScriptMigration: true, bootstrap: {txHash: items[0].output.txHash, outputIndex: 0}});
    try {
      const result = await index.recover(source(prefix));
      assert.equal(index.current().utxo.txHash, prefix.at(-1)!.output.txHash);
      const witness = index.witness(token, {revisionNumber: 1n, revisionHeight: 1n});
      assert(verifyIbcTreeWitness(witness.key, witness.value, witness.siblings, result.root));
      assert.equal(witness.value, encodeConsensusHistoryRecord(items[0].record));
    } finally { index.close(); }
  }
  const legacy = recovery(items);
  try { await assert.rejects(legacy.recover(source(items)), /invalid authenticated state output/); }
  finally { legacy.close(); }
});

test("migration history rejects remint and omitted predecessors at the intended guard", async () => {
  for (const change of ["remint", "omit"] as const) {
    const items = publications([1n, 2n, 3n]);
    if (change === "remint") {
      const last = items.at(-1)!;
      const body = CML.Transaction.from_cbor_hex(last.transaction.cbor).body();
      const mint = CML.Mint.new();
      mint.set(CML.ScriptHash.from_hex(token.policyId), CML.AssetName.from_hex(token.name), 1n);
      body.set_mint(mint);
      last.output.txHash = CML.hash_transaction(body).to_hex();
      last.transaction = {...last.transaction, txHash: last.output.txHash, cbor: CML.Transaction.new(body, CML.TransactionWitnessSet.new(), true).to_cbor_hex()};
    }
    const index = new ConsensusHistoryRecovery(":memory:", {clientToken: token, stateAddress: address,
      allowScriptMigration: true, bootstrap: {txHash: items[0].output.txHash, outputIndex: 0}});
    try {
      await assert.rejects(index.recover(source(change === "omit" ? [items[0], items[2]] : items)),
        change === "remint" ? /continuation cannot mint or burn/ : /missing a predecessor/);
    } finally { index.close(); }
  }
});
