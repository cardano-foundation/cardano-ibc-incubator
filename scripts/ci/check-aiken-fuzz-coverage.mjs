#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [, , reportPathArg, configPathArg] = process.argv;

if (!reportPathArg) {
  console.error(
    "Usage: node scripts/ci/check-aiken-fuzz-coverage.mjs <aiken-check-json> [config-json]",
  );
  process.exit(2);
}

function findRepoRoot(start) {
  let current = start;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot(process.cwd());
const reportPath = path.resolve(process.cwd(), reportPathArg);
const configPath = path.resolve(
  repoRoot,
  configPathArg ?? "scripts/ci/aiken-fuzz-required-labels.json",
);

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const minCount = Number(process.env.AIKEN_FUZZ_MIN_LABEL_COUNT ?? config.minCount ?? 1);
const minPercentBps = Number(
  process.env.AIKEN_FUZZ_MIN_LABEL_PERCENT_BPS ?? config.minPercentBps ?? 0,
);
const requiredLabels = config.requiredLabels ?? [];
const allowedDepthPrefixes = config.allowedDepthPrefixes ?? ["unit", "contract", "tx", "model"];

// The checker is intentionally configurable from CI env vars so local smoke
// checks can use max-success=1 while CI keeps the production thresholds.
if (!Number.isSafeInteger(minCount) || minCount < 1) {
  throw new Error(`Invalid minCount: ${minCount}`);
}
if (!Number.isSafeInteger(minPercentBps) || minPercentBps < 0 || minPercentBps > 10_000) {
  throw new Error(`Invalid minPercentBps: ${minPercentBps}`);
}
if (
  !Array.isArray(allowedDepthPrefixes) ||
  allowedDepthPrefixes.length === 0 ||
  !allowedDepthPrefixes.every((prefix) => typeof prefix === "string" && prefix.length > 0)
) {
  throw new Error("allowedDepthPrefixes must be a non-empty array of strings.");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const depthPrefixPattern = new RegExp(
  `^(${allowedDepthPrefixes.map(escapeRegExp).join("|")})\\.`,
);

const propertyTests = [];
const labelCounts = new Map();
let totalLabels = 0;

// Aiken only adds `iterations` to property tests. Unit tests may still appear
// in the JSON report, but they are not part of fuzz label coverage.
for (const module of report.modules ?? []) {
  for (const test of module.tests ?? []) {
    if (typeof test.iterations !== "number") {
      continue;
    }

    const testName = `${module.name}.${test.title}`;
    const labels = test.labels ?? {};
    propertyTests.push({ testName, labels });

    for (const [label, count] of Object.entries(labels)) {
      const numericCount = Number(count);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + numericCount);
      totalLabels += numericCount;
    }
  }
}

const failures = [];

if (propertyTests.length === 0) {
  failures.push("No Aiken property tests were found.");
}

for (const label of requiredLabels) {
  if (!depthPrefixPattern.test(label)) {
    failures.push(
      `Required fuzz label '${label}' must start with one of: ${allowedDepthPrefixes.join(", ")}.`,
    );
  }
}

for (const { testName, labels } of propertyTests) {
  // A property test without a label can pass forever while exercising only a
  // boring generator path; treat that as a coverage failure.
  if (Object.keys(labels).length === 0) {
    failures.push(`${testName} is a property test without fuzz labels.`);
  }
}

for (const label of labelCounts.keys()) {
  if (!depthPrefixPattern.test(label)) {
    failures.push(
      `Observed fuzz label '${label}' must start with one of: ${allowedDepthPrefixes.join(", ")}.`,
    );
  }
}

for (const label of requiredLabels) {
  const count = labelCounts.get(label) ?? 0;
  const percentBps = totalLabels === 0 ? 0 : Math.floor((count * 10_000) / totalLabels);

  // Count proves the branch appeared at all; percentage catches labels that are
  // technically present but starved by an imbalanced generator.
  if (count === 0) {
    failures.push(`Required fuzz label '${label}' was not observed.`);
  } else if (count < minCount) {
    failures.push(`Fuzz label '${label}' count ${count} is below minimum ${minCount}.`);
  }

  if (percentBps < minPercentBps) {
    failures.push(
      `Fuzz label '${label}' share ${(percentBps / 100).toFixed(2)}% is below minimum ${(minPercentBps / 100).toFixed(2)}%.`,
    );
  }
}

const rows = [...labelCounts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([label, count]) => {
    const percentBps = totalLabels === 0 ? 0 : Math.floor((count * 10_000) / totalLabels);
    return { label, count, percent: `${(percentBps / 100).toFixed(2)}%` };
  });

console.log("Aiken fuzz label coverage");
console.log(`property tests: ${propertyTests.length}`);
console.log(`total labels: ${totalLabels}`);
console.table(rows);

if (failures.length > 0) {
  console.error("\nAiken fuzz coverage check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Aiken fuzz coverage check passed with minCount=${minCount}, minPercent=${(minPercentBps / 100).toFixed(2)}%.`,
);
