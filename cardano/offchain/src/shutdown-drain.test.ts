import {
  checkShutdownDrain,
  type DrainMode,
} from "./testing/shutdown-drain.ts";
for (const mode of ["timeout", "error-ack", "return"] as DrainMode[]) {
  Deno.test(`shutdown drains funded escrow through ${mode} before full reclamation`, async () => {
    await checkShutdownDrain({
      mode,
      amount: 7_000_000n,
      graceDays: 1,
      settleNearDeadline: mode === "return",
    });
  });
}

Deno.test("funded shutdown rejects dependency cleanup after grace until settlement", async () => {
  await checkShutdownDrain({
    mode: "error-ack",
    amount: 7_000_000n,
    graceDays: 1,
    settleAfterGrace: true,
  });
});

Deno.test("shutdown keeps voucher returns and refunds available until complete reclamation", async () => {
  await checkShutdownDrain({
    mode: "voucher",
    amount: 7_000_000n,
    graceDays: 1,
  });
});
