import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  cachedUpdateFixture,
  type CacheFixtureOptions,
  retainedQuorumAvailability,
} from "./tendermint-cache-fixture.ts";
import { rosterEconomics } from "./validator-roster-economics.ts";
import { CARDANO_PROTOCOL_MAJOR_VERSION } from "../src/scalus-evaluator.ts";
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

if (Deno.args.some((arg) => arg !== "--write")) {
  throw new Error("Only --write is supported");
}
const write = Deno.args.includes("--write");
const directory = new URL(
  "../../../tests/validator-roster/evidence/",
  import.meta.url,
);
if (write) await Deno.mkdir(directory, { recursive: true });
const sha = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const cases: {
  id: string;
  mode: "hit" | "powers" | "full";
  kind: "hit" | "refresh";
  options?: CacheFixtureOptions;
}[] = [
  { id: "hit-17", mode: "hit", kind: "hit" },
  {
    id: "hit-28",
    mode: "hit",
    kind: "hit",
    options: { availableSignerIndices: retainedQuorumAvailability[28] },
  },
  {
    id: "hit-34",
    mode: "hit",
    kind: "hit",
    options: { availableSignerIndices: retainedQuorumAvailability[34] },
  },
  { id: "powers-two-17", mode: "powers", kind: "refresh" },
  {
    id: "powers-three-28",
    mode: "powers",
    kind: "refresh",
    options: {
      changedIndices: [0, 14, 26],
      availableSignerIndices: retainedQuorumAvailability[28],
    },
  },
  {
    id: "powers-eight-34",
    mode: "powers",
    kind: "refresh",
    options: {
      changedIndices: [0, 6, 12, 18, 24, 30, 36, 42],
      availableSignerIndices: retainedQuorumAvailability[34],
    },
  },
  { id: "general-replace-17", mode: "full", kind: "refresh" },
  {
    id: "first-admission-17",
    mode: "hit",
    kind: "refresh",
    options: { emptyCache: true },
  },
];

async function evidence(
  id: string,
  name: string,
  result: Awaited<ReturnType<typeof cachedUpdateFixture>>,
) {
  const filename = `${id}-${name}.cbor.hex`;
  if (write) {
    await Deno.writeTextFile(
      new URL(filename, directory),
      result.signedCbor + "\n",
    );
  }
  return {
    path: result.path,
    completeFeeLovelace: result.completeFee,
    updateTransactions: result.updateTransactions,
    measured: result.measured,
    publicCommitments: result.publicCommitments,
    directBudget: result.directBudget,
    admissionFeeLovelace: result.admissionFee,
    admissionBudget: result.admissionBudget,
    signatures: result.signatures,
    transactionId: result.transactionId,
    signedTransactionSha256: sha(Buffer.from(result.signedCbor, "hex")),
    signedTransactionFile: filename,
    fallbackSessions: result.fallbackSessions,
    roster: result.roster,
    retirement: result.retirement,
    registration: result.registration,
    publicationFeesLovelace: result.publicationFees,
    publicationMinimumAdaLovelace: result.publicationMinimumAda,
    redeemerBudgets: result.redeemerBudgets,
  };
}

const measurements: {
  id: string;
  kind: "hit" | "refresh";
  baseline: Awaited<ReturnType<typeof evidence>>;
  prototype: Awaited<ReturnType<typeof evidence>>;
  savingLovelace: number;
}[] = [];
for (const sample of cases) {
  const options = { ...sample.options, productionWitness: true };
  const baseline = await cachedUpdateFixture(sample.mode, "none", options);
  const prototype = await cachedUpdateFixture(sample.mode, "none", {
    ...options,
    roster: sample.kind,
    closeRoster: sample.id === "hit-17" ? "close" : undefined,
  });
  const measurement = {
    id: sample.id,
    kind: sample.kind,
    baseline: await evidence(sample.id, "baseline", baseline),
    prototype: await evidence(sample.id, "prototype", prototype),
    savingLovelace: baseline.completeFee - prototype.completeFee,
  };
  measurements.push(measurement);
  console.log(
    JSON.stringify({
      id: sample.id,
      baseline: baseline.completeFee,
      prototype: prototype.completeFee,
      path: prototype.path,
    }),
  );
}
const pair = (hit: string, changed: string) => {
  const a = measurements.find((m) => m.id === hit)!;
  const b = measurements.find((m) => m.id === changed)!;
  return {
    hit,
    changed,
    ...rosterEconomics(a.savingLovelace, -b.savingLovelace),
  };
};
const sourceFiles = [
  "cardano/onchain/lib/ibc/client/ics-007-tendermint-client/cached/roster.ak",
  "cardano/onchain/lib/ibc/client/ics-007-tendermint-client/cached/roster_update.ak",
  "cardano/onchain/lib/ibc/client/ics-007-tendermint-client/cached/verify.ak",
  "cardano/onchain/validators/experimental/validator_roster.ak",
  "cardano/onchain/validators/experimental/mint_validator_roster.ak",
  "cardano/onchain/validators/experimental/roster_client.ak",
  "cardano/onchain/validators/experimental/verify_roster_client.ak",
  "cardano/offchain/src/validator-roster.ts",
  "cardano/offchain/scripts/tendermint-cache-fixture.ts",
  "cardano/offchain/scripts/benchmark-validator-roster.ts",
  "cardano/offchain/scripts/validator-roster-economics.ts",
  "cardano/offchain/src/scalus-evaluator.ts",
  "cardano/gateway/src/scripts/test/fixtures/tendermint-update-capacity/normalized.json",
];
const sourceHashes: Record<string, string> = {};
for (const path of sourceFiles) {
  sourceHashes[path] = sha(
    await Deno.readFile(new URL("../../../" + path, import.meta.url)),
  );
}
const optimisticFreeRefresh = measurements.filter((m) => m.kind === "hit").map((
  m,
) => ({ id: m.id, ...rosterEconomics(m.savingLovelace, 0) }));
const report = {
  schemaVersion: 1,
  baselineCommit: "22c4c70b",
  compiler: "aiken v1.1.24",
  traceLevel: "silent",
  protocolMajorVersion: CARDANO_PROTOCOL_MAJOR_VERSION,
  blueprintSha256: sha(
    await Deno.readFile(new URL("../../onchain/plutus.json", import.meta.url)),
  ),
  parametersSha256: sha(
    await Deno.readFile(
      new URL("./fixtures/mainnet-protocol-parameters.json", import.meta.url),
    ),
  ),
  feeParameters: {
    minFeeA: parameters.minFeeA,
    minFeeB: parameters.minFeeB,
    priceMem: parameters.priceMem,
    priceStep: parameters.priceStep,
    referenceScriptByteCost: parameters.minFeeRefScriptCostPerByte,
    coinsPerUtxoByte: parameters.coinsPerUtxoByte,
  },
  sourceHashes,
  optimisticFreeRefresh,
  assumptions: {
    hitPercent: 60,
    monthlyUpdates: 6000,
    hurdlePerUpdateLovelace: 284000,
    lockedCapitalIsRecurringFee: false,
    completeFeeIncludesAllStagedUpdateTransactions: true,
    setupFeesAmortizedIntoRecurringSavings: false,
    nativeEmulatorMeasurementsNotPublicChainInclusion: true,
  },
  measurements,
  economics: [
    pair("hit-17", "powers-two-17"),
    pair("hit-28", "powers-three-28"),
    pair("hit-34", "powers-eight-34"),
    pair("hit-17", "general-replace-17"),
  ],
};
if (write) {
  await Deno.writeTextFile(
    new URL("report.json", directory),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify({ economics: report.economics }, null, 2));
