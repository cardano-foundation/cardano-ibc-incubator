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

// download-artifact can either flatten files or preserve artifact directories.
// Recurse so this script is insensitive to that GitHub Actions layout detail.
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
  // Shards run with independent seeds. The label coverage checker only needs
  // modules/tests/labels, so the aggregate seed is intentionally non-semantic.
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
  // Preserve the Aiken JSON shape closely enough that downstream checks can
  // treat the merged report like one large aiken check invocation.
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
