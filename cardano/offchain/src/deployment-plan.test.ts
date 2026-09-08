import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import {
  Lucid,
  type LucidEvolution,
  PROTOCOL_PARAMETERS_DEFAULT,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import {
  DEPLOYMENT_PLAN_FIXTURE,
  loadDeploymentPlan,
} from "./deployment-plan.ts";
import {
  buildReferenceValidatorSizeReport,
  createDeployment,
} from "./deployment.ts";
import { RESERVED_DEPLOYMENT_NONCE_COUNT } from "./constants.ts";

const lucidLoader = {
  config: () => ({ network: "Preview" }),
} as unknown as LucidEvolution;
const inputs = { ...DEPLOYMENT_PLAN_FIXTURE, benchmarkVoucherEnabled: false };

Deno.test("production plan is deterministic and partitions every loaded script by publication", async () => {
  const plan = await loadDeploymentPlan(lucidLoader, inputs);
  assertEquals(await loadDeploymentPlan(lucidLoader, inputs), plan);
  assertEquals(
    plan.validators.length,
    plan.referenceValidators.length + plan.inlineValidators.length,
  );
  assertEquals(
    new Set(plan.validators.map(({ title }) => title)).size,
    plan.validators.length,
  );
  assertEquals(
    new Set(plan.referenceValidators.map(({ hash }) => hash)).size,
    plan.referenceValidators.length,
  );
  assert(plan.referenceValidators.includes(plan.hostState));
  assert(plan.referenceValidators.includes(plan.genericModule));
  assert(plan.inlineValidators.includes(plan.hostNft));
  assert(plan.inlineValidators.includes(plan.mockToken));
  assert(
    plan.referenceValidators.every(({ publication }) =>
      publication === "bootstrap" || publication === "runtime"
    ),
  );
  assert(
    plan.inlineValidators.every(({ publication }) => publication === "inline"),
  );
});

Deno.test("the optional benchmark policy is inventoried and pins the registry variant", async () => {
  const production = await loadDeploymentPlan(lucidLoader, inputs);
  const benchmark = await loadDeploymentPlan(lucidLoader, {
    ...inputs,
    benchmarkVoucherEnabled: true,
  });
  assertEquals(production.benchmarkVoucher, null);
  assert(benchmark.benchmarkVoucher);
  assert(benchmark.referenceValidators.includes(benchmark.benchmarkVoucher));
  assertEquals(
    benchmark.referenceValidators.length,
    production.referenceValidators.length + 1,
  );
  assertNotEquals(benchmark.traceRegistry.hash, production.traceRegistry.hash);
  for (
    const validator of production.validators.filter(({ title }) =>
      title !== production.traceRegistry.title
    )
  ) {
    assertEquals(
      benchmark.validators.find(({ title }) => title === validator.title),
      validator,
    );
  }
});

Deno.test("the plan carries nonce changes through the full applied dependency graph", async () => {
  const original = await loadDeploymentPlan(lucidLoader, inputs);
  const hostChanged = await loadDeploymentPlan(lucidLoader, {
    ...inputs,
    hostStateNonce: { ...inputs.hostStateNonce, output_index: 24n },
  });
  for (
    const key of [
      "hostNft",
      "hostState",
      "mintPort",
      "spendClient",
      "spendConnection",
      "spendTransferModule",
      "genericModule",
      "traceRegistry",
      "referenceHolder",
    ] as const
  ) {
    assertNotEquals(hostChanged[key].hash, original[key].hash, key);
  }
  assertEquals(hostChanged.verifyProof, original.verifyProof);
  const transferChanged = await loadDeploymentPlan(lucidLoader, {
    ...inputs,
    transferModuleNonce: { ...inputs.transferModuleNonce, output_index: 24n },
  });
  assertNotEquals(transferChanged.mintVoucher.hash, original.mintVoucher.hash);
  assertNotEquals(
    transferChanged.spendTransferModule.hash,
    original.spendTransferModule.hash,
  );
  assertNotEquals(
    transferChanged.traceRegistry.hash,
    original.traceRegistry.hash,
  );
  assertEquals(transferChanged.hostState, original.hostState);
  const directoryChanged = await loadDeploymentPlan(lucidLoader, {
    ...inputs,
    traceDirectoryNonce: { ...inputs.traceDirectoryNonce, output_index: 24n },
  });
  assertNotEquals(
    directoryChanged.directoryAuthToken,
    original.directoryAuthToken,
  );
  assertNotEquals(directoryChanged.mintVoucher.hash, original.mintVoucher.hash);
  assertNotEquals(
    directoryChanged.traceRegistry.hash,
    original.traceRegistry.hash,
  );
});

Deno.test("every reference in both production deployment modes satisfies the publication guard", async () => {
  for (const benchmarkVoucherEnabled of [false, true]) {
    const plan = await loadDeploymentPlan(lucidLoader, {
      ...inputs,
      benchmarkVoucherEnabled,
    });
    const report = buildReferenceValidatorSizeReport(
      plan.referenceValidators.map(({ script }) => script),
      16_384,
    );
    const oversized = report.filter(({ oversized }) => oversized).map((
      entry,
    ) => ({ title: plan.referenceValidators[entry.index].title, ...entry }));
    assertEquals(
      oversized,
      [],
      `benchmarkVoucherEnabled=${benchmarkVoucherEnabled}`,
    );
  }
});

for (const splitRequired of [false, true]) {
  Deno.test(`deployment preflight aborts before submitting ${splitRequired ? "nonce split" : "recovery registration"}`, async () => {
    // Public BIP-39 test vector. This wallet exists only in the Emulator.
    const seed = "abandon ".repeat(11) + "about";
    const address = walletFromSeed(seed, { network: "Custom" }).address;
    const funding = splitRequired
      ? [2_000_000_000n]
      : Array(RESERVED_DEPLOYMENT_NONCE_COUNT + 16).fill(20_000_000n);
    const emulator = new Emulator(
      funding.map((lovelace) => ({
        seedPhrase: seed,
        privateKey: "",
        address,
        assets: { lovelace },
      })),
      {
        ...PROTOCOL_PARAMETERS_DEFAULT,
        maxTxSize: 5_000,
      },
    );
    const lucid = await Lucid(emulator, "Custom");
    lucid.selectWallet.fromSeed(seed);
    let submissions = 0;
    emulator.submitTx = () => {
      submissions++;
      return Promise.reject(new Error("Preflight must stop before submission"));
    };
    await assertRejects(
      () => createDeployment(lucid),
      Error,
      "complete deployment validator preflight",
    );
    assertEquals(submissions, 0);
  });
}
