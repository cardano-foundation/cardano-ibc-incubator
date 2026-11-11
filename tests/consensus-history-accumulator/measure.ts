import { cachedUpdateFixture } from "../../cardano/offchain/scripts/tendermint-cache-fixture.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { CML } from "@lucid-evolution/lucid";
import parameters from "../../cardano/offchain/scripts/fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

const output = Deno.args[0];
if (!output) throw new Error("Provide an output JSON path");
const measurements = [];
for (const historyRecords of [0, 1, 31, 32, 100, 255, 256, 4095, 6000]) {
  const result = await cachedUpdateFixture("hit", "none", {
    historyRecords,
    routing: "direct",
  });
  const transaction = CML.Transaction.from_cbor_hex(result.signedCbor);
  const hash = CML.hash_transaction(transaction.body());
  assertEquals(hash.to_hex(), result.transactionId);
  const witnesses = transaction.witness_set().vkeywitnesses()!;
  assert(witnesses.len() > 0);
  for (let index = 0; index < witnesses.len(); index++) {
    const witness = witnesses.get(index);
    assert(
      witness.vkey().verify(hash.to_raw_bytes(), witness.ed25519_signature()),
    );
  }
  const units = CML.compute_total_ex_units(
    transaction.witness_set().redeemers()!,
  );
  assertEquals(Number(units.mem()), result.measured.memory);
  assertEquals(Number(units.steps()), result.measured.steps);
  assertEquals(transaction.body().fee(), BigInt(result.completeFee));
  assertEquals(result.updateTransactions, 1);
  assert(result.measured.memory <= parameters.maxTxExMem * 0.95);
  assert(result.measured.steps <= parameters.maxTxExSteps * 0.95);
  assert(result.measured.signedBytes <= parameters.maxTxSize * 0.95);
  const linear = parameters.minFeeB +
    parameters.minFeeA * result.measured.signedBytes;
  assertEquals(parameters.priceMem, 0.0577);
  assertEquals(parameters.priceStep, 0.0000721);
  const execution = Number(
    (units.mem() * 577000n + units.steps() * 721n + 9999999n) / 10000000n,
  );
  let bytes = result.measured.referencedScriptBytes;
  let price = parameters.minFeeRefScriptCostPerByte;
  let references = 0;
  while (bytes > 0) {
    references += Math.min(bytes, 25600) * price;
    bytes -= 25600;
    price *= 1.2;
  }
  references = Math.ceil(references);
  const padding = result.completeFee - linear - execution - references;
  assert(
    padding >= 0 && padding <= 8 * parameters.minFeeA,
    `Unexpected fee padding: ${padding}`,
  );
  const feeComponents = { linear, execution, references, padding };
  measurements.push({ ...result, feeComponents });
  console.error(JSON.stringify({ historyRecords, ...result.measured }));
  await Deno.writeTextFile(output, JSON.stringify(measurements, null, 2));
}
if (Deno.args.includes("--candidate")) {
  for (const mutation of ["history", "signature", "quorum"] as const) {
    await assertRejects(() =>
      cachedUpdateFixture("hit", mutation, {
        historyRecords: 31,
        routing: "direct",
      })
    );
    console.error(`Rejected complete candidate: ${mutation}`);
  }
}
