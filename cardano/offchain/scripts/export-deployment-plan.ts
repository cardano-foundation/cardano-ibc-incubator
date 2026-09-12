import { type LucidEvolution, toHex } from "@lucid-evolution/lucid";
import {
  DEPLOYMENT_PLAN_FIXTURE,
  loadDeploymentPlan,
  type PlannedValidator,
} from "../src/deployment-plan.ts";
import { buildReferenceValidatorSizeReport } from "../src/deployment.ts";

const outputIndex = Deno.args.indexOf("--output");
if (outputIndex < 0 || !Deno.args[outputIndex + 1]) {
  throw new Error("Usage: export-deployment-plan.ts --output <path>");
}
const blueprint = await Deno.readFile(
  new URL("../../onchain/plutus.json", import.meta.url),
);
const blueprintSha256 = toHex(
  new Uint8Array(await crypto.subtle.digest("SHA-256", blueprint)),
);
const lucid = {
  config: () => ({ network: "Preview" }),
} as unknown as LucidEvolution;
const entry = ({ title, publication, hash, script }: PlannedValidator) => ({
  title,
  publication,
  scriptHash: hash,
  appliedScriptBytes: script.script.length / 2,
  estimatedReferenceOutputBytes:
    buildReferenceValidatorSizeReport([script], 16_384)[0]
      .estimatedReferenceOutputBytes,
  script,
});
const modes = [];
const failures: string[] = [];
for (const benchmarkVoucherEnabled of [false, true]) {
  const name = benchmarkVoucherEnabled ? "local-benchmark" : "production";
  const plan = await loadDeploymentPlan(lucid, {
    ...DEPLOYMENT_PLAN_FIXTURE,
    benchmarkVoucherEnabled,
  });
  modes.push({
    name,
    inputs: plan.inputs,
    referenceValidators: plan.referenceValidators.map(entry),
    inlineValidators: plan.inlineValidators.map(entry),
  });
  const report = buildReferenceValidatorSizeReport(
    plan.referenceValidators.map(({ script }) => script),
    16_384,
  );
  for (const item of report.filter(({ oversized }) => oversized)) {
    failures.push(
      `${name}: ${
        plan.referenceValidators[item.index].title
      } applied=${item.scriptBytes}, referenceOutput=${item.estimatedReferenceOutputBytes}, safeLimit=15634`,
    );
  }
}
await Deno.writeTextFile(
  Deno.args[outputIndex + 1],
  JSON.stringify(
    { schemaVersion: 1, blueprintSha256, network: "Preview", modes },
    (_key, value) => typeof value === "bigint" ? value.toString() : value,
    2,
  ) + "\n",
);
if (failures.length) {
  throw new Error(
    `Deployment reference preflight failed:\n${failures.join("\n")}`,
  );
}
console.log(
  `Exported production and local-benchmark deployment plans to ${
    Deno.args[outputIndex + 1]
  }`,
);
