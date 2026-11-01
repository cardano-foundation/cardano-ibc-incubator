import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { prepareCachedUpdate } from "../src/tendermint-cache-routing.ts";
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};
import {
  cachedUpdateFixture,
  retainedLeaves,
  retainedScenario,
} from "./tendermint-cache-fixture.ts";
import {
  cacheRecord,
  powerUpdate,
  sharedPowerUpdate,
  validatorMultiproof,
} from "../src/tendermint-cache.ts";

function assertDirectUnderThreeAda(
  result: Awaited<ReturnType<typeof cachedUpdateFixture>>,
) {
  assertEquals(
    result.path,
    "direct",
    JSON.stringify({
      directBudget: result.directBudget,
      completeFee: result.completeFee,
      updateTransactions: result.updateTransactions,
    }),
  );
  assertEquals(result.updateTransactions, 1);
  assertEquals(result.directBudget?.fits, true);
  assertEquals(result.directBudget?.withinLedger, true);
  assertEquals(result.directBudget?.headroomPercent, 5);
  assert(
    result.completeFee < 3_000_000,
    `Complete submitted update costs ${result.completeFee} lovelace`,
  );
  assertEquals(result.completeFee, result.measured.fee);
}

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
    if (mode === "powers") assertDirectUnderThreeAda(result);
  });
}

for (
  const mutation of [
    "total",
    "signature",
    "malformed-header",
    "position",
    "history",
    "processing",
    "cache-output",
    "cache-token",
    "overlap",
    "quorum",
    "trust",
    "unrelated-cache",
    "client-identity",
    "client-address",
    "cache-identity",
    "missing-verifier",
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
  assertEquals(sharedPowerUpdate(retainedLeaves, next, [0]), undefined);
});

Deno.test("shared power-update builder rejects ambiguous or invalid signer positions", () => {
  const old = retainedLeaves.map((leaf) => ({ ...leaf }));
  old[0].power -= 1n;
  for (const positions of [[], [0, 0], [2, 1], [-1], [45], [0.5]]) {
    assertThrows(
      () => sharedPowerUpdate(old, retainedLeaves, positions),
      Error,
      "Signer positions must be sorted and unique",
    );
  }
});

for (const changedIndices of [[11, 20], [0, 14, 26], [0, 14, 26, 38]]) {
  Deno.test(`shared proof submits dispersed powers ${changedIndices.join(",")} below 3 ADA with reserve`, async () => {
    const result = await cachedUpdateFixture("powers", "none", {
      changedIndices,
    });
    assertDirectUnderThreeAda(result);
    assertEquals(result.targetSiblings, 0);
    assertEquals(result.trustedSiblings, 0);
  });
}

Deno.test("evaluated capacity includes populated history, two cache records and 24 dispersed signers", async () => {
  const result = await cachedUpdateFixture("hit", "none", {
    historyRecords: 100,
    twoRecords: true,
    signerCount: 24,
  });
  assertEquals(result.signatures, 24);
  assertEquals(result.historyRecords, 100);
  assertEquals(result.cacheRecords, 2);
  assertDirectUnderThreeAda(result);
});

for (
  const mutation of [
    "admission-total",
    "admission-client",
    "admission-shadow",
    "admission-missing-cache",
  ] as const
) {
  Deno.test(`cache admission rejects ${mutation}`, async () => {
    await assertRejects(
      () => cachedUpdateFixture("hit", mutation),
      Error,
      "cache admission:",
    );
  });
}

Deno.test("transaction-size failure during completion falls back before submission", async () => {
  const result = await cachedUpdateFixture("hit", "none", {
    directSizeFailure: true,
  });
  assertEquals(result.path, "staged");
  assertEquals(result.directBudget, undefined);
  assertEquals(result.rejectedDirectWasSubmitted, false);
});

for (const changedIndices of [[0, 14, 26], [0, 14, 26, 38]]) {
  Deno.test(`shared proof submits ${changedIndices.length} dispersed powers with populated history, two records and 24 signers below 3 ADA`, async () => {
    const result = await cachedUpdateFixture("powers", "none", {
      changedIndices,
      historyRecords: 100,
      twoRecords: true,
      signerCount: 24,
    });
    assertDirectUnderThreeAda(result);
    assertEquals(result.historyRecords, 100);
    assertEquals(result.cacheRecords, 2);
    assertEquals(result.signatures, 24);
  });
}

Deno.test("capacity routing stages a stressed eight-change transaction before submission", async () => {
  const result = await cachedUpdateFixture("powers", "none", {
    changedIndices: [0, 6, 12, 18, 24, 30, 36, 42],
    historyRecords: 100,
    twoRecords: true,
    signerCount: 24,
  });
  assertEquals(result.path, "staged");
  assertEquals(result.directBudget?.fits, false);
  assertEquals(result.rejectedDirectWasSubmitted, false);
});

for (
  const mutation of [
    "shared-old-power",
    "shared-new-power",
    "shared-key",
    "shared-position",
    "shared-missing-signer",
    "shared-missing-neighbor",
    "shared-extra-hash",
    "shared-missing-hash",
    "shared-trusted-witness",
    "shared-target-witness",
    "shared-old-root",
    "quorum",
    "trust",
  ] as const
) {
  Deno.test(
    mutation === "shared-old-root"
      ? "shared proof rejects a valid transition from another cached root"
      : `shared proof rejects ${mutation}`,
    async () => {
      await assertRejects(
        () =>
          cachedUpdateFixture("powers", mutation, {
            changedIndices: mutation === "shared-missing-neighbor"
              ? [0, 26]
              : undefined,
            twoRecords: mutation === "shared-old-root",
          }),
        Error,
        "cached update:",
      );
    },
  );
}

Deno.test("capacity routing leaves invalid-script failures visible", async () => {
  let stagedCalled = false;
  await assertRejects(
    () =>
      prepareCachedUpdate({
        direct: () =>
          Promise.reject(new Error("failed script execution: signature")),
        staged: () => {
          stagedCalled = true;
          return Promise.reject(new Error("unexpected staged construction"));
        },
        limits: parameters,
      }),
    Error,
    "failed script execution: signature",
  );
  assertEquals(stagedCalled, false);
});
