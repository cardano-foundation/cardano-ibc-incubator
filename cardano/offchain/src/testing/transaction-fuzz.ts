import { assert, assertRejects } from "@std/assert";
import type { TxBuilder } from "@lucid-evolution/lucid";
import type { Emulator } from "@lucid-evolution/provider";

export interface TransactionFixture {
  tx: TxBuilder;
  emulator: Emulator;
}

export async function runTransactionCase(
  workerUrl: URL,
  sample: unknown,
): Promise<void> {
  // A fresh worker keeps evaluator state and allocations from accumulating
  // across cases, so shrinking and replay use the same starting conditions.
  const worker = new Worker(workerUrl.href, { type: "module" });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ error?: string }>) => {
        if (data.error !== undefined) reject(new Error(data.error));
        else resolve();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error(event.message));
      };
      worker.onmessageerror = () =>
        reject(new Error("Invalid transaction case result"));
      worker.postMessage(sample);
    });
  } finally {
    worker.terminate();
  }
}

export async function assertTransactionAccepted(
  { tx, emulator }: TransactionFixture,
): Promise<string> {
  // Emulator.evaluateTx only echoes budgets. This must evaluate the compiled
  // scripts locally before the emulator can accept the transaction.
  const completed = await tx.complete({ localUPLCEval: true });
  assert(completed.toTransaction().witness_set().redeemers());
  const signed = await completed.sign.withWallet().complete();
  const txHash = await signed.submit();
  emulator.awaitBlock();
  return txHash;
}

export async function assertTransactionRejected(
  { tx }: TransactionFixture,
): Promise<void> {
  // A builder or fixture error must fail the property. Only rejection by an
  // executed script demonstrates that a protocol mutation was caught.
  await assertRejects(
    () => tx.complete({ localUPLCEval: true }),
    Error,
    "failed script execution",
  );
}

export function transactionFuzzParameters() {
  const runs = Deno.env.get("TX_FUZZ_RUNS");
  const seed = Deno.env.get("TX_FUZZ_SEED");
  const numRuns = runs === undefined ? 20 : Number(runs);
  if (!Number.isSafeInteger(numRuns) || numRuns < 1) {
    throw new Error("TX_FUZZ_RUNS must be a positive integer");
  }
  if (seed !== undefined && !Number.isSafeInteger(Number(seed))) {
    throw new Error("TX_FUZZ_SEED must be an integer");
  }
  // fast-check prints the seed, shrink path and smallest failing case. Pass
  // them back with TX_FUZZ_SEED and TX_FUZZ_PATH and filter to the failed test.
  return {
    numRuns,
    ...(seed === undefined ? {} : { seed: Number(seed) }),
    path: Deno.env.get("TX_FUZZ_PATH") ?? "",
    verbose: true,
  };
}
