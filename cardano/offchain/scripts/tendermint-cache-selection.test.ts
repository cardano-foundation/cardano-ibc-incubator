import { assert, assertEquals, assertRejects } from "@std/assert";
import { cachedUpdateFixture } from "./tendermint-cache-fixture.ts";
import { dualQuorumScenario } from "./synthetic-tendermint-fixture.ts";

Deno.test("one trusted membership brings the 44-signature update within the direct budget", async () => {
  const { scenario, trusted } = dualQuorumScenario();
  const options = {
    scenario,
    trustedLeaves: trusted,
    generalChange: "unchanged" as const,
    productionWitness: true,
    existingCache: true,
    cacheTarget: true,
  };
  const before = await cachedUpdateFixture("full", "none", {
    ...options,
    allTrustedOverlaps: true,
  });
  const result = await cachedUpdateFixture("full", "none", options);
  console.log(
    JSON.stringify({
      before: {
        path: before.path,
        witness: before.directWitness,
        directBudget: before.directBudget,
        completeFee: before.completeFee,
        updateTransactions: before.updateTransactions,
      },
      after: {
        path: result.path,
        witness: result.directWitness,
        measured: result.measured,
        directBudget: result.directBudget,
        completeFee: result.completeFee,
        updateTransactions: result.updateTransactions,
      },
    }),
  );
  assertEquals(result.signatures, 44);
  assertEquals(before.directWitness?.signatures, 44);
  assertEquals(before.directWitness?.target, 44);
  assertEquals(before.directWitness?.trusted, 44);
  assertEquals(result.directWitness?.signatures, 44);
  assertEquals(result.directWitness?.target, 44);
  assertEquals(result.directWitness?.trusted, 1);
  assert(before.directBudget);
  assert(
    result.directBudget,
    "The direct candidate must reach complete transaction evaluation",
  );
  assert(
    result.directBudget.measured.signedBytes <
      before.directBudget.measured.signedBytes,
  );
  assert(
    result.directBudget.measured.memory < before.directBudget.measured.memory,
  );
  assert(
    result.directBudget.measured.steps < before.directBudget.measured.steps,
  );
  assertEquals(before.path, "staged");
  assertEquals(result.path, "direct");
  assert(result.directBudget.fits);
  assertEquals(result.directBudget.headroomPercent, 5);
  assertEquals(result.updateTransactions, 1);
  assert(result.completeFee < before.completeFee);
});

for (
  const mutation of [
    "cached-trusted-power",
    "cached-trusted-overlap",
    "cached-trusted-unsigned",
  ] as const
) {
  Deno.test(`the minimized trusted proof rejects ${mutation}`, async () => {
    const { scenario, trusted } = dualQuorumScenario();
    await assertRejects(
      () =>
        cachedUpdateFixture("full", mutation, {
          scenario,
          trustedLeaves: trusted,
          generalChange: "unchanged",
          productionWitness: true,
          existingCache: true,
          cacheTarget: true,
        }),
      Error,
      "cached update:",
    );
  });
}

Deno.test("a weighted target replaces the 55-signature prefix with a complete direct update", async () => {
  const { scenario, trusted } = dualQuorumScenario(true);
  const result = await cachedUpdateFixture("full", "none", {
    scenario,
    trustedLeaves: trusted,
    generalChange: "unchanged",
    productionWitness: true,
    existingCache: true,
    cacheTarget: true,
  });
  console.log(
    JSON.stringify({
      path: result.path,
      signatures: result.signatures,
      measured: result.measured,
      directBudget: result.directBudget,
    }),
  );
  assertEquals(result.signatures, 16);
  assertEquals(result.path, "direct");
  assert(result.directBudget?.fits);
  assertEquals(result.updateTransactions, 1);
});
