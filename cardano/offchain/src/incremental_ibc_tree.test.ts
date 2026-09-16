import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DeploymentIbcTree } from "./deployment.ts";
import {
  IncrementalIbcTree,
  verifyIbcTreeWitness,
} from "./incremental_ibc_tree.ts";

const EMPTY_HASH = "00".repeat(32);
const VECTOR_KEY = "internal/consensus-history/v1/" +
  "d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffff";
const VECTOR_VALUE =
  "d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffd8799f0741ccd8799f41ddffff0809ff";
const VECTOR_ROOT =
  "caee7ebf5c9bd19dc904e771797ce4e98f91301273dd86c9f32dc8c8a4fc6e7f";

// Independent single-path verifier, also covers exclusion proofs. The bit order
// and domain prefixes match ibc_state_commitment.ak, not an SQL tree traversal.
function rootFromWitness(
  key: string,
  value: string,
  siblings: string[],
): string {
  assertEquals(siblings.length, 64);
  const hash = (...parts: Uint8Array[]) =>
    createHash("sha256").update(Buffer.concat(parts)).digest();
  const zero = Buffer.alloc(32);
  const keyHash = hash(Buffer.from(key, "utf8"));
  let index = keyHash.readBigUInt64BE();
  let current = value === ""
    ? zero
    : hash(Buffer.from([0]), keyHash, hash(Buffer.from(value, "hex")));
  for (const encoded of siblings) {
    const sibling = Buffer.from(encoded, "hex");
    assertEquals(sibling.length, 32);
    const [left, right] = index & 1n ? [sibling, current] : [current, sibling];
    current = left.equals(zero) && right.equals(zero)
      ? zero
      : hash(Buffer.from([1]), left, right);
    index >>= 1n;
  }
  return current.toString("hex");
}

Deno.test("tree witness verifier authenticates inclusion exclusion and the shared vector", () => {
  const siblings = Array(64).fill(EMPTY_HASH);
  assert(verifyIbcTreeWitness(VECTOR_KEY, VECTOR_VALUE, siblings, VECTOR_ROOT));
  assert(verifyIbcTreeWitness("absent", "", siblings, EMPTY_HASH));
  assert(
    verifyIbcTreeWitness(
      VECTOR_KEY,
      VECTOR_VALUE.toUpperCase(),
      siblings,
      VECTOR_ROOT.toUpperCase(),
    ),
  );
  assert(
    !verifyIbcTreeWitness("other-key", VECTOR_VALUE, siblings, VECTOR_ROOT),
  );
  assert(!verifyIbcTreeWitness(VECTOR_KEY, "ff", siblings, VECTOR_ROOT));
  assert(!verifyIbcTreeWitness(VECTOR_KEY, "", siblings, VECTOR_ROOT));
  assert(!verifyIbcTreeWitness(VECTOR_KEY, VECTOR_VALUE, siblings, EMPTY_HASH));
  const changed = [...siblings];
  changed[0] = "11".repeat(32);
  assert(!verifyIbcTreeWitness(VECTOR_KEY, VECTOR_VALUE, changed, VECTOR_ROOT));

  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    tree.set(VECTOR_KEY, VECTOR_VALUE);
    tree.set("second", "ff");
    assert(
      verifyIbcTreeWitness(
        VECTOR_KEY,
        VECTOR_VALUE,
        tree.getSiblings(VECTOR_KEY),
        tree.getRoot(),
      ),
    );
    assert(
      verifyIbcTreeWitness(
        "absent",
        "",
        tree.getSiblings("absent"),
        tree.getRoot(),
      ),
    );
    assert(
      !verifyIbcTreeWitness(VECTOR_KEY, VECTOR_VALUE, siblings, tree.getRoot()),
    );
  } finally {
    db.close();
  }
});

Deno.test("tree witness verifier rejects malformed inputs", () => {
  const siblings = Array(64).fill(EMPTY_HASH);
  for (const size of [0, 63, 65]) {
    assertThrows(
      () =>
        verifyIbcTreeWitness(
          VECTOR_KEY,
          VECTOR_VALUE,
          Array(size).fill(EMPTY_HASH),
          VECTOR_ROOT,
        ),
      Error,
      "exactly 64 siblings",
    );
  }
  for (const invalid of ["", "00", "00".repeat(33), "g0".repeat(32)]) {
    assertThrows(() =>
      verifyIbcTreeWitness(VECTOR_KEY, VECTOR_VALUE, siblings, invalid)
    );
    assertThrows(() =>
      verifyIbcTreeWitness(
        VECTOR_KEY,
        VECTOR_VALUE,
        [invalid, ...siblings.slice(1)],
        VECTOR_ROOT,
      )
    );
  }
  assertThrows(() =>
    verifyIbcTreeWitness(VECTOR_KEY, "f", siblings, VECTOR_ROOT)
  );
  assertThrows(() =>
    verifyIbcTreeWitness("\ud800", VECTOR_VALUE, siblings, VECTOR_ROOT)
  );
});

Deno.test("incremental tree matches the shared Aiken commitment vector", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    tree.assertIntegrity();
    assertEquals(tree.getRoot(), EMPTY_HASH);
    assertEquals(tree.get(VECTOR_KEY), undefined);
    assertEquals(tree.entries(), []);
    assertEquals(tree.getSiblings(VECTOR_KEY), Array(64).fill(EMPTY_HASH));
    tree.set(VECTOR_KEY, VECTOR_VALUE);
    assertEquals(tree.get(VECTOR_KEY), VECTOR_VALUE);
    assertEquals(tree.entries(), [[VECTOR_KEY, VECTOR_VALUE]]);
    assertEquals(tree.getRoot(), VECTOR_ROOT);
    assertEquals(
      rootFromWitness(VECTOR_KEY, VECTOR_VALUE, tree.getSiblings(VECTOR_KEY)),
      VECTOR_ROOT,
    );
    assertEquals(
      rootFromWitness("absent", "", tree.getSiblings("absent")),
      VECTOR_ROOT,
    );
    tree.assertIntegrity();
  } finally {
    db.close();
  }
});

Deno.test("incremental tree matches rebuild roots and siblings through deterministic mutations", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    const reference = new DeploymentIbcTree();
    const expected = new Map<string, string>();
    // Include UTF-8 keys and paths above SQLite's signed 64-bit integer maximum.
    const keys = [
      "",
      "\u0000",
      "client/é",
      "client/🌳",
      ...Array.from(
        { length: 20 },
        (_, index) => `clients/${index}/consensusStates/0-7`,
      ),
    ];
    assert(
      keys.some((key) =>
        createHash("sha256").update(key).digest().readBigUInt64BE() > 2n ** 63n
      ),
    );
    let random = 0x51a7e;
    const next =
      () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    for (let step = 0; step < 100; step++) {
      const key = keys[next() % keys.length];
      const value = step % 5 === 0 ? "" : next().toString(16).padStart(8, "0");
      tree.set(key, value);
      reference.set(key, value);
      if (value === "") expected.delete(key);
      else expected.set(key, value);
      assertEquals(tree.get(key), expected.get(key));
      assertEquals(tree.getRoot(), await reference.getRoot());
      for (
        const witnessKey of [key, keys[next() % keys.length], "never-present"]
      ) {
        const siblings = tree.getSiblings(witnessKey);
        assertEquals(siblings, await reference.getSiblings(witnessKey));
        assertEquals(
          rootFromWitness(witnessKey, expected.get(witnessKey) ?? "", siblings),
          tree.getRoot(),
        );
      }
    }
    assertEquals(new Map(tree.entries()), expected);
    tree.assertIntegrity();
    for (const key of expected.keys()) tree.set(key, "");
    assertEquals(tree.getRoot(), EMPTY_HASH);
    assertEquals(tree.entries(), []);
    assertEquals(
      db.prepare("SELECT count(*) AS n FROM ibc_tree_nodes").get()?.n,
      0,
    );
    tree.set("already-absent", "");
    assertEquals(tree.getRoot(), EMPTY_HASH);
    tree.assertIntegrity();
  } finally {
    db.close();
  }
});

Deno.test("incremental tree validates byte hex before mutation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    tree.set("key", "AABB");
    assertEquals(tree.get("key"), "aabb");
    const root = tree.getRoot();
    for (const invalid of ["a", "0x01", "gg", "1g", "01 ", "\n01", "01\n"]) {
      assertThrows(() => tree.set("key", invalid), Error, "byte hex");
      assertEquals(tree.getRoot(), root);
      assertEquals(tree.get("key"), "aabb");
    }
    for (const key of ["\ud800", "\udfff"]) {
      assertThrows(() => tree.set(key, "01"), Error, "UTF-8");
      assertThrows(() => tree.getSiblings(key), Error, "UTF-8");
      assertThrows(() => tree.get(key), Error, "UTF-8");
    }
  } finally {
    db.close();
  }
});

Deno.test("incremental tree fails closed on path collisions including exclusion witnesses", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    tree.set("target", "01");
    const root = tree.getRoot();
    const path = createHash("sha256").update("target").digest("hex").slice(
      0,
      16,
    );
    // Simulate a second full key with the same truncated SHA-256 path without
    // weakening production hashing or requiring a 64-bit collision search.
    db.prepare("UPDATE ibc_tree_leaves SET key = ? WHERE path = ?")
      .run(Buffer.from("other-full-key"), path);
    assertThrows(() => tree.set("target", "02"), Error, "path collision");
    assertThrows(() => tree.set("target", ""), Error, "path collision");
    assertThrows(() => tree.get("target"), Error, "path collision");
    assertThrows(() => tree.getSiblings("target"), Error, "path collision");
    assertEquals(tree.getRoot(), root);
    assertEquals(tree.entries(), [["other-full-key", "01"]]);
    assertThrows(() => tree.assertIntegrity(), Error, "rebuild");
    assertThrows(() =>
      db.prepare(
        "INSERT INTO ibc_tree_leaves (key, path, value) VALUES (?, ?, ?)",
      )
        .run(Buffer.from("third-full-key"), path, "03")
    );
  } finally {
    db.close();
  }
});

Deno.test("incremental tree persists roots leaves and witnesses across database reopening", () => {
  const directory = Deno.makeTempDirSync({ prefix: "ibc-tree-persistence-" });
  const path = `${directory}/tree.sqlite`;
  try {
    let root: string;
    let siblings: string[];
    const first = new DatabaseSync(path);
    try {
      const tree = new IncrementalIbcTree(first);
      tree.set(VECTOR_KEY, VECTOR_VALUE);
      tree.set("second", "42");
      root = tree.getRoot();
      siblings = tree.getSiblings(VECTOR_KEY);
    } finally {
      first.close();
    }
    const second = new DatabaseSync(path);
    try {
      const tree = new IncrementalIbcTree(second);
      tree.assertIntegrity();
      assertEquals(tree.getRoot(), root);
      assertEquals(tree.get(VECTOR_KEY), VECTOR_VALUE);
      assertEquals(tree.get("second"), "42");
      assertEquals(tree.getSiblings(VECTOR_KEY), siblings);
      tree.set("second", "");
      assertEquals(tree.getRoot(), VECTOR_ROOT);
    } finally {
      second.close();
    }
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("incremental tree respects caller rollback and commit without cached state", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    const secondView = new IncrementalIbcTree(db);
    tree.set(VECTOR_KEY, VECTOR_VALUE);
    const initialSiblings = tree.getSiblings(VECTOR_KEY);
    db.exec("BEGIN");
    tree.set(VECTOR_KEY, "07");
    tree.set("new", "08");
    assert(db.isTransaction);
    assertEquals(secondView.getRoot(), tree.getRoot());
    assertNotEquals(tree.getRoot(), VECTOR_ROOT);
    tree.assertIntegrity();
    assert(db.isTransaction);
    db.exec("ROLLBACK");
    tree.assertIntegrity();
    assertEquals(tree.getRoot(), VECTOR_ROOT);
    assertEquals(secondView.getRoot(), VECTOR_ROOT);
    assertEquals(tree.get(VECTOR_KEY), VECTOR_VALUE);
    assertEquals(tree.get("new"), undefined);
    assertEquals(tree.getSiblings(VECTOR_KEY), initialSiblings);
    db.exec("BEGIN");
    tree.set("committed", "09");
    const committedRoot = tree.getRoot();
    assert(db.isTransaction);
    db.exec("COMMIT");
    assertEquals(secondView.getRoot(), committedRoot);
    assertEquals(secondView.get("committed"), "09");
  } finally {
    db.close();
  }
});

Deno.test("incremental tree rolls back partial SQL failures without aborting caller work", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    tree.set(VECTOR_KEY, VECTOR_VALUE);
    db.exec("BEGIN");
    tree.set("caller-work", "ab");
    const root = tree.getRoot();
    const entries = tree.entries();
    const nodes = db.prepare(
      "SELECT * FROM ibc_tree_nodes ORDER BY height, path",
    ).all();
    db.exec(`
      CREATE TEMP TRIGGER fail_tree_update BEFORE INSERT ON ibc_tree_nodes
      WHEN NEW.height = 2
      BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;
    `);
    assertThrows(
      () => tree.set("failed", "03"),
      Error,
      "simulated storage failure",
    );
    assert(db.isTransaction);
    assertEquals(tree.getRoot(), root);
    assertEquals(tree.entries(), entries);
    assertEquals(
      db.prepare("SELECT * FROM ibc_tree_nodes ORDER BY height, path").all(),
      nodes,
    );
    db.exec("ROLLBACK");
    assertEquals(tree.getRoot(), VECTOR_ROOT);
  } finally {
    db.close();
  }
});

Deno.test("incremental tree integrity rejects damaged leaves and missing extra or damaged nodes", async (t) => {
  const cases: Array<[string, (db: DatabaseSync) => void]> = [
    ["changed leaf value", (db) => {
      db.exec("UPDATE ibc_tree_leaves SET value = 'ff'");
    }],
    ["missing leaf", (db) => {
      db.exec("DELETE FROM ibc_tree_leaves");
    }],
    ["incorrect leaf path", (db) => {
      db.exec("UPDATE ibc_tree_leaves SET path = 'ffffffffffffffff'");
    }],
    ["invalid UTF-8 key", (db) => {
      db.prepare("UPDATE ibc_tree_leaves SET key = ?").run(
        new Uint8Array([0xff]),
      );
    }],
    ["malformed leaf hex", (db) => {
      db.exec("PRAGMA ignore_check_constraints = ON");
      db.exec("UPDATE ibc_tree_leaves SET value = 'aZ'");
    }],
    ["noncanonical leaf hex", (db) => {
      db.exec("PRAGMA ignore_check_constraints = ON");
      db.exec("UPDATE ibc_tree_leaves SET value = 'AB'");
    }],
    ["damaged leaf node", (db) => {
      db.prepare("UPDATE ibc_tree_nodes SET hash = ? WHERE height = 0")
        .run("11".repeat(32));
    }],
    ["damaged internal node", (db) => {
      db.prepare("UPDATE ibc_tree_nodes SET hash = ? WHERE height = 12")
        .run("11".repeat(32));
    }],
    ["missing internal node", (db) => {
      db.exec("DELETE FROM ibc_tree_nodes WHERE height = 12");
    }],
    ["missing leaf node", (db) => {
      db.exec("DELETE FROM ibc_tree_nodes WHERE height = 0");
    }],
    ["missing root", (db) => {
      db.exec("DELETE FROM ibc_tree_nodes WHERE height = 64");
    }],
    ["damaged root", (db) => {
      db.prepare("UPDATE ibc_tree_nodes SET hash = ? WHERE height = 64")
        .run("11".repeat(32));
    }],
    ["extra root coordinate", (db) => {
      db.prepare("INSERT INTO ibc_tree_nodes VALUES (64, ?, ?)").run(
        "0000000000000001",
        "11".repeat(32),
      );
    }],
    ["extra leaf node", (db) => {
      db.prepare("INSERT INTO ibc_tree_nodes VALUES (0, ?, ?)").run(
        "0000000000000000",
        "11".repeat(32),
      );
    }],
    ["out-of-range node height", (db) => {
      db.exec("PRAGMA ignore_check_constraints = ON");
      db.prepare("INSERT INTO ibc_tree_nodes VALUES (65, ?, ?)").run(
        "0000000000000000",
        "11".repeat(32),
      );
    }],
  ];
  for (const [name, corrupt] of cases) {
    await t.step(name, () => {
      const db = new DatabaseSync(":memory:");
      try {
        const tree = new IncrementalIbcTree(db);
        tree.set(VECTOR_KEY, VECTOR_VALUE);
        db.exec("BEGIN");
        corrupt(db);
        const before = db.prepare("SELECT total_changes() AS n").get()?.n;
        assertThrows(
          () => tree.assertIntegrity(),
          Error,
          "rebuild the disposable cache from authenticated chain history",
        );
        assert(db.isTransaction);
        assertEquals(
          db.prepare("SELECT total_changes() AS n").get()?.n,
          before,
        );
        db.exec("ROLLBACK");
        tree.assertIntegrity();
        assertEquals(tree.getRoot(), VECTOR_ROOT);
      } finally {
        db.close();
      }
    });
  }
});

Deno.test("incremental tree integrity does not authenticate a consistently substituted cache", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    tree.set(VECTOR_KEY, VECTOR_VALUE);
    const authenticatedRoot = tree.getRoot();
    tree.set(VECTOR_KEY, "ff");
    // Integrity establishes internal consistency only. The caller must still
    // compare the root/proofs against the current authenticated on-chain state.
    tree.assertIntegrity();
    assertNotEquals(tree.getRoot(), authenticatedRoot);
  } finally {
    db.close();
  }
});

Deno.test("incremental tree updates only one path with 10,000 persisted leaves", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const tree = new IncrementalIbcTree(db);
    const started = performance.now();
    db.exec("BEGIN");
    for (let index = 0; index < 10_000; index++) {
      tree.set(`history/${index}`, index.toString(16).padStart(8, "0"));
    }
    assert(db.isTransaction);
    db.exec("COMMIT");
    assertEquals(tree.entries().length, 10_000);
    const integrityStarted = performance.now();
    tree.assertIntegrity();
    console.log(
      `10,000-leaf integrity scan: ${
        (performance.now() - integrityStarted).toFixed(1)
      }ms`,
    );
    const changes = () =>
      db.prepare("SELECT total_changes() AS n").get()?.n as number;
    const before = changes();
    const updateStarted = performance.now();
    tree.set("history/5000", "abcdef");
    const updateMs = performance.now() - updateStarted;
    assertEquals(changes() - before, 66); // One leaf row + 65 nodes, no full rebuild.
    assertEquals(
      rootFromWitness(
        "history/5000",
        "abcdef",
        tree.getSiblings("history/5000"),
      ),
      tree.getRoot(),
    );
    assertEquals(
      rootFromWitness("absent", "", tree.getSiblings("absent")),
      tree.getRoot(),
    );
    // Structural work is the stable regression assertion; wall time is diagnostic
    // only, avoiding a hardware-dependent/flaky benchmark threshold.
    console.log(
      `10,000 leaves: ${(performance.now() - started).toFixed(0)} ms; ` +
        `single update: ${updateMs.toFixed(2)} ms; 66 changed rows`,
    );
  } finally {
    db.close();
  }
});
