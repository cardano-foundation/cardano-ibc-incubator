import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

interface Measurement {
  id: string;
  mode: string;
  path: string;
  completeFee: number;
  updateTransactions: number;
  transactionId: string;
  signedTransactionSha256: string;
  measured: {
    memory: number;
    steps: number;
    signedBytes: number;
    referencedScriptBytes: number;
  };
  directBudget?: { fits: boolean; headroomPercent: number };
  [detail: string]: unknown;
}

export function benchmarkEvidence<T extends { measurements: Measurement[] }>(
  report: T,
  artifactBaseUrl?: string,
) {
  const detailedJson = JSON.stringify(report, null, 2) + "\n";
  const compressed = gzipSync(detailedJson, { level: 9 });
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  const filename = `tendermint-cache-details-${sha256}.json.gz`;
  const { measurements, ...metadata } = report;
  const summary = {
    schemaVersion: 1,
    ...metadata,
    diagnostics: {
      filename,
      url: artifactBaseUrl
        ? new URL(filename, artifactBaseUrl.replace(/\/?$/, "/")).href
        : undefined,
      sha256,
      uncompressedSha256: createHash("sha256").update(detailedJson).digest(
        "hex",
      ),
    },
    measurements: measurements.map((result) => ({
      id: result.id,
      mode: result.mode,
      path: result.path,
      completeFee: result.completeFee,
      updateTransactions: result.updateTransactions,
      memory: result.measured.memory,
      steps: result.measured.steps,
      signedBytes: result.measured.signedBytes,
      referencedScriptBytes: result.measured.referencedScriptBytes,
      transactionId: result.transactionId,
      signedTransactionSha256: result.signedTransactionSha256,
      signatures: result.signatures,
      requiredSignatures: (result.signerAvailability as {
        requiredQuorumSignatures: number;
      } | undefined)?.requiredQuorumSignatures,
      historyRecords: result.historyRecords,
      cacheRecords: result.cacheRecords,
      changedIndices: result.changedIndices,
      generalChange: result.generalChange,
      oldValidatorCount: result.oldValidatorCount,
      targetValidatorCount: result.targetValidatorCount,
      trustedCacheHit: result.trustedCacheHit,
      directCandidateFitsReserve: result.directBudget?.fits,
    })),
  };
  return { summary, compressed, filename };
}
