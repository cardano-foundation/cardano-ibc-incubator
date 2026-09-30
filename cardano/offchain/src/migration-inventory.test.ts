import { assertEquals, assertRejects } from "@std/assert";
import { MigrationInventory } from "./migration-inventory.ts";
import {
  accountingFixture,
  oracleRoot,
} from "./testing/migration-accounting.ts";
Deno.test("inventory cache authenticates retry, competing execution, interruption and rollback against independent roots", async () => {
  const f = await accountingFixture(462, { escrowShards: 8 });
  const policy = f.plan.mintTransferEscrowShard.hash;
  const all = f.shards.map((s) => s.utxo);
  const root = (utxos: typeof all) =>
    oracleRoot(
      new Map(utxos.map((utxo) => [
        f.shards.find((s) => s.utxo === utxo)!.key,
        "01",
      ])),
    );
  const cache = new MigrationInventory();
  const first = await cache.witness(
    "bridge/1",
    policy,
    root(all),
    () => Promise.resolve(all),
  );
  const retry = await cache.witness("bridge/1", policy, root(all), () => {
    throw new Error("Retry must reuse authenticated tree");
  });
  assertEquals(retry, first); // Rejection/unconfirmed submission changes no progress.
  const rest = all.filter((u) => !u.assets[policy + first.name]);
  await cache.witness("bridge/1", policy, root(rest), () => {
    throw new Error("One confirmed move needs no rescan");
  });
  assertEquals(cache.metrics.scans, 1);
  assertEquals(cache.metrics.incrementalDeletes, 1);
  // Relevant rollback restores the old root: local deletion is not authoritative.
  await cache.witness(
    "bridge/1",
    policy,
    root(all),
    () => Promise.resolve(all),
  );
  assertEquals(cache.metrics.scans, 2);
  // Another executor removes a different object. Rebuild, not assumed cursor.
  const different = rest[0];
  const competing = all.filter((u) => u !== different);
  await cache.witness(
    "bridge/1",
    policy,
    root(competing),
    () => Promise.resolve(competing),
  );
  assertEquals(cache.metrics.scans, 3);
  // New process and stale index cannot supply an incomplete/obsolete inventory.
  const fresh = new MigrationInventory();
  await assertRejects(
    () =>
      fresh.witness(
        "bridge/1",
        policy,
        root(competing),
        () => Promise.resolve(all),
      ),
    Error,
    "does not match authenticated",
  );
  await fresh.witness(
    "bridge/1",
    policy,
    root(competing),
    () => Promise.resolve(competing),
  );
  await assertRejects(
    () =>
      fresh.witness(
        "other/2",
        policy,
        root(all),
        () => Promise.resolve([...all, all[0]]),
      ),
    Error,
    "duplicated",
  );
});
