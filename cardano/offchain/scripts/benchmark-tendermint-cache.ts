import { createHash } from "node:crypto";
import {
  cachedUpdateFixture,
  type CacheFixtureOptions,
} from "./tendermint-cache-fixture.ts";
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
const cases: {
  id: string;
  mode: "hit" | "powers" | "adjacent" | "full";
  options?: CacheFixtureOptions;
}[] = [
  { id: "hit", mode: "hit" },
  { id: "powers", mode: "powers" },
  {
    id: "dispersed-two",
    mode: "powers",
    options: { changedIndices: [11, 20] },
  },
  {
    id: "dispersed-three",
    mode: "powers",
    options: { changedIndices: [0, 14, 26] },
  },
  {
    id: "dispersed-four",
    mode: "powers",
    options: { changedIndices: [0, 14, 26, 38] },
  },
  { id: "signers-24", mode: "hit", options: { signerCount: 24 } },
  {
    id: "populated-hit",
    mode: "hit",
    options: { historyRecords: 100, twoRecords: true, signerCount: 24 },
  },
  {
    id: "populated-powers",
    mode: "powers",
    options: {
      changedIndices: [0, 14, 26, 38],
      historyRecords: 100,
      twoRecords: true,
      signerCount: 24,
    },
  },
  { id: "adjacent", mode: "adjacent" },
  { id: "full", mode: "full" },
];
for (const { id, mode, options } of cases) {
  const { signedCbor, ...result } = await cachedUpdateFixture(
    mode,
    "none",
    options,
  );
  measurements.push({
    id,
    ...result,
    signedTransactionSha256: createHash("sha256").update(signedCbor, "hex")
      .digest("hex"),
  });
  if (write) {
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(
      new URL(`${id}.cbor.hex`, directory),
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
    "Synthetic trusted bootstrap with one-unit power reductions at each listed position. Target header and signatures are the retained Injective fixture. The full fallback also replaces one trusted public key. These are capacity tests, not live changed-set replays.",
  historyFixture:
    "Populated cases seed an assumed previously authenticated 100-record client history after real client/cache admission. They do not replay those historical updates. Two cache records are authenticated by the real admission policy.",
  routing:
    "Evaluate the complete signed direct candidate before submission. Reserve 5% of each ledger limit. Rejected direct candidates are not submitted. Complete fees include every staged verification transaction and finalization. Registration, client creation and reference publication are separate setup costs.",
  ledgerLimits: {
    signedBytes: parameters.maxTxSize,
    memory: parameters.maxTxExMem,
    steps: parameters.maxTxExSteps,
  },
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
