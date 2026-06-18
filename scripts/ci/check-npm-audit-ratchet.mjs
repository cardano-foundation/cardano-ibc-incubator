#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const scopes = [
  { name: 'gateway', directory: 'cardano/gateway' },
  { name: 'planner', directory: 'packages/cardano-ibc-planner' },
  { name: 'tx-builder', directory: 'packages/cardano-ibc-tx-builder' },
  { name: 'trace-registry', directory: 'packages/cardano-ibc-trace-registry' },
  { name: 'tx-builder-runtime', directory: 'packages/cardano-ibc-tx-builder-runtime' },
];

const allowedHighCriticalAdvisories = new Set([
  '1109842',
  '1112659',
  '1113300',
  '1113375',
  '1113459',
  '1113461',
  '1113465',
  '1113538',
  '1113540',
  '1113544',
  '1113546',
  '1113548',
  '1113552',
  '1114200',
  '1114302',
  '1114680',
  '1115356',
  '1115573',
  '1115806',
  '1117159',
]);

function highCriticalAdvisories(auditJson) {
  const advisories = new Map();
  for (const [packageName, vulnerability] of Object.entries(auditJson.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === 'string' || !['high', 'critical'].includes(via.severity)) {
        continue;
      }

      const id = String(via.source);
      advisories.set(id, {
        id,
        packageName,
        title: via.title,
        severity: via.severity,
        url: via.url,
      });
    }
  }
  return advisories;
}

const seen = new Set();
const unexpected = [];

for (const scope of scopes) {
  const result = spawnSync(
    'npm',
    ['audit', '--prefix', scope.directory, '--omit=dev', '--json'],
    { encoding: 'utf8' },
  );

  if (result.error) {
    throw result.error;
  }
  if (!result.stdout.trim()) {
    console.error(result.stderr);
    throw new Error(`npm audit produced no JSON for ${scope.directory}`);
  }

  const auditJson = JSON.parse(result.stdout);
  for (const advisory of highCriticalAdvisories(auditJson).values()) {
    seen.add(advisory.id);
    if (!allowedHighCriticalAdvisories.has(advisory.id)) {
      unexpected.push({ ...advisory, scope: scope.name });
    }
  }
}

const stale = [...allowedHighCriticalAdvisories].filter((id) => !seen.has(id));

if (unexpected.length > 0 || stale.length > 0) {
  if (unexpected.length > 0) {
    console.error('Unexpected high/critical npm advisories found:');
    for (const advisory of unexpected.sort((a, b) => a.id.localeCompare(b.id))) {
      console.error(
        `- ${advisory.id} ${advisory.severity} ${advisory.scope}/${advisory.packageName}: ${advisory.title} (${advisory.url})`,
      );
    }
  }

  if (stale.length > 0) {
    console.error('Stale npm audit allowlist entries found:');
    for (const id of stale.sort()) {
      console.error(`- ${id}`);
    }
  }

  process.exit(1);
}

console.log(`npm audit ratchet passed (${seen.size} high/critical advisories allowed).`);
