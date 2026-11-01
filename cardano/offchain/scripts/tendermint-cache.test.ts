import { assertEquals, assertRejects } from "@std/assert";
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
});

for (const changedIndices of [[11, 20], [0, 14, 26], [0, 14, 26, 38]]) {
  Deno.test(`evaluated capacity routes dispersed powers ${changedIndices.join(",")} before submission`, async () => {
    const result = await cachedUpdateFixture("powers", "none", {
      changedIndices,
    });
    assertEquals(result.path, "staged");
    assertEquals(result.directBudget?.fits, false);
    assertEquals(result.rejectedDirectWasSubmitted, false);
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
  if (result.path === "staged") {
    assertEquals(result.rejectedDirectWasSubmitted, false);
  }
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

Deno.test("dispersed powers with populated history, two records and 24 signers use a bounded staged transaction", async () => {
  const result = await cachedUpdateFixture("powers", "none", {
    changedIndices: [0, 14, 26, 38],
    historyRecords: 100,
    twoRecords: true,
    signerCount: 24,
  });
  assertEquals(result.path, "staged");
  assertEquals(result.directBudget?.withinLedger, false);
  assertEquals(result.rejectedDirectWasSubmitted, false);
});

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
