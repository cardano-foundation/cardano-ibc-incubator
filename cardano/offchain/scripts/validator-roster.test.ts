import { assert, assertEquals, assertRejects } from "@std/assert";
import { cachedUpdateFixture } from "./tendermint-cache-fixture.ts";
import { dualQuorumScenario } from "./synthetic-tendermint-fixture.ts";

for (const mode of ["hit", "powers"] as const) {
  Deno.test(`roster prototype complete ${mode} transaction`, async () => {
    const baseline = await cachedUpdateFixture(mode, "none", {
      productionWitness: true,
    });
    const prototype = await cachedUpdateFixture(mode, "none", {
      productionWitness: true,
      roster: mode === "hit" ? "hit" : "refresh",
    });
    console.log(JSON.stringify({
      mode,
      baseline: {
        fee: baseline.completeFee,
        measured: baseline.measured,
        admission: baseline.admissionFee,
      },
      prototype: {
        fee: prototype.completeFee,
        measured: prototype.measured,
        admission: prototype.admissionFee,
        roster: prototype.roster,
        budgets: prototype.redeemerBudgets,
      },
    }));
    assertEquals(prototype.path, "direct");
    assert(prototype.directBudget?.fits);
    assert(prototype.roster);
    assertEquals(prototype.publicCommitments, baseline.publicCommitments);
  });
}

Deno.test("roster prototype hit across different cached roots", async () => {
  const { scenario, trusted } = dualQuorumScenario(false, 7);
  const result = await cachedUpdateFixture("full", "none", {
    productionWitness: true,
    roster: "hit",
    cacheTarget: true,
    scenario,
    trustedLeaves: trusted,
    generalChange: "unchanged",
  });
  assertEquals(result.path, "direct");
  assert(result.directBudget?.fits);
});

for (
  const attack of [
    "admission-root",
    "admission-count",
    "admission-total",
    "admission-rows",
    "admission-owner",
    "admission-client",
    "admission-token",
    "admission-three",
    "admission-script",
    "forged-roster",
    "wrong-policy",
    "hit-signature",
    "hit-quorum",
    "hit-index",
    "hit-missing",
  ] as const
) {
  Deno.test(`roster authentication rejects ${attack}`, async () => {
    await assertRejects(
      () =>
        cachedUpdateFixture("hit", "none", {
          productionWitness: true,
          roster: "hit",
          rosterAttack: attack,
        }),
      Error,
      "failed script execution",
    );
  });
}

for (const attack of ["hit-overlap", "hit-unsigned"] as const) {
  Deno.test(`different-root roster rejects ${attack}`, async () => {
    const { scenario, trusted } = dualQuorumScenario(false, 7);
    await assertRejects(
      () =>
        cachedUpdateFixture("full", "none", {
          scenario,
          trustedLeaves: trusted,
          generalChange: "unchanged",
          cacheTarget: true,
          productionWitness: true,
          roster: "hit",
          rosterAttack: attack,
        }),
      Error,
      "failed script execution",
    );
  });
}

for (
  const attack of [
    "refresh-total",
    "refresh-known",
    "refresh-owner",
    "refresh-empty",
    "refresh-three",
    "refresh-withdraw",
    "refresh-script",
  ] as const
) {
  Deno.test(`roster refresh rejects ${attack}`, async () => {
    await assertRejects(
      () =>
        cachedUpdateFixture("powers", "none", {
          productionWitness: true,
          roster: "refresh",
          rosterAttack: attack,
          rosterReserve: 30_000_000n,
        }),
      Error,
      "failed script execution",
    );
  });
}

Deno.test("the roster owner retires the helper and recovers its reserve while the client remains", async () => {
  const result = await cachedUpdateFixture("hit", "none", {
    productionWitness: true,
    roster: "hit",
    closeRoster: "close",
  });
  assertEquals(result.retirement?.refunded, result.roster?.currentLovelace);
});

for (
  const close of [
    "no-authority",
    "short-refund",
    "wrong-owner",
    "no-burn",
  ] as const
) {
  Deno.test(`roster retirement rejects ${close}`, async () => {
    await assertRejects(
      () =>
        cachedUpdateFixture("hit", "none", {
          productionWitness: true,
          roster: "hit",
          closeRoster: close,
        }),
      Error,
      "failed script execution",
    );
  });
}

Deno.test("the opt-in wrapper retains the ordinary cache fallback without spending the roster", async () => {
  const result = await cachedUpdateFixture("hit", "none", {
    productionWitness: true,
    roster: "fallback",
  });
  assertEquals(result.path, "direct");
  assert(result.directBudget?.fits);
});

Deno.test("empty roster admission accompanies the first accepted full update", async () => {
  const result = await cachedUpdateFixture("hit", "none", {
    productionWitness: true,
    roster: "refresh",
    emptyCache: true,
  });
  assertEquals(result.path, "direct");
  assert(result.directBudget?.fits);
});

Deno.test("the roster identity cannot be minted again after client creation", async () => {
  await assertRejects(
    () =>
      cachedUpdateFixture("hit", "none", {
        productionWitness: true,
        roster: "hit",
        remintRoster: true,
      }),
    Error,
    "failed script execution",
  );
});

Deno.test("refresh retains an authenticated second roster when its root is still cached", async () => {
  const result = await cachedUpdateFixture("hit", "none", {
    productionWitness: true,
    roster: "refresh",
    twoRecords: true,
  });
  assertEquals(result.path, "direct");
  assert(result.directBudget?.fits);
});

Deno.test("the opt-in wrapper retains staged finalization with roster admission", async () => {
  const result = await cachedUpdateFixture("powers", "none", {
    productionWitness: true,
    roster: "refresh",
    routing: "staged",
  });
  assertEquals(result.path, "staged");
  assert(result.updateTransactions > 1);
});
