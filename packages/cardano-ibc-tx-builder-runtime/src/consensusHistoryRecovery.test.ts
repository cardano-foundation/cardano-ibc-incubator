import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { createRestHistorySource } from "./consensusHistoryRest.ts";
import { YaciRestClient, type YaciRestBlock } from "./yaciRest.ts";
import { YaciRestHistory, type RestTransaction } from "./yaciRestHistory.ts";

const token = { policyId: "11".repeat(28), name: "22".repeat(24) + "30" };
const unit = token.policyId + token.name;
const address = CML.EnterpriseAddress.new(
  0,
  CML.Credential.new_script(CML.ScriptHash.from_hex("33".repeat(28))),
).to_address().to_bech32();
const height = (n: bigint, revision = 1n) => new Constr(0, [revision, n]);
const encode = (data: Data) =>
  Data.to<Data>(data, undefined, { canonical: true });
type Publication = {
  output: UTxO;
  record: ConsensusHistoryRecord;
  transaction: HistoryTransaction;
};

// Unsigned CBOR fixtures exercise recovery, not script authorization. Production
// ledger acceptance is covered separately by the signed integration fixtures.
// A bare height is in revision 1; a pair sets the revision explicitly.
function publications(
  heights: Array<bigint | readonly [bigint, bigint]>,
  bodyOnly = false,
  migrationAddresses?: string[],
): Publication[] {
  const db = new DatabaseSync(":memory:");
  const tree = new IncrementalIbcTree(db);
  const result: Publication[] = [];
  try {
    for (const entry of heights) {
      const [revision, n] = typeof entry === "bigint" ? [1n, entry] : entry;
      const previous = result.at(-1);
      const frozen = previous?.record.height.revisionNumber === revision &&
        previous.record.height.revisionHeight === n;
      const record: ConsensusHistoryRecord = {
        clientToken: token,
        height: { revisionNumber: revision, revisionHeight: n },
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
          Buffer.from(`chain-${revision}`).toString("hex"),
          new Constr(0, [1n, 3n]),
          100_000n,
          200_000n,
          100n,
          new Constr(0, [0n, frozen ? 1n : 0n]),
          height(n, revision),
          [],
          [],
        ]),
        new Map([[height(n, revision), recordToConstr(record).fields[2]]]),
        new Map([[height(n, revision), record.processedTime]]),
        new Map([[height(n, revision), record.processedHeight]]),
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

function restSource(items: Publication[]) {
  const api = new YaciRestClient("https://yaci.example");
  const metadata = (index: number): YaciRestBlock => ({
    number: items[index].transaction.blockHeight,
    hash: items[index].transaction.blockHash,
    previous_block: index ? items[index - 1].transaction.blockHash : null,
    slot: items[index].transaction.slot,
    epoch: 0,
    time: index,
    slot_leader: "fixture",
    tx_count: 1,
  });
  api.block = async (at) =>
    at === "latest"
      ? metadata(items.length - 1)
      : items[Number(at) - 1]
        ? metadata(Number(at) - 1)
        : null;
  api.json = async (path) => {
    const url = new URL(path, "https://yaci.example");
    const start = (Number(url.searchParams.get("page")) - 1) * 100;
    return items.slice(start, start + 100).map((item) => ({
      tx_hash: item.output.txHash,
      block_height: item.transaction.blockHeight,
    }));
  };
  const rest = new YaciRestHistory(api);
  const loads: number[] = [];
  let failureAt: number | undefined;
  rest.blockTransactions = async (number): Promise<RestTransaction[]> => {
    loads.push(number);
    if (number === failureAt)
      throw new Error(`block ${number} unavailable after transport retries`);
    const item = items[number - 1];
    const transaction = CML.Transaction.from_cbor_hex(item.transaction.cbor);
    const body = transaction.body();
    return [
      {
        hash: item.output.txHash,
        block: metadata(number - 1),
        index: 0,
        valid: true,
        body,
        bodyCborHex: body.to_cbor_hex(),
        cborHex: item.transaction.cbor,
        transaction,
        inputs: [
          {
            txHash: body.inputs().get(0).transaction_id().to_hex(),
            outputIndex: 0,
          },
        ],
        outputs: [
          {
            tx_hash: item.output.txHash,
            output_index: 0,
            block: number,
            tx_index: 0,
            address: item.output.address,
            inline_datum: item.output.datum!,
            data_hash: null,
            amounts: Object.entries(item.output.assets).map(
              ([unit, quantity]) => ({ unit, quantity: quantity.toString() }),
            ),
          },
        ],
      },
    ];
  };
  const deployment = {
    clientToken: token,
    stateAddress: address,
    bootstrap: { txHash: items[0].output.txHash, outputIndex: 0 },
  };
  let liveReads = 0;
  const history = createRestHistorySource(rest, deployment, async () => {
    liveReads++;
    return structuredClone(items.at(-1)!.output);
  });
  return {
    history,
    deployment,
    loads,
    failAt: (number?: number) => {
      failureAt = number;
    },
    liveReads: () => liveReads,
    api,
  };
}

test("REST recovery persists a late-failure prefix in SQLite and resumes after reopening the cache", async () => {
  const items = publications(
    Array.from({ length: 200 }, (_, index) => BigInt(index + 1)),
  );
  const provider = restSource(items);
  const directory = mkdtempSync(join(tmpdir(), "rest-history-progress-"));
  const file = join(directory, "history.sqlite");
  let index = new ConsensusHistoryRecovery(file, provider.deployment);
  try {
    provider.failAt(199);
    await assert.rejects(
      index.recover(provider.history),
      /block 199 unavailable/,
    );
    assert.equal(provider.liveReads(), 0);
    assert.throws(
      () => index.witness(token, items[0].record.height),
      /not been matched to the live state/,
    );
    index.close();
    const saved = new DatabaseSync(file);
    try {
      assert.equal(
        saved.prepare("SELECT COUNT(*) AS count FROM history_journal").get()!
          .count,
        198,
      );
      assert.equal(
        saved
          .prepare(
            "SELECT block_height FROM history_journal ORDER BY sequence DESC LIMIT 1",
          )
          .get()!.block_height,
        198,
      );
    } finally {
      saved.close();
    }
    index = new ConsensusHistoryRecovery(file, provider.deployment);
    provider.failAt();
    provider.loads.length = 0;
    const result = await index.recover(provider.history);
    assert.equal(result.transactions, 2);
    assert(provider.loads.every((height) => height >= 198));
    assert.equal(index.current().point.blockHeight, 200);
    const proof = index.witness(token, items[0].record.height);
    assert(
      verifyIbcTreeWitness(proof.key, proof.value, proof.siblings, result.root),
    );
  } finally {
    index.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("REST recovery saves replay progress but cannot serve proofs until the pinned tip is revalidated", async () => {
  const items = publications([1n, 2n]);
  const provider = restSource(items);
  const index = new ConsensusHistoryRecovery(":memory:", provider.deployment);
  const block = provider.api.block.bind(provider.api);
  provider.api.block = async (at) => {
    const found = await block(at);
    return at === 2 ? { ...found!, hash: "ff".repeat(32) } : found;
  };
  try {
    await assert.rejects(
      index.recover(provider.history, { maxPasses: 1 }),
      /progress saved/,
    );
    assert.equal(provider.liveReads(), 0);
    assert.throws(
      () => index.witness(token, items[0].record.height),
      /not been matched to the live state/,
    );
  } finally {
    index.close();
  }
});

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

test("production private root replays an upgrade into a revision whose heights restart", async () => {
  // (2, 5) reuses an archived revision-1 height, which must not collide.
  const items = publications([5n, 9n, [2n, 5n], [2n, 5n], [2n, 8n]]);
  const index = recovery(items);
  try {
    const result = await index.recover(source(items));
    assert.equal(result.transactions, 5);
    assert.deepEqual(index.current().record.height, {
      revisionNumber: 2n,
      revisionHeight: 8n,
    });
    for (const archived of [items[1], items[2]]) {
      const proof = index.witness(token, archived.record.height);
      assert(
        verifyIbcTreeWitness(
          proof.key,
          proof.value,
          proof.siblings,
          result.root,
        ),
      );
    }
    const records = [];
    for await (const entry of index.records()) records.push(entry);
    assert.deepEqual(
      records.map((entry) => [
        entry.record.height.revisionNumber,
        entry.record.height.revisionHeight,
        entry.archived,
      ]),
      [[1n, 5n, true], [1n, 9n, true], [2n, 5n, true], [2n, 8n, false]],
    );
    assert.deepEqual(
      await index.heights({ after: items[1].record.height, limit: 2 }),
      [items[2].record.height, items[4].record.height],
    );
    const insertion = index.insertionWitness();
    assert(
      verifyIbcTreeWitness(
        insertion.key,
        insertion.value,
        insertion.siblings,
        insertion.newRoot,
      ),
    );
  } finally {
    index.close();
  }
});

test("production rejects a checkpoint that moves to an earlier revision or height", async () => {
  for (
    const heights of [
      [[2n, 5n], [1n, 9n]],
      [[2n, 5n], [2n, 4n]],
    ] as Array<Array<readonly [bigint, bigint]>>
  ) {
    const items = publications(heights);
    const index = recovery(items);
    try {
      await assert.rejects(
        index.recover(source(items)),
        /unsupported checkpoint transition/,
      );
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
