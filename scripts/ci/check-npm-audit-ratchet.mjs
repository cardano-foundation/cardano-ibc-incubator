#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const scopes = [
  { name: 'gateway', directory: 'cardano/gateway' },
  { name: 'planner', directory: 'packages/cardano-ibc-planner' },
  { name: 'tx-builder', directory: 'packages/cardano-ibc-tx-builder' },
  { name: 'trace-registry', directory: 'packages/cardano-ibc-trace-registry' },
  { name: 'tx-builder-runtime', directory: 'packages/cardano-ibc-tx-builder-runtime' },
];

const allowedHighCriticalAdvisories = new Set([]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseAuditReport(directory, result) {
  function fail(message) {
    const stderr = result.stderr?.trim();
    throw new Error(`npm audit failed for ${directory}: ${message}${stderr ? `\n${stderr}` : ''}`);
  }

  if (result.error) {
    fail(result.error.message);
  }
  if (result.signal) {
    fail(`terminated by ${result.signal}`);
  }
  // npm exits with 1 for vulnerability findings as well as operational errors.
  // Accept that status only when stdout contains a valid report with findings.
  if (result.status !== 0 && result.status !== 1) {
    fail(`unexpected exit status ${result.status}`);
  }
  if (!result.stdout?.trim()) {
    fail('no JSON report');
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    fail(`invalid JSON report: ${error.message}`);
  }

  if (isRecord(report) && Object.hasOwn(report, 'error')) {
    fail(`npm returned an error: ${JSON.stringify(report.error)}`);
  }
  if (!isRecord(report) || report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)) {
    fail('invalid audit report: expected auditReportVersion 2 and a vulnerabilities object');
  }
  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!isRecord(vulnerability) || !Array.isArray(vulnerability.via)) {
      fail(`invalid audit report: ${packageName} must have a via array`);
    }
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        continue;
      }
      if (
        !isRecord(via) ||
        !Number.isInteger(via.source) ||
        !['info', 'low', 'moderate', 'high', 'critical'].includes(via.severity)
      ) {
        fail(`invalid audit report: ${packageName} has an invalid advisory`);
      }
    }
  }
  if (result.status === 1 && Object.keys(report.vulnerabilities).length === 0) {
    fail('exit status 1 without reported vulnerabilities');
  }
  return report;
}

function highCriticalAdvisories(auditJson) {
  const advisories = new Map();
  for (const [packageName, vulnerability] of Object.entries(auditJson.vulnerabilities)) {
    for (const via of vulnerability.via) {
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

  const auditJson = parseAuditReport(scope.directory, result);
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
