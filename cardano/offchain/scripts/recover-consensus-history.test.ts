import { assertEquals, assertRejects } from "@std/assert";
import { recoveryJson, recoverHistoryCommand } from "./recover-consensus-history.ts";

Deno.test("recovery preserves bigint witness fields in JSON", () => {
  assertEquals(JSON.parse(recoveryJson({ height: 123n })), { height: "123" });
});

Deno.test("recovery rejects incomplete arguments before reading endpoints", async () => {
  await assertRejects(() => recoverHistoryCommand([]), Error, "Expected deployment JSON");
});

Deno.test("recovery help does not require credentials or open a connection", async () => {
  const original = console.log;
  let output = "";
  console.log = (value) => { output += value; };
  try { await recoverHistoryCommand(["--help"]); } finally { console.log = original; }
  assertEquals(output.includes("YACI_STORE_ENDPOINT"), true);
  assertEquals(output.includes("HISTORY_DB_URL"), false);
});
