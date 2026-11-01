import { assertEquals, assertRejects } from "@std/assert";
import {
  cachedUpdateFixture,
  retainedLeaves,
  retainedScenario,
} from "./tendermint-cache-fixture.ts";
import {
  cacheRecord,
  powerUpdate,
  validatorMultiproof,
} from "../src/tendermint-cache.ts";

Deno.test("retained 45-validator root has a five-hash multiproof for the selected seventeen signers", () => {
  assertEquals(
    cacheRecord(retainedLeaves).root,
    retainedScenario.header.signed_header.header.validators_hash,
  );
  const indices = retainedLeaves.slice(0, 17).map((leaf) => leaf.index);
  assertEquals(validatorMultiproof(retainedLeaves, indices).length, 5);
});

for (const mode of ["hit", "powers", "full", "adjacent"] as const) {
  Deno.test(`signed cached update: ${mode}`, async () => {
    const result = await cachedUpdateFixture(mode);
    const { signedCbor: _, ...report } = result;
    console.log(JSON.stringify(report));
    assertEquals(result.signatures, 17);
  });
}

for (
  const mutation of [
    "total",
    "signature",
    "position",
    "history",
    "processing",
    "cache-output",
    "cache-token",
    "overlap",
    "quorum",
    "trust",
  ] as const
) {
  Deno.test(`cached update rejects ${mutation}`, async () => {
    await assertRejects(
      () =>
        cachedUpdateFixture(
          mutation === "overlap" ? "powers" : "hit",
          mutation,
        ),
      Error,
      "cached update:",
    );
  });
}

Deno.test("power-update builder falls back for reordered identities", () => {
  const next = retainedLeaves.map((leaf) => ({ ...leaf }));
  next[0].pubkey = "ff".repeat(32);
  assertEquals(powerUpdate(retainedLeaves, next), undefined);
});

Deno.test("cache admission rejects a relayer-supplied denominator", async () => {
  await assertRejects(
    () => cachedUpdateFixture("hit", "admission-total"),
    Error,
    "cache admission:",
  );
});
