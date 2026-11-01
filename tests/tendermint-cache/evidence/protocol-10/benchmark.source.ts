import { createHash } from "node:crypto";
import {
  cachedUpdateFixture,
  type CacheFixtureOptions,
  retainedQuorumAvailability,
} from "./tendermint-cache-fixture.ts";
import { CACHED_UPDATE_BUDGET } from "../src/tendermint-cache.ts";
import { CARDANO_PROTOCOL_MAJOR_VERSION } from "../src/scalus-evaluator.ts";
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
    id: "populated-three",
    mode: "powers",
    options: {
      changedIndices: [0, 14, 26],
      historyRecords: 100,
      twoRecords: true,
      signerCount: 24,
    },
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
  {
    id: "dispersed-eight",
    mode: "powers",
    options: {
      changedIndices: [0, 6, 12, 18, 24, 30, 36, 42],
      historyRecords: 100,
      twoRecords: true,
      signerCount: 24,
    },
  },
  { id: "adjacent", mode: "adjacent" },
  { id: "full", mode: "full" },
  ...([28, 34] as const).flatMap((count) => [
    {
      id: `availability-${count}`,
      mode: "hit" as const,
      options: { availableSignerIndices: retainedQuorumAvailability[count] },
    },
    {
      id: `availability-powers-${count}`,
      mode: "powers" as const,
      options: { availableSignerIndices: retainedQuorumAvailability[count] },
    },
    {
      id: `availability-populated-${count}`,
      mode: "powers" as const,
      options: {
        availableSignerIndices: retainedQuorumAvailability[count],
        changedIndices: [0, 14, 26, 38],
        historyRecords: 100,
        twoRecords: true,
      },
    },
    {
      id: `availability-eight-${count}`,
      mode: "powers" as const,
      options: {
        availableSignerIndices: retainedQuorumAvailability[count],
        changedIndices: [0, 6, 12, 18, 24, 30, 36, 42],
        historyRecords: 100,
        twoRecords: true,
      },
    },
  ]),
  ...(["replace", "add", "remove", "reorder"] as const).flatMap((
    generalChange,
  ) => [
    {
      id: `general-${generalChange}`,
      mode: "full" as const,
      options: { generalChange },
    },
    ...[false, true].map((uncachedTrusted) => ({
      id: `general-${generalChange}-34-${uncachedTrusted ? "miss" : "cached"}`,
      mode: "full" as const,
      options: {
        generalChange,
        uncachedTrusted,
        availableSignerIndices: retainedQuorumAvailability[34],
        historyRecords: 100,
        twoRecords: true,
      },
    })),
  ]),
  {
    id: "general-unchanged-34-miss",
    mode: "full",
    options: {
      generalChange: "unchanged",
      uncachedTrusted: true,
      availableSignerIndices: retainedQuorumAvailability[34],
      historyRecords: 100,
      twoRecords: true,
    },
  },
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
  blueprintSha256: createHash("sha256").update(
    await Deno.readFile(new URL("../../onchain/plutus.json", import.meta.url)),
  ).digest("hex"),
  evaluator:
    `Scalus, Cardano protocol major version ${CARDANO_PROTOCOL_MAJOR_VERSION}`,
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
    "Synthetic trusted bootstraps with one-unit power reductions or the listed key replacement, addition, removal or reordering. The target header and all selected signatures are the retained Injective fixture. These are capacity tests, not live changed-set replays.",
  historyFixture:
    "Populated cases seed an assumed previously authenticated 100-record client history after real client/cache admission. They do not replay those historical updates. Two cache records are authenticated by the real admission policy.",
  routing:
    "Evaluate the complete signed direct candidate before submission. Reserve 5% of each ledger limit. Rejected direct candidates are not submitted. Complete fees include every staged verification transaction and finalization. Registration, client creation and reference publication are separate setup costs.",
  ledgerLimits: {
    signedBytes: parameters.maxTxSize,
    memory: parameters.maxTxExMem,
    steps: parameters.maxTxExSteps,
  },
  directAcceptance: {
    completeFeeBelow: 3_000_000,
    transactions: 1,
    headroomPercent: 5,
    modes:
      "Every retained normal update case, including eight changes, 28/34-signature availability, general set changes and uncached trusted roots",
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
  measurements.some((result) => result.missedBudgets.length)
) {
  throw new Error(
    "Complete cached update exceeds the 1 ADA acceptance budget. See missedBudgets for the measured components.",
  );
}

if (Deno.args.includes("--assert-direct-budget")) {
  const failed = measurements.filter((result) =>
    result.path !== "direct" || result.updateTransactions !== 1 ||
    result.completeFee >= 3_000_000 || result.directBudget?.fits !== true ||
    result.directBudget.headroomPercent !== 5
  );
  if (failed.length) {
    throw new Error(
      `Direct update acceptance failed: ${
        failed.map((result) => result.id).join(", ")
      }. Every required case must submit one transaction below 3 ADA with the existing 5% reserve.`,
    );
  }
}
