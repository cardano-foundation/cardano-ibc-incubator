import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { UTxO } from "@lucid-evolution/lucid";
import {
  createYaciHistorySource,
  type YaciHistorySqlClient,
} from "./consensus_history_yaci.ts";
import {
  HistoryIntersectionError,
  type HistoryPoint,
  HistorySnapshotChangedError,
} from "./consensus_history_recovery.ts";

const BOOTSTRAP = "aa".repeat(32);
const TIP = "ff".repeat(32);
const deployment = {
  clientToken: { policyId: "11".repeat(28), name: "2233" },
  stateAddress: "addr_test1_prototype",
  bootstrap: { txHash: BOOTSTRAP, outputIndex: 2 },
};
const RESUME: HistoryPoint = {
  txHash: "cc".repeat(32),
  blockHash: "dd".repeat(32),
  blockHeight: 12,
  slot: 120,
  transactionIndex: 0,
};

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    tx_hash: BOOTSTRAP,
    block_hash: "bb".repeat(32),
    block_height: "10",
    slot: "100",
    transaction_index: 3,
    cbor: "83008080",
    ...overrides,
  };
}

function resumedTransaction(overrides: Record<string, unknown> = {}) {
  return transaction({
    tx_hash: RESUME.txHash,
    block_hash: RESUME.blockHash,
    block_height: String(RESUME.blockHeight),
    slot: String(RESUME.slot),
    transaction_index: RESUME.transactionIndex,
    ...overrides,
  });
}

type QueryKind =
  | "begin"
  | "tip"
  | "bootstrap"
  | "intersection"
  | "page"
  | "commit"
  | "rollback"
  | "recheck";

class MockSql implements YaciHistorySqlClient {
  calls: { kind: QueryKind; sql: string; values: unknown[] }[] = [];
  pages: unknown[][] = [[transaction()]];
  tip: unknown[] = [{ block_height: "20", block_hash: TIP }];
  bootstrap: unknown[] = [{ block_height: "10", transaction_index: "3" }];
  intersection: unknown[] = [resumedTransaction({ has_state_nft: true })];
  recheck: unknown[] = [{ block_hash: TIP }];
  fail?: QueryKind;

  query(sql: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
    const normalized = sql.trim();
    const kind = normalized.startsWith("BEGIN")
      ? "begin"
      : normalized === "COMMIT"
      ? "commit"
      : normalized === "ROLLBACK"
      ? "rollback"
      : normalized.match(/consensus-history:(\w+)/)?.[1] as QueryKind;
    assert(kind, `Unexpected query: ${sql}`);
    this.calls.push({ kind, sql, values: [...values] });
    if (this.fail === kind) {
      return Promise.reject(new Error(`injected ${kind} failure`));
    }
    return Promise.resolve({
      rows: kind === "page"
        ? this.pages.shift() ?? []
        : kind === "tip"
        ? this.tip
        : kind === "bootstrap"
        ? this.bootstrap
        : kind === "intersection"
        ? this.intersection
        : kind === "recheck"
        ? this.recheck
        : [],
    });
  }
}

function fixture(db = new MockSql(), pageSize = 2) {
  const live: UTxO = {
    txHash: "cc".repeat(32),
    outputIndex: 0,
    address: deployment.stateAddress,
    datum: "d87980",
    assets: { lovelace: 3_000_000n },
  };
  let reads = 0;
  const source = createYaciHistorySource(db, deployment, () => {
    reads++;
    return Promise.resolve(live);
  }, { pageSize });
  return { db, source, live, reads: () => reads };
}

async function collect(
  source: ReturnType<typeof createYaciHistorySource>,
  after?: HistoryPoint,
) {
  const result = [];
  for await (const tx of source.transactions(after)) result.push(tx);
  return result;
}

Deno.test("Yaci uses an exact NFT, canonical joins and keyset pages including spent outputs", async () => {
  const { db, source } = fixture();
  db.pages = [
    [
      transaction(),
      transaction({ tx_hash: "cc".repeat(32), transaction_index: 4 }),
    ],
    [transaction({
      tx_hash: "dd".repeat(32),
      block_height: 11,
      transaction_index: 0,
      slot: 101,
    })],
  ];
  const result = await collect(source);
  assertEquals(result.map((tx) => [tx.blockHeight, tx.transactionIndex]), [
    [10, 3],
    [10, 4],
    [11, 0],
  ]);
  assertEquals(result[0].cbor, "83008080");
  assertEquals(result[0].slot, 100);
  assertEquals(db.calls.map((call) => call.kind), [
    "begin",
    "tip",
    "bootstrap",
    "page",
    "page",
    "commit",
    "recheck",
  ]);
  assertEquals(
    db.calls[0].sql,
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  const unit = deployment.clientToken.policyId + deployment.clientToken.name;
  const bootstrap = db.calls.find((call) => call.kind === "bootstrap")!;
  assertEquals(bootstrap.values, [deployment.stateAddress, unit, BOOTSTRAP, 2]);
  assert(bootstrap.sql.includes("a.output_index = $4"));
  const pages = db.calls.filter((call) => call.kind === "page");
  assertEquals(pages[0].values, [deployment.stateAddress, unit, 10, 2, 20, 2]);
  assertEquals(pages[1].values, [deployment.stateAddress, unit, 10, 4, 20, 2]);
  for (const { sql } of [bootstrap, ...pages]) {
    assert(sql.includes("b.number = t.block AND b.hash = t.block_hash"));
    assert(sql.includes("lower(amount->>'unit') = $2"));
    assert(sql.includes("amount->>'quantity' = '1'"));
    assert(sql.includes("a.owner_addr = $1 OR a.owner_addr_full = $1"));
    assert(!/unspent|spent_at|consumed|bridge_|LIKE|OFFSET/i.test(sql));
  }
  assert(pages[0].sql.includes("LEFT JOIN transaction_cbor"));
  assert(pages[0].sql.includes("ORDER BY t.block ASC, t.tx_index ASC"));
  assertEquals(db.calls.at(-1)?.values, [20]);
});

Deno.test("Yaci resumes inclusively without bootstrap or earlier-history scans", async () => {
  const { db, source } = fixture();
  db.pages = [
    [
      resumedTransaction(),
      resumedTransaction({ tx_hash: "ee".repeat(32), transaction_index: 1 }),
    ],
    [resumedTransaction({
      tx_hash: "ab".repeat(32),
      block_height: 13,
      slot: 130,
    })],
  ];
  const result = await collect(source, RESUME);
  assertEquals(result.map((tx) => [tx.blockHeight, tx.transactionIndex]), [
    [12, 0],
    [12, 1],
    [13, 0],
  ]);
  assertEquals(result[0], { ...RESUME, cbor: "83008080" });
  assertEquals(db.calls.map((call) => call.kind), [
    "begin",
    "tip",
    "intersection",
    "page",
    "page",
    "commit",
    "recheck",
  ]);
  const unit = deployment.clientToken.policyId + deployment.clientToken.name;
  const intersection = db.calls.find((call) => call.kind === "intersection")!;
  assertEquals(intersection.values, [deployment.stateAddress, unit, 12, 0]);
  assert(intersection.sql.includes("LEFT JOIN transaction t"));
  assert(
    intersection.sql.includes("b.number = t.block AND b.hash = t.block_hash"),
  );
  assert(intersection.sql.includes("t.tx_index = $4"));
  assert(intersection.sql.includes("WHERE b.number = $3"));
  assert(intersection.sql.includes("lower(amount->>'unit') = $2"));
  assert(intersection.sql.includes("amount->>'quantity' = '1'"));
  assert(
    intersection.sql.includes("a.owner_addr = $1 OR a.owner_addr_full = $1"),
  );
  assert(
    !/unspent|spent_at|consumed|bridge_|LIKE|OFFSET/i.test(intersection.sql),
  );
  const pages = db.calls.filter((call) => call.kind === "page");
  assertEquals(pages[0].values, [deployment.stateAddress, unit, 12, -1, 20, 2]);
  assertEquals(pages[1].values, [deployment.stateAddress, unit, 12, 1, 20, 2]);
});

Deno.test("Yaci reports a lost resume intersection before yielding any evidence", async () => {
  for (
    const intersection of [
      [],
      [resumedTransaction({
        block_hash: "ee".repeat(32),
        has_state_nft: true,
      })],
    ]
  ) {
    const { db, source } = fixture();
    db.intersection = intersection;
    await assertRejects(
      () => collect(source, RESUME),
      HistoryIntersectionError,
      "no longer canonical",
    );
    assertEquals(db.calls.map((call) => call.kind), [
      "begin",
      "tip",
      "intersection",
      "rollback",
    ]);
  }
});

Deno.test("Yaci source lag is a hard error, not a lost intersection", async () => {
  const { db, source } = fixture();
  db.tip = [{ block_height: 11, block_hash: TIP }];
  const error = await assertRejects(
    () => collect(source, RESUME),
    Error,
    "behind the resume point",
  );
  assert(!(error instanceof HistoryIntersectionError));
  assertEquals(db.calls.map((call) => call.kind), ["begin", "tip", "rollback"]);
});

Deno.test("Yaci does not rewind away missing or corrupt canonical resume evidence", async () => {
  for (
    const change of [
      { tx_hash: null },
      { tx_hash: "ee".repeat(32) },
      { block_hash: "invalid" },
      { block_height: 13 },
      { transaction_index: 1 },
      { slot: 121 },
      { has_state_nft: false },
      { has_state_nft: undefined },
      { has_state_nft: "true" },
    ]
  ) {
    const { db, source } = fixture();
    db.intersection = [resumedTransaction({ has_state_nft: true, ...change })];
    const error = await assertRejects(() => collect(source, RESUME));
    assert(!(error instanceof HistoryIntersectionError));
    assert(!db.calls.some((call) => call.kind === "page"));
    assertEquals(db.calls.at(-1)?.kind, "rollback");
  }
  const { db, source } = fixture();
  db.intersection = [db.intersection[0], db.intersection[0]];
  const error = await assertRejects(
    () => collect(source, RESUME),
    Error,
    "ambiguous canonical evidence",
  );
  assert(!(error instanceof HistoryIntersectionError));
});

Deno.test("Yaci requires first resume evidence to match every checkpoint component", async () => {
  for (
    const change of [
      { tx_hash: "ee".repeat(32) },
      { block_hash: "ee".repeat(32) },
      { block_height: 13 },
      { transaction_index: 1 },
      { slot: 121 },
    ]
  ) {
    const { db, source } = fixture();
    db.pages = [[resumedTransaction(change)]];
    const error = await assertRejects(
      () => collect(source, RESUME),
      Error,
      "validated resume point",
    );
    assert(!(error instanceof HistoryIntersectionError));
    assertEquals(db.calls.at(-1)?.kind, "rollback");
  }
  for (const pages of [[], [[resumedTransaction({ cbor: null })]]]) {
    const { db, source } = fixture();
    db.pages = pages;
    const error = await assertRejects(() => collect(source, RESUME));
    assert(!(error instanceof HistoryIntersectionError));
    assertEquals(db.calls.at(-1)?.kind, "rollback");
  }
});

Deno.test("Yaci validates resume counters and copies them before awaiting SQL", async () => {
  for (
    const change of [
      { blockHeight: -1 },
      { slot: 1.5 },
      { transactionIndex: Number.MAX_SAFE_INTEGER + 1 },
      { txHash: "invalid" },
      { blockHash: "invalid" },
    ]
  ) {
    const { db, source } = fixture();
    const error = await assertRejects(() =>
      collect(source, { ...RESUME, ...change })
    );
    assert(!(error instanceof HistoryIntersectionError));
    assertEquals(db.calls.length, 0);
    // Invalid arguments do not retain the exclusive-connection guard.
    assertEquals((await collect(source)).length, 1);
  }
  const { db, source } = fixture();
  db.pages = [[resumedTransaction()]];
  const after = { ...RESUME };
  const pending = collect(source, after);
  after.txHash = "ee".repeat(32);
  after.blockHeight = 999;
  assertEquals((await pending)[0], { ...RESUME, cbor: "83008080" });
});

Deno.test("Yaci closes resume snapshots on intersection query errors and cancellation", async () => {
  const { db, source } = fixture();
  db.fail = "intersection";
  await assertRejects(
    () => collect(source, RESUME),
    Error,
    "injected intersection failure",
  );
  assertEquals(db.calls.at(-1)?.kind, "rollback");
  db.fail = undefined;
  db.pages = [[resumedTransaction()]];
  for await (const _ of source.transactions(RESUME)) break;
  assertEquals(db.calls.at(-1)?.kind, "rollback");
  assert(!db.calls.some((call) => call.kind === "commit"));
  db.pages = [[resumedTransaction()]];
  assertEquals((await collect(source, RESUME)).length, 1);
});

Deno.test("Yaci delegates independently read live anchors without caching them", async () => {
  const { source, live, reads } = fixture();
  assertEquals(reads(), 0);
  assertEquals(await source.currentState(), live);
  await collect(source);
  assertEquals(await source.currentState(), live);
  assertEquals(reads(), 2);
});

Deno.test("Yaci fails on missing or invalid raw CBOR instead of skipping evidence", async () => {
  for (const cbor of [null, undefined, "", "0", "xyz"]) {
    const { source, db } = fixture();
    db.pages = [[transaction({ cbor })]];
    await assertRejects(() => collect(source), Error, "raw transaction CBOR");
    assertEquals(db.calls.at(-1)?.kind, "rollback");
    assert(!db.calls.some((call) => call.kind === "commit"));
  }
});

Deno.test("Yaci rejects unsafe/noninteger counters and invalid paging configuration", async () => {
  for (const field of ["block_height", "slot", "transaction_index"]) {
    for (
      const invalid of [
        null,
        "",
        "-1",
        "1.5",
        1.5,
        -1,
        Number.MAX_SAFE_INTEGER + 1,
        "9007199254740993",
      ]
    ) {
      const { source, db } = fixture();
      db.pages = [[transaction({ [field]: invalid })]];
      await assertRejects(() => collect(source), Error, "safe integer");
      assertEquals(db.calls.at(-1)?.kind, "rollback");
    }
  }
  for (const size of [0, -1, 1.5, 1001, Number.POSITIVE_INFINITY]) {
    assertThrows(() => fixture(new MockSql(), size), Error, "page size");
  }
  const { source, db } = fixture();
  db.tip = [{ block_height: "9007199254740993", block_hash: TIP }];
  await assertRejects(() => collect(source), Error, "safe integer");
});

Deno.test("Yaci requires canonical bootstrap evidence and a bounded page", async () => {
  for (const bootstrap of [[], [{ block_height: 30, transaction_index: 0 }]]) {
    const { db, source } = fixture();
    db.bootstrap = bootstrap;
    await assertRejects(() => collect(source), Error, "bootstrap");
    assertEquals(db.calls.at(-1)?.kind, "rollback");
  }
  for (const pages of [[], [[transaction({ tx_hash: "cc".repeat(32) })]]]) {
    const { db, source } = fixture();
    db.pages = pages;
    await assertRejects(() => collect(source), Error, "bootstrap");
  }
  const { db, source } = fixture();
  db.pages = [[transaction(), transaction(), transaction()]];
  await assertRejects(() => collect(source), Error, "page limit");
});

Deno.test("Yaci rejects duplicate, backwards or beyond-snapshot transaction order", async () => {
  for (
    const next of [
      transaction(),
      transaction({ block_height: 9 }),
      transaction({ transaction_index: 2 }),
      transaction({ block_height: 21 }),
    ]
  ) {
    const { db, source } = fixture(new MockSql(), 1);
    db.pages = [[transaction()], [next]];
    await assertRejects(() => collect(source), Error, "order");
    assertEquals(db.calls.at(-1)?.kind, "rollback");
  }
});

Deno.test("Yaci fresh canonical recheck detects a rollback after the read snapshot", async () => {
  for (const after of [undefined, RESUME]) {
    for (const recheck of [[], [{ block_hash: "ee".repeat(32) }]]) {
      const { db, source } = fixture();
      if (after) db.pages = [[resumedTransaction()]];
      db.recheck = recheck;
      await assertRejects(
        () => collect(source, after),
        HistorySnapshotChangedError,
        "canonical chain changed",
      );
      assertEquals(db.calls.slice(-2).map((call) => call.kind), [
        "commit",
        "recheck",
      ]);
      assert(!db.calls.some((call) => call.kind === "rollback"));
    }
  }
});

Deno.test("Yaci corrupt canonical recheck evidence is a hard failure, not a retry signal", async () => {
  for (
    const recheck of [
      [{ block_hash: "invalid" }],
      [{ block_hash: TIP }, { block_hash: TIP }],
    ]
  ) {
    const { db, source } = fixture();
    db.recheck = recheck;
    const error = await assertRejects(() => collect(source));
    assert(!(error instanceof HistorySnapshotChangedError));
    assertEquals(db.calls.at(-1)?.kind, "recheck");
  }
});

Deno.test("Yaci closes read snapshots on query failures and iterator cancellation", async () => {
  for (const fail of ["begin", "tip", "bootstrap", "page", "commit"] as const) {
    const { db, source } = fixture();
    db.fail = fail;
    await assertRejects(
      () => collect(source),
      Error,
      `injected ${fail} failure`,
    );
    assertEquals(db.calls.at(-1)?.kind, "rollback");
  }
  const { db, source } = fixture(new MockSql(), 1);
  db.pages = [[transaction()]];
  for await (const _ of source.transactions()) break;
  assertEquals(db.calls.at(-1)?.kind, "rollback");
  assert(!db.calls.some((call) => call.kind === "commit"));
  // The exclusive-use guard is released even after cancellation.
  db.pages = [[transaction()], []];
  assertEquals((await collect(source)).length, 1);
});

Deno.test("Yaci prevents simultaneous iterators on one SQL connection", async () => {
  const { db, source } = fixture(new MockSql(), 1);
  const first = source.transactions()[Symbol.asyncIterator]();
  await first.next();
  await assertRejects(() => collect(source), Error, "already in use");
  await first.return?.();
  assertEquals(db.calls.at(-1)?.kind, "rollback");
});

Deno.test("Yaci preserves cleanup failures and refuses to reuse an uncertain connection", async () => {
  const { db, source } = fixture();
  db.pages = [[transaction({ cbor: null })]];
  db.fail = "rollback";
  const failure = await assertRejects(
    () => collect(source),
    AggregateError,
    "discard the SQL connection",
  );
  assertEquals(failure.errors.length, 2);
  assert(failure.errors[0].message.includes("raw transaction CBOR"));
  assert(failure.errors[1].message.includes("injected rollback failure"));
  db.fail = undefined;
  db.pages = [[transaction()]];
  const count = db.calls.length;
  await assertRejects(
    () => collect(source),
    Error,
    "discard the SQL connection",
  );
  assertEquals(db.calls.length, count);
});
