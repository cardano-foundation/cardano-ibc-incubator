import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { benchmarkEvidence } from "./tendermint-cache-report.ts";

Deno.test("compact benchmark evidence retains complete transaction identity and budgets while archiving diagnostics", () => {
  const report = {
    compiler: "pinned compiler",
    parametersSha256: "parameters",
    blueprintSha256: "blueprint",
    directAcceptance: { completeFeeBelow: 3_000_000, headroomPercent: 5 },
    measurements: [{
      id: "populated-eight",
      mode: "powers",
      path: "direct",
      completeFee: 2_500_000,
      updateTransactions: 1,
      transactionId: "transaction-body-hash",
      signedTransactionSha256: "signed-cbor-hash",
      measured: {
        memory: 15_000_000,
        steps: 8_000_000_000,
        signedBytes: 8_000,
        referencedScriptBytes: 40_000,
      },
      directBudget: { fits: true, headroomPercent: 5 },
      signatures: 34,
      signerAvailability: {
        requiredQuorumSignatures: 34,
        selectedIndices: [1, 3],
      },
      historyRecords: 100,
      cacheRecords: 2,
      changedIndices: [0, 6, 12, 18, 24, 30, 36, 42],
      redeemerBudgets: [{ script: "verifier", memory: 10_000_000 }],
      admissionBudget: { fits: true },
    }],
  };
  const { summary, compressed, filename } = benchmarkEvidence(
    report,
    "https://example.com/benchmarks",
  );
  assertEquals(JSON.parse(gunzipSync(compressed).toString()), report);
  assertEquals(summary.parametersSha256, report.parametersSha256);
  assertEquals(summary.blueprintSha256, report.blueprintSha256);
  const row = summary.measurements[0];
  assertEquals(row.completeFee, 2_500_000);
  assertEquals(row.updateTransactions, 1);
  assertEquals(row.path, "direct");
  assertEquals(row.memory, 15_000_000);
  assertEquals(row.steps, 8_000_000_000);
  assertEquals(row.signedBytes, 8_000);
  assertEquals(row.transactionId, "transaction-body-hash");
  assertEquals(row.signedTransactionSha256, "signed-cbor-hash");
  assertEquals(row.changedIndices, report.measurements[0].changedIndices);
  assertEquals(row.requiredSignatures, 34);
  assertEquals(row.directCandidateFitsReserve, true);
  assert(!("redeemerBudgets" in row));
  assert(!("admissionBudget" in row));
  assertEquals(
    summary.diagnostics.url,
    `https://example.com/benchmarks/${filename}`,
  );
  assertEquals(
    summary.diagnostics.sha256,
    createHash("sha256").update(compressed).digest("hex"),
  );
  assertEquals(
    summary.diagnostics.uncompressedSha256,
    createHash("sha256").update(gunzipSync(compressed)).digest("hex"),
  );
});
