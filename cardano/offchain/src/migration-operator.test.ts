import fc from "fast-check";
import { assertEquals } from "@std/assert";
import { runOperatorPopulation } from "./testing/migration-operator.ts";
Deno.test("production migration operator preserves a populated inventory through interruption", async () => {
  const result = await runOperatorPopulation(4, true, true);
  assertEquals(result.transactions, 8);
  assertEquals(result.inventory.scans, 2);
  assertEquals(result.inventory.proofs, 4);
});

Deno.test("generated populations execute production migration builders and validators with independently checked assets and packet state", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        shards: fc.integer({ min: 2, max: 12 }),
        channels: fc.integer({ min: 2, max: 5 }),
        packets: fc.integer({ min: 0, max: 16 }),
        interruption: fc.boolean(),
      }),
      async ({ shards, channels, packets, interruption }) => {
        const result = await runOperatorPopulation(
          shards,
          true,
          interruption,
          channels,
          packets,
        );
        assertEquals(result.transactions, shards + channels + 3);
        assertEquals(result.inventory.proofs, shards);
      },
    ),
    { seed: 462, numRuns: 16 },
  );
});

Deno.test("reviewed migration resolves a seeded transfer-root continuation before approval and Begin", async () => {
  const result = await runOperatorPopulation(2, true, false, 1, 2, true);
  assertEquals(result.transactions, 6);
});
