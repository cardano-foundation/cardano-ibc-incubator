#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const scanRoots = ['cardano/gateway/src', 'packages'];
const suppressedPatterns = [
  'eslint-disable',
  '@ts-ignore',
  '@ts-expect-error',
  'ts-nocheck',
];

const allowlist = new Set([
  'cardano/gateway/src/query/services/query.service.ts:1:/* eslint-disable @typescript-eslint/no-unused-vars */',
  'cardano/gateway/src/shared/helpers/consensus-state.ts:1:/* eslint-disable @typescript-eslint/no-unused-vars */',
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build') {
      continue;
    }

    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      yield* walk(fullPath);
    } else if (/\.[cm]?[tj]sx?$/.test(entry)) {
      yield fullPath;
    }
  }
}

const failures = [];

for (const root of scanRoots) {
  const fullRoot = join(repoRoot, root);
  for (const filePath of walk(fullRoot)) {
    const relativePath = relative(repoRoot, filePath);
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!suppressedPatterns.some((pattern) => line.includes(pattern))) {
        continue;
      }

      const key = `${relativePath}:${index + 1}:${line.trim()}`;
      if (!allowlist.has(key)) {
        failures.push(key);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Unexpected lint/type-check suppressions found:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('\nEither remove the suppression or add a narrow allowlist entry with a reason in this script.');
  process.exit(1);
}

console.log('Lint/type-check suppression allowlist passed.');
