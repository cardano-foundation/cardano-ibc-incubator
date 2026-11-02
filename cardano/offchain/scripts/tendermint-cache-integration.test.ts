import { assert, assertEquals, assertRejects } from "@std/assert";
import { CML } from "@lucid-evolution/lucid";
import {
  cachedUpdateFixture,
  type CacheFixtureOptions,
} from "./tendermint-cache-fixture.ts";
import { evaluatedUnsignedUpdateBudget } from "../src/tendermint-cache-routing.ts";
import parameters from "../../../chains/cardano/config/protocol-parameters.json" with {
  type: "json",
};

for (
  const sample of [
    { mode: "hit", options: { emptyCache: true } },
    { mode: "hit", options: {} },
    { mode: "powers", options: { changedIndices: [0, 14, 26] } },
    { mode: "full", options: { uncachedTrusted: true } },
  ] as { mode: "hit" | "powers" | "full"; options: CacheFixtureOptions }[]
) {
  Deno.test(`Gateway proof builder submits ${sample.mode} ${JSON.stringify(sample.options)}`, async () => {
    const result = await cachedUpdateFixture(sample.mode, "none", {
      ...sample.options,
      productionWitness: true,
    });
    assertEquals(result.path, "direct");
    assertEquals(result.updateTransactions, 1);
    assert(result.completeFee < 3_000_000);
    const signed = CML.Transaction.from_cbor_hex(result.signedCbor);
    const witnesses = signed.witness_set();
    witnesses.set_vkeywitnesses(CML.VkeywitnessList.new());
    const unsigned = CML.Transaction.new(
      signed.body(),
      witnesses,
      true,
      signed.auxiliary_data(),
    );
    const predicted = evaluatedUnsignedUpdateBudget(unsigned.to_cbor_hex(), {
      maxTxSize: parameters.maxTxSize,
      maxTxExMem: parameters.maxTxExecutionUnits.memory,
      maxTxExSteps: parameters.maxTxExecutionUnits.steps,
    });
    assertEquals(predicted.measured.signedBytes, result.measured.signedBytes);
    assertEquals(predicted.measured.memory, result.measured.memory);
    assertEquals(predicted.measured.steps, result.measured.steps);
    assert(predicted.fits);
  });
}

Deno.test("an empty paired cache also populates through native staged fallback", async () => {
  const result = await cachedUpdateFixture("hit", "none", {
    emptyCache: true,
    productionWitness: true,
    directSizeFailure: true,
  });
  assertEquals(result.path, "staged");
  assert(result.updateTransactions > 1);
  assert(result.completeFee > 3_000_000);
});

Deno.test("empty cache admission cannot smuggle an additional record", async () => {
  await assertRejects(() =>
    cachedUpdateFixture("hit", "none", {
      emptyCache: true,
      twoRecords: true,
    })
  );
});
