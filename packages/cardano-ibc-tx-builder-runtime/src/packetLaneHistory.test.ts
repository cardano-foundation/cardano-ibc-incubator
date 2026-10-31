import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PacketLaneHistoryStore } from "./packetLaneHistoryStore.ts";
import { Constr, Data, fromText, type UTxO } from "@lucid-evolution/lucid";
import { packetLaneTokenName } from "@cardano-ibc/tx-builder/dist/packet-lanes";
import {
  PacketLaneHistory,
  type PacketLaneHistoryTransaction,
  PacketLaneTree,
} from "./packetLaneHistory.ts";

const statePolicy = "11".repeat(28);
const batchPolicy = "22".repeat(28);
const unit = statePolicy + packetLaneTokenName("transfer", "channel-0", 0, 1);
const record = (...fields: Data[]) => new Constr(0, fields);
const ack = "ab".repeat(32);
const key = (kind: string, sequence: bigint) =>
  `${kind}/ports/transfer/channels/channel-0/sequences/${sequence}`;

function transaction(
  version: bigint,
  root: string,
  previous?: UTxO,
  mutations: Data[] = [],
): PacketLaneHistoryTransaction {
  const txHash = (version + 1n).toString(16).padStart(64, "0");
  const output: UTxO = {
    txHash,
    outputIndex: 0,
    address: "lane",
    assets: { lovelace: 5_000_000n, [unit]: 1n },
    datum: Data.to(
      record(
        fromText("transfer"),
        fromText("channel-0"),
        0n,
        1n,
        version,
        root,
        new Map(),
        [],
        new Map(),
        record(0n, 0n),
        record(0n, 0n),
        new Map(),
      ),
    ),
  };
  const update = previous &&
    record(record(previous.txHash, BigInt(previous.outputIndex)), mutations);
  return {
    txHash,
    inputs: previous
      ? [{ txHash: previous.txHash, outputIndex: previous.outputIndex }]
      : [],
    outputs: [output],
    mint: new Map(previous ? [] : [[unit, 1n]]),
    mintPolicies: previous ? [batchPolicy] : [statePolicy],
    redeemers: previous
      ? [{
        type: "mint",
        index: 0,
        data: Data.to(
          record(
            record("", ""),
            new Constr(5, [
              record(),
              record(),
              record(),
              record(),
              update!,
              [],
            ]),
            record(),
          ),
        ),
      }]
      : [],
  };
}

function receive(
  version: bigint,
  previous: UTxO,
  tree: PacketLaneTree,
  sequence = version,
) {
  tree.set(key("receipts", sequence), "01");
  tree.set(key("acks", sequence), ack);
  const packet = record(
    sequence,
    fromText("transfer"),
    fromText("channel-7"),
    fromText("transfer"),
    fromText("channel-0"),
    fromText("payload"),
    record(0n, 0n),
    1n,
  );
  return transaction(version, tree.getRoot(), previous, [
    record(new Constr(1, [packet, ack, record(1n, version)]), []),
  ]);
}

test("packet history reconstructs more than one lane's former receipt capacity and supports historical forks", () => {
  const history = new PacketLaneHistory(unit, batchPolicy);
  const tree = new PacketLaneTree();
  const issued = transaction(0n, tree.getRoot());
  history.apply(issued);
  let previous = issued.outputs[0];
  let checkpoint: PacketLaneHistory | undefined;
  let checkpointOutput: UTxO | undefined;
  for (let version = 1n; version <= 40n; version++) {
    const tx = receive(version, previous, tree);
    history.apply(tx);
    previous = tx.outputs[0];
    if (version === 1n) {
      checkpoint = history.clone();
      checkpointOutput = previous;
    }
  }
  const latest = history.at(previous);
  assert.equal(latest.tree.size(), 80);
  assert.equal(
    latest.tree.generateProof(key("acks", 1n)).value.toString("hex"),
    ack,
  );
  assert.equal(checkpoint!.at(checkpointOutput!).tree.size(), 2);
  latest.set(key("acks", 1n), "");
  assert.equal(history.at(previous).get(key("acks", 1n)), ack);
  assert.throws(() => history.at(checkpointOutput!), /requested lane output/);
});

test("packet history rejects skipped predecessors and failed replay leaves its checkpoint intact", () => {
  const history = new PacketLaneHistory(unit, batchPolicy);
  const tree = new PacketLaneTree();
  const initial = transaction(0n, tree.getRoot());
  history.apply(initial);
  const first = receive(1n, initial.outputs[0], tree);
  const second = receive(2n, first.outputs[0], tree);
  assert.throws(() => history.apply(second), /predecessor/);
  assert.equal(history.at(initial.outputs[0]).tree.size(), 0);
  history.apply(first);
  const tampered = { ...second, redeemers: [] };
  assert.throws(() => history.apply(tampered), /batch redeemer/);
  assert.equal(history.at(first.outputs[0]).tree.size(), 2);
  history.apply(second);
  assert.equal(history.at(second.outputs[0]).tree.size(), 4);
});

test("packet history rejects a forged root and duplicate receive even with empty live lists", () => {
  const history = new PacketLaneHistory(unit, batchPolicy);
  const tree = new PacketLaneTree();
  const initial = transaction(0n, tree.getRoot());
  history.apply(initial);
  const first = receive(1n, initial.outputs[0], tree);
  const forged = { ...first, outputs: [{ ...first.outputs[0] }] };
  const datum = Data.from(first.outputs[0].datum!) as Constr<Data>;
  datum.fields[5] = "ff".repeat(32);
  forged.outputs[0].datum = Data.to(datum);
  assert.throws(() => history.apply(forged), /does not match the lane root/);
  history.apply(first);
  assert.throws(
    () => history.apply(receive(2n, first.outputs[0], tree, 1n)),
    /repeats a receive/,
  );
});

test("packet history rejects legacy lists, missing issuance and duplicate lane outputs", () => {
  const initial = transaction(0n, "00".repeat(32));
  const history = new PacketLaneHistory(unit, batchPolicy);
  assert.throws(
    () => history.apply({ ...initial, mint: new Map() }),
    /issuance/,
  );
  assert.throws(
    () =>
      history.apply({
        ...initial,
        outputs: [...initial.outputs, ...initial.outputs],
      }),
    /ambiguous/,
  );
  const datum = Data.from(initial.outputs[0].datum!) as Constr<Data>;
  datum.fields[7] = [1n];
  assert.throws(
    () =>
      history.apply({
        ...initial,
        outputs: [{ ...initial.outputs[0], datum: Data.to(datum) }],
      }),
    /explicit deployment migration/,
  );
});

test("packet history permits balance-only continuations without inventing receipt deltas", () => {
  const history = new PacketLaneHistory(unit, batchPolicy);
  const initial = transaction(0n, "00".repeat(32));
  history.apply(initial);
  const balance = transaction(1n, "00".repeat(32), initial.outputs[0]);
  balance.mintPolicies = [];
  balance.redeemers = [];
  history.apply(balance);
  assert.equal(history.at(balance.outputs[0]).tree.size(), 0);
  const forged = transaction(2n, "ff".repeat(32), balance.outputs[0]);
  forged.mintPolicies = [];
  assert.throws(() => history.apply(forged), /does not match the lane root/);
});

test("SQLite lane checkpoints reopen current and historical versions without replay and isolate deployments", () => {
  const directory = mkdtempSync(join(tmpdir(), "packet-lane-history-"));
  const path = join(directory, "history.sqlite");
  let store = new PacketLaneHistoryStore(path);
  try {
    const history = store.empty(unit, batchPolicy);
    const tree = new PacketLaneTree();
    const initial = transaction(0n, tree.getRoot());
    history.apply(initial);
    store.publish([{
      unit,
      batchPolicy,
      history: history.clone(),
      blockNo: 10,
      blockHash: "aa".repeat(32),
      txIndex: 0,
    }]);
    const next = receive(1n, initial.outputs[0], tree);
    history.apply(next);
    store.publish([{
      unit,
      batchPolicy,
      history: history.clone(),
      blockNo: 11,
      blockHash: "bb".repeat(32),
      txIndex: 0,
    }]);
    store.close();
    store = new PacketLaneHistoryStore(path);
    assert.equal(
      store.find(unit, batchPolicy, next.outputs[0])!.history.at(
        next.outputs[0],
      ).tree.size(),
      2,
    );
    assert.equal(
      store.find(unit, batchPolicy, initial.outputs[0])!.history.at(
        initial.outputs[0],
      ).tree.size(),
      0,
    );
    assert.equal(
      store.before(unit, batchPolicy, 1n, 11)!.history.current()!.txHash,
      next.txHash,
    );
    assert.equal(store.find(unit, "ff".repeat(28), next.outputs[0]), undefined);
    const fork = store.find(unit, batchPolicy, next.outputs[0])!.history.at(
      next.outputs[0],
    );
    fork.set(key("acks", 1n), "cd".repeat(32));
    assert.equal(
      store.find(unit, batchPolicy, next.outputs[0])!.history.at(
        next.outputs[0],
      ).get(key("acks", 1n)),
      ack,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
