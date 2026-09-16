import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { EventEmitter } from "node:events";
import {
  historyQueryTimeout,
  withHistoryDatabase,
} from "./recover-consensus-history.ts";

class Client extends EventEmitter {
  calls: string[] = [];
  connecting = () => Promise.resolve();
  querying = () => Promise.resolve({ rows: [] as unknown[] });
  ending = () => Promise.resolve();

  connect(): Promise<void> {
    this.calls.push("connect");
    assertEquals(this.listenerCount("error"), 1);
    return this.connecting();
  }

  query(sql: string): Promise<{ rows: unknown[] }> {
    this.calls.push(sql);
    return this.querying();
  }

  end(): Promise<void> {
    this.calls.push("end");
    return this.ending();
  }
}

Deno.test("one-shot history connection closes before returning success", async () => {
  const client = new Client();
  const result = await withHistoryDatabase(client, async (sql) => {
    await sql.query("SELECT history");
    return "matched root";
  });
  assertEquals(result, "matched root");
  assertEquals(client.calls, ["connect", "SELECT history", "end"]);
  // A late shutdown notification must not become an uncaught EventEmitter error.
  assert(client.emit("error", new Error("late socket shutdown")));
});

Deno.test("background socket failure interrupts an anchor wait and unwinds before close", async () => {
  const client = new Client();
  const readingAnchor = Promise.withResolvers<void>();
  const pendingAnchor = Promise.withResolvers<unknown>();
  let unwound = false;
  client.ending = () => {
    assert(unwound, "SQLite recovery must unwind before connection cleanup");
    return Promise.resolve();
  };
  const result = withHistoryDatabase(client, async (sql, wait) => {
    try {
      await sql.query("BEGIN");
      await wait(() => {
        readingAnchor.resolve();
        return pendingAnchor.promise;
      });
      throw new Error("unreachable success path");
    } finally {
      unwound = true;
    }
  });
  await readingAnchor.promise;
  client.emit("error", new Error("socket closed while SQL was idle"));
  await assertRejects(() => result, Error, "PostgreSQL connection failed");
  assertEquals(client.calls, ["connect", "BEGIN", "end"]);
  pendingAnchor.resolve("late response must be ignored");
});

Deno.test("background failure during connect closes without starting recovery", async () => {
  const client = new Client();
  const connecting = Promise.withResolvers<void>();
  const connected = Promise.withResolvers<void>();
  client.connecting = () => {
    connecting.resolve();
    return connected.promise;
  };
  let ran = false;
  const result = withHistoryDatabase(client, () => {
    ran = true;
    return Promise.resolve("invalid success");
  });
  await connecting.promise;
  client.emit("error", new Error("connection lost"));
  await assertRejects(() => result, Error, "PostgreSQL connection failed");
  connected.resolve();
  assertEquals(ran, false);
  assertEquals(client.calls, ["connect", "end"]);
});

Deno.test("an in-flight query stops on socket failure and handles its late rejection", async () => {
  const client = new Client();
  const querying = Promise.withResolvers<void>();
  const query = Promise.withResolvers<{ rows: unknown[] }>();
  client.querying = () => {
    querying.resolve();
    return query.promise;
  };
  const result = withHistoryDatabase(
    client,
    (sql) => sql.query("SELECT history"),
  );
  await querying.promise;
  const failure = new Error("first socket failure");
  client.emit("error", failure);
  client.emit("error", new Error("secondary socket failure"));
  const error = await assertRejects(
    () => result,
    Error,
    "PostgreSQL connection failed",
  );
  assertEquals(error.cause, failure);
  assertEquals(client.calls, ["connect", "SELECT history", "end"]);
  query.reject(new Error("late query rejection"));
  await Promise.resolve();
});

Deno.test("latched database error cannot be swallowed or followed by another query", async () => {
  const client = new Client();
  await assertRejects(
    () =>
      withHistoryDatabase(client, async (sql) => {
        client.emit("error", new Error("lost socket"));
        await assertRejects(
          () => sql.query("SELECT after failure"),
          Error,
          "PostgreSQL connection failed",
        );
        return "invalid success";
      }),
    Error,
    "PostgreSQL connection failed",
  );
  assertEquals(client.calls, ["connect", "end"]);
});

Deno.test("socket errors during cleanup prevent a false recovery success", async () => {
  const client = new Client();
  client.ending = () => {
    client.emit("error", new Error("postgresql://user:secret@invalid/socket"));
    return Promise.resolve();
  };
  const error = await assertRejects(
    () => withHistoryDatabase(client, () => Promise.resolve("matched root")),
    Error,
    "PostgreSQL connection failed",
  );
  assertEquals(error.message, "PostgreSQL connection failed");
  assertEquals(client.calls, ["connect", "end"]);
});

Deno.test("query timeout and cleanup errors both propagate without losing ownership", async () => {
  const client = new Client();
  const timeout = new Error("Query read timeout");
  const cleanup = new Error("cleanup failed");
  client.querying = () => Promise.reject(timeout);
  client.ending = () => Promise.reject(cleanup);
  const error = await assertRejects(
    () =>
      withHistoryDatabase(client, async (sql) => {
        await sql.query("SELECT slow history");
      }),
    AggregateError,
    "History database recovery or cleanup failed",
  );
  assertEquals(error.errors, [timeout, cleanup]);
  assertEquals(client.calls, ["connect", "SELECT slow history", "end"]);
});

Deno.test("history query timeout is finite and cannot silently disable the limit", () => {
  assertEquals(historyQueryTimeout(undefined), 30_000);
  assertEquals(historyQueryTimeout("1"), 1);
  assertEquals(historyQueryTimeout("600000"), 600_000);
  for (
    const value of ["", "0", "-1", "1.5", " 1", "1e3", "Infinity", "600001"]
  ) {
    assertThrows(
      () => historyQueryTimeout(value),
      Error,
      "between 1 and 600000",
    );
  }
});
