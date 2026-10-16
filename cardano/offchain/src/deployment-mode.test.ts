import { assertEquals, assertRejects } from "@std/assert";
import { CML } from "@lucid-evolution/lucid";
import { deploymentOptionsFromEnvironment } from "./deployment-mode.ts";
Deno.test("deployment mode is explicit and governance omission fails before provider access", async () => {
  const resolve = (vars: Record<string, string>, text = "{}") =>
    deploymentOptionsFromEnvironment(
      (key) => vars[key],
      () => Promise.resolve(text),
    );
  await assertRejects(() => resolve({}), Error, "IBC_DEPLOYMENT_MODE");
  await assertRejects(
    () => resolve({ IBC_DEPLOYMENT_MODE: "upgradable" }),
    Error,
    "IBC_DEPLOYMENT_MODE",
  );
  await assertRejects(
    () => resolve({ IBC_DEPLOYMENT_MODE: "upgradeable" }),
    Error,
    "MIGRATION_GOVERNANCE_FILE",
  );
  await assertRejects(
    () =>
      resolve({
        IBC_DEPLOYMENT_MODE: "upgradeable",
        MIGRATION_GOVERNANCE_FILE: "keys",
      }),
    Error,
    "Invalid MIGRATION_GOVERNANCE_FILE",
  );
  await assertRejects(
    () =>
      resolve({
        IBC_DEPLOYMENT_MODE: "legacy",
        MIGRATION_GOVERNANCE_FILE: "keys",
      }),
    Error,
    "conflicts",
  );
  assertEquals(await resolve({ IBC_DEPLOYMENT_MODE: "legacy" }), {
    deploymentMode: "legacy",
  });
  const valid = {
    emergency: { signers: ["ee".repeat(28)], quorum: "1" },
    signers: ["aa".repeat(28)],
    quorum: "1",
    delay_ms: "86400000",
  };
  const configured = await resolve({
    IBC_DEPLOYMENT_MODE: "upgradeable",
    MIGRATION_GOVERNANCE_FILE: "keys",
  }, JSON.stringify(valid));
  assertEquals(configured.deploymentMode, "upgradeable");
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
          IBC_DEPLOYMENT_MODE: "upgradeable",
          MIGRATION_GOVERNANCE_FILE: "keys",
        }, JSON.stringify(bad)),
      Error,
      "Invalid MIGRATION_GOVERNANCE_FILE",
    );
  }
});

Deno.test("the devnet governance names the local deployer as its only signer", async () => {
  // caribic deploys local bridges with this governance and the default key.
  const defaults = Object.fromEntries(
    (await Deno.readTextFile(new URL("../.env.default", import.meta.url)))
      .split("\n").filter((line) => line.includes("="))
      .map((
        line,
      ) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
  const deployer = CML.PrivateKey.from_bech32(defaults.DEPLOYER_SK).to_public()
    .hash().to_hex();
  const options = await deploymentOptionsFromEnvironment((key) =>
    ({
      IBC_DEPLOYMENT_MODE: "upgradeable",
      MIGRATION_GOVERNANCE_FILE: new URL(
        "../../../chains/cardano/config/credentials/migration-governance.json",
        import.meta.url,
      ).pathname,
    } as Record<string, string>)[key]
  );
  assertEquals(options.migration?.bootstrapSigners, [deployer]);
  assertEquals(options.migration?.governance.quorum, 1n);
});
