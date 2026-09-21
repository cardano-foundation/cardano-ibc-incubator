import fc from "fast-check";
import {
  runTransactionCase,
  transactionFuzzParameters,
} from "./testing/transaction-fuzz.ts";
import type { DrainMode } from "./testing/shutdown-drain.ts";

const action = (...kinds: string[]) =>
  fc.record({
    kind: fc.constantFrom(...kinds),
    value: fc.integer({ min: 1, max: 40 }),
    ordered: fc.boolean(),
  });
// Generate each phase explicitly: arbitrary invalid command sequences mostly
// skip their preconditions and provide very little cleanup-order coverage.
const commands = fc.tuple(
  fc.array(action("client", "connection", "channel", "top-up", "observe"), {
    maxLength: 8,
  }),
  action("enter"),
  fc.array(action("observe", "reject-early"), { maxLength: 2 }),
  action("wait"),
  fc.array(action("cleanup", "observe"), { maxLength: 8 }),
).map((
  [active, enter, grace, wait, cleanup],
) => [...active, enter, ...grace, wait, ...cleanup]);

Deno.test("stateful main lifecycle returns all deployment ADA after shutdown", async () => {
  await fc.assert(
    fc.asyncProperty(commands, async (commands) => {
      await runTransactionCase(
        new URL("./testing/shutdown-case.worker.ts", import.meta.url),
        commands,
      );
    }),
    transactionFuzzParameters(),
  );
});

Deno.test("snapshot cleanup conserves seeded token quantities", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        history: fc.integer({ min: 1, max: 20 }),
        settledPackets: fc.integer({ min: 0, max: 16 }),
        extraLovelace: fc.bigInt({ min: 0n, max: 100_000_000n }),
        vouchers: fc.bigInt({ min: 0n, max: 1_000_000n }),
        order: fc.array(fc.nat(100), { minLength: 1, maxLength: 12 }),
        legacy: fc.boolean(),
        mutation: fc.constantFrom(
          "active",
          "grace-period",
          "missing-authority",
          "missing-burn",
          "wrong-refund",
        ),
      }),
      async (sample) => {
        await runTransactionCase(
          new URL("./testing/shutdown-state-case.worker.ts", import.meta.url),
          sample,
        );
      },
    ),
    transactionFuzzParameters(),
  );
});

Deno.test("shutdown drains funded escrow before returning all deployment ADA", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        mode: fc.constantFrom<DrainMode>("timeout", "error-ack", "return"),
        amount: fc.bigInt({ min: 2_000_000n, max: 100_000_000n }),
        graceDays: fc.integer({ min: 1, max: 3 }),
        settleNearDeadline: fc.boolean(),
      }),
      async (sample) => {
        await runTransactionCase(
          new URL("./testing/shutdown-drain.worker.ts", import.meta.url),
          sample,
        );
      },
    ),
    transactionFuzzParameters(),
  );
});
