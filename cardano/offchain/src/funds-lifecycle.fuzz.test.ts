import fc from "fast-check";
import {
  runTransactionCase,
  transactionFuzzParameters,
} from "./testing/transaction-fuzz.ts";

const profile = Deno.env.get("FUNDS_FUZZ_PROFILE") ?? "pr";
if (profile !== "pr" && profile !== "deep") {
  throw new Error("FUNDS_FUZZ_PROFILE must be pr or deep");
}
const commands = profile === "deep"
  ? { minLength: 12, maxLength: 24 }
  : { minLength: 1, maxLength: 6 };
const voucherPackets = profile === "deep"
  ? { minLength: 12, maxLength: 24 }
  : { minLength: 3, maxLength: 5 };

function fundsFuzzParameters() {
  const parameters = transactionFuzzParameters();
  const seed = parameters.seed ?? crypto.getRandomValues(new Int32Array(1))[0];
  console.log("Funds fuzz replay:", {
    seed,
    profile,
    path: parameters.path,
    runs: parameters.numRuns,
  });
  return { ...parameters, seed };
}

async function checkHistory(sample: unknown) {
  // Emit the original case before evaluation, so even an interrupted shrink or
  // CI timeout leaves a reproducible input in the uploaded log.
  console.log("Funds history:", fc.stringify(sample));
  try {
    await runTransactionCase(
      new URL("./testing/funds-case.worker.ts", import.meta.url),
      sample,
    );
  } catch (error) {
    // Shrinking long histories can take hours. Preserve the original failure
    // immediately, even when the campaign is interrupted before it finishes.
    console.error("Funds history failed:", error);
    throw error;
  }
}

const amount = fc.oneof(
  fc.bigInt({ min: 2n, max: 100n }),
  fc.bigInt({ min: 1_000_000n, max: 10_000_000n }),
);
const text = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
  { minLength: 1, maxLength: 16 },
);
const nativeAsset = fc.tuple(
  fc.hexaString({ minLength: 56, maxLength: 56 }),
  fc.uint8Array({ minLength: 0, maxLength: 16 }),
).map(([policy, name]) =>
  policy + [...name].map((byte) => byte.toString(16).padStart(2, "0")).join("")
);
for (const native of [false, true]) {
  Deno.test(`compiled ${native ? "native token" : "ADA"} funds histories preserve accounting and reject mutations`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          parameters: fc.record({
            amount,
            reserve: fc.bigInt({ min: 3_000_000n, max: 8_000_000n }),
            sequence: fc.constant(1n),
            unrelated: fc.bigInt({ min: 1n, max: 1_000_000n }),
            sender: fc.hexaString({ minLength: 56, maxLength: 56 }),
            receiver: text,
            memo: text,
            asset: native ? nativeAsset : fc.constant(""),
          }),
          amounts: fc.array(amount, { minLength: 2, maxLength: 5 }),
          commands: fc.array(
            fc.record({
              send: fc.boolean(),
              index: fc.nat(100),
              settlement: fc.constantFrom("ack", "error", "timeout"),
            }),
            commands,
          ),
        }),
        checkHistory,
      ),
      fundsFuzzParameters(),
    );
  });
}

Deno.test("compiled voucher histories preserve supply through mint, burn and refunds", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        voucherBase: text,
        destinations: fc.tuple(
          fc.record({
            hash: fc.hexaString({ minLength: 56, maxLength: 56 }),
            script: fc.constant(false),
          }),
          fc.record({
            hash: fc.hexaString({ minLength: 56, maxLength: 56 }),
            script: fc.constant(true),
          }),
        ),
        parameters: fc.record({
          amount: fc.constant(2_000_000n),
          reserve: fc.bigInt({ min: 3_000_000n, max: 8_000_000n }),
          sequence: fc.constant(1n),
          unrelated: fc.bigInt({ min: 1n, max: 1_000_000n }),
          sender: fc.hexaString({ minLength: 56, maxLength: 56 }),
          receiver: text,
          memo: text,
          asset: fc.constant(""),
        }),
        amounts: fc.array(amount, voucherPackets),
        commands: fc.array(
          fc.record({
            send: fc.boolean(),
            index: fc.nat(100),
            settlement: fc.constantFrom("ack", "error", "timeout"),
          }),
          commands,
        ),
      }),
      checkHistory,
    ),
    fundsFuzzParameters(),
  );
});
