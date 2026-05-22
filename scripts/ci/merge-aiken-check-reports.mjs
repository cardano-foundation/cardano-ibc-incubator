#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [, , inputDirArg, outputPathArg] = process.argv;

if (!inputDirArg || !outputPathArg) {
  console.error(
    "Usage: node scripts/ci/merge-aiken-check-reports.mjs <input-dir> <output-json>",
  );
  process.exit(2);
}

const inputDir = path.resolve(process.cwd(), inputDirArg);
const outputPath = path.resolve(process.cwd(), outputPathArg);

function findJsonFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findJsonFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
  });
}

const files = findJsonFiles(inputDir).sort();

if (files.length === 0) {
  throw new Error(`No Aiken check JSON reports found in ${inputDir}`);
}

const merged = {
  seed: null,
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    kind: { unit: 0, property: 0 },
  },
  modules: [],
};

for (const file of files) {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  merged.summary.total += report.summary?.total ?? 0;
  merged.summary.passed += report.summary?.passed ?? 0;
  merged.summary.failed += report.summary?.failed ?? 0;
  merged.summary.kind.unit += report.summary?.kind?.unit ?? 0;
  merged.summary.kind.property += report.summary?.kind?.property ?? 0;
  merged.modules.push(...(report.modules ?? []));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`);

console.log(`Merged ${files.length} Aiken check report(s) into ${outputPath}`);
