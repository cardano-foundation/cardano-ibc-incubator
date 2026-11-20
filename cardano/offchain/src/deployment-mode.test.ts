import { assertEquals, assertRejects } from "@std/assert";
import { deploymentOptionsFromEnvironment } from "./deployment-mode.ts";
Deno.test("governance is required and removed deployment mode switches are rejected", async () => {
  const resolve = (vars: Record<string, string>, text = "{}") =>
    deploymentOptionsFromEnvironment(
      (key) => vars[key],
      () => Promise.resolve(text),
    );
  await assertRejects(() => resolve({}), Error, "MIGRATION_GOVERNANCE_FILE");
  for (const mode of ["legacy", "upgradeable", "upgradable"]) {
    await assertRejects(
      () =>
        resolve({
          IBC_DEPLOYMENT_MODE: mode,
          MIGRATION_GOVERNANCE_FILE: "keys",
        }),
      Error,
      "IBC_DEPLOYMENT_MODE was removed",
    );
  }
  await assertRejects(
    () => resolve({ MIGRATION_GOVERNANCE_FILE: "keys" }),
    Error,
    "Invalid MIGRATION_GOVERNANCE_FILE",
  );
  const valid = {
    emergency: { signers: ["ee".repeat(28)], quorum: "1" },
    signers: ["aa".repeat(28)],
    quorum: "1",
    delay_ms: "86400000",
  };
  const configured = await resolve({
    MIGRATION_GOVERNANCE_FILE: "keys",
  }, JSON.stringify(valid));
  assertEquals(configured.migration!.governance.delay_ms, 86400000n);
  for (
    const bad of [
      { ...valid, emergency: undefined },
      { ...valid, emergency: { signers: valid.signers, quorum: "1" } },
      { ...valid, emergency: { signers: [], quorum: "1" } },
      { ...valid, delay_ms: "0" },
      { ...valid, signers: [] },
      {
        ...valid,
        quorum: "0",
      },
    ]
  ) {
    await assertRejects(
      () =>
        resolve({
          MIGRATION_GOVERNANCE_FILE: "keys",
        }, JSON.stringify(bad)),
      Error,
      "Invalid MIGRATION_GOVERNANCE_FILE",
    );
  }
});
