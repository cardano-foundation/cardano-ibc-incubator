import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { IbcTreeNodeStore } from "./incrementalIbcTree.ts";
import { ICS23MerkleTree } from "./ics23MerkleTree.ts";
import { PacketMerkleTree } from "./packetLaneTree.ts";

const key = (kind: string, sequence: bigint) =>
  `${kind}/ports/transfer/channels/channel-0/sequences/${sequence}`;

test("incremental packet snapshots retain byte-identical roots and proofs through inserts, deletes and forks", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new PacketMerkleTree(new IbcTreeNodeStore(db));
    const reference = new ICS23MerkleTree();
    for (let i = 1n; i <= 50n; i++) {
      const receipt = key("receipts", i), ack = key("acks", i);
      for (const [path, value] of [[receipt, "01"], [ack, "ab".repeat(32)]]) {
        tree.set(path, value);
        reference.set(path, value);
        assert.equal(tree.getRoot(), reference.getRoot());
        assert.deepEqual(tree.getSiblings(path), reference.getSiblings(path));
        assert.deepEqual(
          tree.generateProof(path),
          reference.generateProof(path),
        );
      }
    }
    const snapshot = tree.clone();
    const root = snapshot.getRoot();
    for (const path of [key("receipts", 1n), key("acks", 1n)]) {
      tree.set(path, "");
      reference.set(path, "");
      assert.equal(tree.getRoot(), reference.getRoot());
      assert.deepEqual(
        tree.generateNonExistenceProof(path),
        reference.generateNonExistenceProof(path),
      );
    }
    assert.equal(snapshot.getRoot(), root);
    assert.equal(
      snapshot.verifyProof(snapshot.generateProof(key("acks", 1n))),
      true,
    );
    assert.equal(tree.get(key("acks", 1n)), undefined);
    const reopened = new PacketMerkleTree(
      new IbcTreeNodeStore(db),
      snapshot.state(),
    );
    assert.deepEqual(
      reopened.generateProof(key("acks", 1n)),
      snapshot.generateProof(key("acks", 1n)),
    );
    reopened.set(key("acks", 1n), "cd".repeat(32));
    assert.equal(
      snapshot.get(key("acks", 1n))!.toString("hex"),
      "ab".repeat(32),
    );
  } finally {
    db.close();
  }
});

test("cloning, root reads and bounded proofs do not enumerate retained leaves", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new IbcTreeNodeStore(db);
    const tree = new PacketMerkleTree(store);
    for (let i = 1n; i <= 500n; i++) {
      tree.set(key("receipts", i), "01");
      tree.set(key("acks", i), "ab".repeat(32));
    }
    const reads = mock.method(store, "read");
    const writes = mock.method(store, "write");
    const fork = tree.clone();
    fork.getRoot();
    assert.equal(reads.mock.callCount(), 0);
    assert.equal(writes.mock.callCount(), 0);
    fork.set(key("receipts", 501n), "01");
    fork.set(key("acks", 501n), "cd".repeat(32));
    // Two commitment paths and two sequence-index paths, 65 nodes each.
    assert.equal(writes.mock.callCount(), 260);
    assert.ok(reads.mock.callCount() < 1500);
    reads.mock.resetCalls();
    fork.generateProof(key("acks", 1n));
    assert.ok(reads.mock.callCount() < 150);
    assert.equal(tree.size(), 1000);
    assert.equal(fork.size(), 1002);
  } finally {
    db.close();
  }
});

test("numeric sequence pages skip large offsets and merge lane ranks without materializing keys", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new IbcTreeNodeStore(db);
    const trees = Array.from({ length: 4 }, () => new PacketMerkleTree(store));
    for (let i = 1n; i <= 300n; i++) {
      trees[Number(i % 4n)].set(key("acks", i), "ab");
    }
    const reads = mock.method(store, "read");
    assert.equal(PacketMerkleTree.sequenceAt(trees, "acks", 255), 256n);
    assert.equal(PacketMerkleTree.sequenceAt(trees, "acks", 255, true), 45n);
    assert.equal(PacketMerkleTree.sequenceAt(trees, "acks", 300), undefined);
    assert.ok(reads.mock.callCount() < 1600);
    assert.deepEqual(trees[0].entriesPage("acks", 70, 3), [[284n, "ab"], [
      288n,
      "ab",
    ], [292n, "ab"]]);
    assert.deepEqual(trees[0].entriesPage("acks", 1, 3, true), [[296n, "ab"], [
      292n,
      "ab",
    ], [288n, "ab"]]);
    assert.equal(trees[0].countBefore("acks", 284n), 70);
  } finally {
    db.close();
  }
});

test("corrupt immutable nodes fail before a proof or mutation can be used", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new PacketMerkleTree(new IbcTreeNodeStore(db));
    tree.set(key("receipts", 1n), "01");
    db.prepare("UPDATE ibc_versioned_nodes SET left_hash = ? WHERE hash = ?")
      .run("ff".repeat(32), tree.getRoot());
    assert.throws(
      () => tree.generateProof(key("receipts", 1n)),
      /Corrupt incremental/,
    );
    assert.throws(
      () => tree.set(key("receipts", 2n), "01"),
      /Corrupt incremental/,
    );
  } finally {
    db.close();
  }
});

test("incremental packet snapshots preserve collision-bucket proofs", () => {
  const commitment = require(
    "./ibcStateCommitment",
  ) as typeof import("./ibcStateCommitment");
  const keys = [key("acks", 42n), key("acks", 43n), key("acks", 44n)];
  const native = commitment.keyHash;
  const digest = native(keys[0]);
  const digests = [
    digest,
    Buffer.concat([digest.subarray(0, 8), Buffer.alloc(24)]),
    Buffer.concat([digest.subarray(0, 8), Buffer.alloc(24, 255)]),
  ];
  const replacement = mock.method(
    commitment,
    "keyHash",
    (value: string) =>
      keys.includes(value) ? digests[keys.indexOf(value)] : native(value),
  );
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new PacketMerkleTree(new IbcTreeNodeStore(db));
    const reference = new ICS23MerkleTree();
    for (
      const [path, value] of [
        [keys[1], "ab"],
        [keys[0], "cd"],
        [keys[2], "ef"],
        [keys[1], ""],
        [keys[0], ""],
      ]
    ) {
      tree.set(path, value);
      reference.set(path, value);
      assert.equal(tree.getRoot(), reference.getRoot());
      for (const candidate of keys) {
        assert.deepEqual(
          tree.getSiblings(candidate),
          reference.getSiblings(candidate),
        );
        const proof = tree.get(candidate)
          ? tree.generateProof(candidate)
          : tree.generateNonExistenceProof(candidate).left!;
        assert.equal(tree.verifyProof(proof), true);
      }
    }
  } finally {
    replacement.mock.restore();
    db.close();
  }
});

test("a failed sequence-index update rolls back new nodes without changing either root", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new IbcTreeNodeStore(db);
    const tree = new PacketMerkleTree(store);
    tree.set(key("receipts", 1n), "01");
    const previous = tree.state();
    const rows =
      db.prepare("SELECT COUNT(*) AS count FROM ibc_versioned_nodes").get()!
        .count;
    const write = store.write.bind(store);
    let writes = 0;
    const failure = mock.method(
      store,
      "write",
      (...args: Parameters<typeof store.write>) => {
        if (++writes > 65) throw new Error("simulated index write failure");
        return write(...args);
      },
    );
    assert.throws(() => tree.set(key("receipts", 2n), "01"), /simulated/);
    failure.mock.restore();
    assert.deepEqual(tree.state(), previous);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM ibc_versioned_nodes").get()!
        .count,
      rows,
    );
    assert.equal(tree.get(key("receipts", 2n)), undefined);
    assert.equal(
      tree.verifyProof(tree.generateProof(key("receipts", 1n))),
      true,
    );
  } finally {
    db.close();
  }
});

test("sequence indices preserve unsigned 64-bit ordering and reject a swapped record kind", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new IbcTreeNodeStore(db);
    const tree = new PacketMerkleTree(store);
    const large = (1n << 63n) + 10n;
    const maximum = (1n << 64n) - 1n;
    for (const sequence of [maximum, 1n, large]) {
      tree.set(key("acks", sequence), "ab");
    }
    tree.set(key("receipts", 1n), "01");
    assert.deepEqual(
      tree.entriesPage("acks", 0, 3).map(([sequence]) => sequence),
      [1n, large, maximum],
    );
    assert.equal(PacketMerkleTree.sequenceAt([tree], "acks", 0, true), maximum);
    assert.equal(tree.countBefore("acks", maximum + 1n), 3);
    const state = tree.state();
    const corrupt = new PacketMerkleTree(store, {
      ...state,
      indices: { ...state.indices, acks: state.indices.receipts },
    });
    assert.throws(() => corrupt.entriesPage("acks", 0, 1), /another domain/);
    assert.throws(
      () => tree.set(key("acks", maximum + 1n), "ab"),
      /Invalid packet sequence/,
    );
  } finally {
    db.close();
  }
});
