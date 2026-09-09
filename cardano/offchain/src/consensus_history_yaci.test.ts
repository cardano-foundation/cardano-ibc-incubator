import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { UTxO } from "@lucid-evolution/lucid";
import {
  createYaciHistorySource,
  type YaciHistorySqlClient,
} from "./consensus_history_yaci.ts";

const BOOTSTRAP = "aa".repeat(32);
const TIP = "ff".repeat(32);
const deployment = {
  clientToken: { policyId: "11".repeat(28), name: "2233" },
  stateAddress: "addr_test1_prototype",
  bootstrap: { txHash: BOOTSTRAP, outputIndex: 2 },
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

type QueryKind =
  | "begin"
  | "tip"
  | "bootstrap"
  | "page"
  | "commit"
  | "rollback"
  | "recheck";

class MockSql implements YaciHistorySqlClient {
  calls: { kind: QueryKind; sql: string; values: unknown[] }[] = [];
  pages: unknown[][] = [[transaction()]];
  tip: unknown[] = [{ block_height: "20", block_hash: TIP }];
  bootstrap: unknown[] = [{ block_height: "10", transaction_index: "3" }];
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

async function collect(source: ReturnType<typeof createYaciHistorySource>) {
  const result = [];
  for await (const tx of source.transactions()) result.push(tx);
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
  for (const recheck of [[], [{ block_hash: "ee".repeat(32) }]]) {
    const { db, source } = fixture();
    db.recheck = recheck;
    await assertRejects(
      () => collect(source),
      Error,
      "canonical chain changed",
    );
    assertEquals(db.calls.slice(-2).map((call) => call.kind), [
      "commit",
      "recheck",
    ]);
    assert(!db.calls.some((call) => call.kind === "rollback"));
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
