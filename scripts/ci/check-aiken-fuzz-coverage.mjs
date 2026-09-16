#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const identity = (module, test) => `${module.name}.${test.title}`;
export function checkCoverage(report, smoke, config) {
  const failures = [];
  const rows = [];
  const tests = new Map();
  const minIterations = config.minIterations;
  const minCount = config.minCount;
  for (const [name, value] of Object.entries({ minIterations, minCount })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  }
  const prefix = /^(fuzz|regression)\.(unit|contract|model)\./;
  for (const module of report.modules ?? []) {
    for (const test of module.tests ?? []) {
      if (test.iterations === undefined) continue;
      const name = identity(module, test);
      if (tests.has(name)) failures.push(`Duplicate deep property: ${name}`);
      tests.set(name, test);
      if (test.status !== 'pass') failures.push(`Failed property: ${name}`);
      if (!Number.isSafeInteger(test.iterations) || test.iterations < minIterations) {
        failures.push(`${name}: needs at least ${minIterations} iterations`);
      }
      if (!Object.keys(test.labels ?? {}).length) failures.push(`${name}: missing labels`);
      for (const [label, count] of Object.entries(test.labels ?? {})) {
        if (!prefix.test(label)) failures.push(`${name}: invalid label ${label}`);
        if (!Number.isSafeInteger(count) || count < 0 || count > test.iterations) {
          failures.push(`${name}: invalid count for ${label}`);
        }
        rows.push({ property: name, label, count, iterations: test.iterations });
      }
    }
  }
  if (!tests.size) failures.push('No deep properties found');
  const expected = new Set();
  for (const module of smoke.modules ?? []) {
    for (const test of module.tests ?? []) {
      if (test.status !== 'pass') failures.push(`Failed smoke test: ${identity(module, test)}`);
      if (test.iterations === undefined) continue;
      const name = identity(module, test);
      expected.add(name);
      if (!tests.has(name)) failures.push(`Property missing from deep reports: ${name}`);
    }
  }
  if (!expected.size) failures.push('Smoke report contains no properties');
  for (const name of tests.keys()) {
    if (!expected.has(name)) failures.push(`Deep property absent from smoke report: ${name}`);
  }
  // Required labels attest that named scenarios ran, not semantic diversity.
  for (const label of config.requiredLabels ?? []) {
    const producers = rows.filter((row) => row.label === label);
    if (!producers.length) failures.push(`Required label not observed: ${label}`);
    for (const row of producers) {
      if (row.count < minCount) failures.push(`${row.property}: ${label} below ${minCount}`);
    }
  }
  // Distribution rules are local to one generator/property. Unrelated tests
  // cannot dilute a bucket, and multiple producers cannot mask starvation.
  for (const [title, buckets] of Object.entries(config.distributions ?? {})) {
    const producers = [...tests].filter(([, test]) => test.title === title);
    if (producers.length !== 1) {
      failures.push(`Distribution requires exactly one property: ${title}`);
      continue;
    }
    const [name, test] = producers[0];
    for (const [label, minPercentBps] of Object.entries(buckets)) {
      if (!Number.isSafeInteger(minPercentBps) || minPercentBps < 1 || minPercentBps > 10000) {
        throw new Error(`Invalid distribution threshold: ${title}/${label}`);
      }
      const count = test.labels?.[label] ?? 0;
      if (count < minCount || count * 10000 < minPercentBps * test.iterations) {
        failures.push(`${name}: generator bucket ${label} is underrepresented`);
      }
    }
  }
  return { failures, rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , reportPath, smokePath, configPath = 'scripts/ci/aiken-fuzz-required-labels.json'] = process.argv;
  if (!reportPath || !smokePath) throw new Error('Usage: check-aiken-fuzz-coverage.mjs <deep.json> <smoke.json> [config.json]');
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const { failures, rows } = checkCoverage(read(reportPath), read(smokePath), read(configPath));
  console.table(rows);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('All properties received deep execution; local label requirements passed.');
  }
}
