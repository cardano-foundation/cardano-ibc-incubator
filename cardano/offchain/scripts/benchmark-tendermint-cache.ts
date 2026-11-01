import { createHash } from "node:crypto";
import { cachedUpdateFixture } from "./tendermint-cache-fixture.ts";
import { CACHED_UPDATE_BUDGET } from "../src/tendermint-cache.ts";
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

const write = Deno.args.includes("--write");
const directory = new URL(
  "../../../tests/tendermint-cache/evidence/",
  import.meta.url,
);
const measurements = [];
for (const mode of ["hit", "powers", "adjacent", "full"] as const) {
  const { signedCbor, ...result } = await cachedUpdateFixture(mode);
  measurements.push({
    ...result,
    signedTransactionSha256: createHash("sha256").update(signedCbor, "hex")
      .digest("hex"),
  });
  if (write) {
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(
      new URL(`${mode}.cbor.hex`, directory),
      signedCbor + "\n",
    );
  }
}
const report = {
  compiler: "Aiken v1.1.24, silent traces",
  evaluator: "Scalus, Cardano protocol major version 10",
  parameters:
    "cardano/offchain/scripts/fixtures/mainnet-protocol-parameters.json",
  parametersSha256: createHash("sha256").update(
    await Deno.readFile(
      new URL("./fixtures/mainnet-protocol-parameters.json", import.meta.url),
    ),
  ).digest("hex"),
  fixture:
    "cardano/gateway/src/scripts/test/fixtures/tendermint-update-capacity/normalized.json",
  changedSetFixture:
    "Synthetic trusted bootstrap with two one-unit power reductions. Target header and signatures are the retained Injective fixture. The full fallback also replaces one trusted public key. These are not live changed-set samples.",
  acceptanceBudget: CACHED_UPDATE_BUDGET,
  modeledBudgetFee: parameters.minFeeA * CACHED_UPDATE_BUDGET.signedBytes +
    parameters.minFeeB +
    Math.ceil(
      parameters.priceMem * CACHED_UPDATE_BUDGET.memory +
        parameters.priceStep * CACHED_UPDATE_BUDGET.steps,
    ) +
    parameters.minFeeRefScriptCostPerByte *
      CACHED_UPDATE_BUDGET.referencedScriptBytes,
  measurements,
};
const json = JSON.stringify(report, null, 2) + "\n";
console.log(json);
if (write) await Deno.writeTextFile(new URL("report.json", directory), json);
if (
  Deno.args.includes("--assert-budget") &&
  measurements.some((result) =>
    result.mode !== "full" && result.missedBudgets.length
  )
) {
  throw new Error(
    "Complete cached update exceeds the 1 ADA acceptance budget. See missedBudgets for the measured components.",
  );
}
