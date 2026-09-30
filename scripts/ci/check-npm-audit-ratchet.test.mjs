import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-npm-audit-ratchet.mjs', import.meta.url));
const cleanReport = { auditReportVersion: 2, vulnerabilities: {} };
const auditError = {
  error: { code: 'ECONNREFUSED', summary: 'registry unavailable', detail: 'audit request failed' },
};

function reportWithAdvisory(severity) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      example: {
        severity,
        via: [{
          source: 777000,
          title: 'Example advisory',
          severity,
          url: 'https://example.com/advisories/777000',
        }],
      },
      dependent: { severity, via: ['example'] },
    },
  };
}

function runRatchet(t, response, { scopeResponses = {}, missingNpm = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'npm-audit-ratchet-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = join(directory, 'responses.json');
  const calls = join(directory, 'calls.jsonl');
  writeFileSync(fixture, JSON.stringify({ response, scopeResponses }));

  if (!missingNpm) {
    writeFileSync(join(directory, 'npm'), `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const fixture = JSON.parse(readFileSync(process.env.AUDIT_TEST_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
appendFileSync(process.env.AUDIT_TEST_CALLS, JSON.stringify(args) + '\\n');
const scope = args[args.indexOf('--prefix') + 1];
const response = fixture.scopeResponses[scope] ?? fixture.response;
writeFileSync(1, response.stdout ?? JSON.stringify(response.report));
writeFileSync(2, response.stderr ?? '');
if (response.signal) process.kill(process.pid, response.signal);
else process.exit(response.status ?? 0);
`, { mode: 0o755 });
  }

  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: missingNpm ? directory : `${directory}${delimiter}${process.env.PATH}`,
      AUDIT_TEST_FIXTURE: fixture,
      AUDIT_TEST_CALLS: calls,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return {
    ...result,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}

function assertAuditFailed(result, diagnostic, directory = 'cardano/gateway') {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /npm audit ratchet passed/);
  assert.ok(result.stderr.includes(`npm audit failed for ${directory}:`), result.stderr);
  assert.match(result.stderr, diagnostic);
}

test('passes only after auditing all five scopes with valid clean reports', (t) => {
  const result = runRatchet(t, { report: cleanReport });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm audit ratchet passed \(0 high\/critical advisories allowed\)/);
  assert.deepEqual(result.calls, [
    'cardano/gateway',
    'packages/cardano-ibc-planner',
    'packages/cardano-ibc-tx-builder',
    'packages/cardano-ibc-trace-registry',
    'packages/cardano-ibc-tx-builder-runtime',
  ].map((directory) => ['audit', '--prefix', directory, '--omit=dev', '--json']));
});

for (const severity of ['low', 'moderate']) {
  test(`accepts a valid ${severity} advisory report with exit status 1`, (t) => {
    const result = runRatchet(t, { report: reportWithAdvisory(severity), status: 1 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 5);
    assert.match(result.stdout, /npm audit ratchet passed/);
  });
}

for (const severity of ['high', 'critical']) {
  for (const status of [0, 1]) {
    test(`rejects an unexpected ${severity} advisory with exit status ${status}`, (t) => {
      const result = runRatchet(t, { report: reportWithAdvisory(severity), status });
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout, /npm audit ratchet passed/);
      assert.match(result.stderr, /Unexpected high\/critical npm advisories found/);
      assert.ok(result.stderr.includes(`777000 ${severity} gateway/example: Example advisory`));
      assert.equal(result.calls.length, 5);
    });
  }
}

for (const status of [0, 1]) {
  test(`rejects JSON error responses even with exit status ${status}`, (t) => {
    const result = runRatchet(t, { report: auditError, status, stderr: 'npm error registry unavailable' });
    assertAuditFailed(result, /ECONNREFUSED/);
    assert.match(result.stderr, /npm error registry unavailable/);
  });
}

test('rejects an error even when the JSON also contains a valid report shape', (t) => {
  const result = runRatchet(t, { report: { ...cleanReport, ...auditError }, status: 1 });
  assertAuditFailed(result, /ECONNREFUSED/);
});

test('fails if a later scope cannot be audited', (t) => {
  const result = runRatchet(t, { report: cleanReport }, {
    scopeResponses: { 'packages/cardano-ibc-tx-builder': { report: auditError, status: 1 } },
  });
  assertAuditFailed(result, /ECONNREFUSED/, 'packages/cardano-ibc-tx-builder');
  assert.equal(result.calls.length, 3);
});

for (const [name, report] of [
  ['null', null],
  ['array', []],
  ['primitive', 'not an audit report'],
  ['missing report version', { vulnerabilities: {} }],
  ['unsupported report version', { auditReportVersion: 1, vulnerabilities: {} }],
  ['missing vulnerabilities', { auditReportVersion: 2 }],
  ['null vulnerabilities', { ...cleanReport, vulnerabilities: null }],
  ['array vulnerabilities', { ...cleanReport, vulnerabilities: [] }],
  ['missing advisory list', { ...cleanReport, vulnerabilities: { example: {} } }],
  ['invalid advisory list', { ...cleanReport, vulnerabilities: { example: { via: {} } } }],
  ['invalid advisory', { ...cleanReport, vulnerabilities: { example: { via: [null] } } }],
  ['missing advisory severity', { ...cleanReport, vulnerabilities: { example: { via: [{ source: 777000 }] } } }],
  ['missing advisory ID', { ...cleanReport, vulnerabilities: { example: { via: [{ severity: 'high' }] } } }],
]) {
  test(`rejects malformed reports: ${name}`, (t) => {
    assertAuditFailed(runRatchet(t, { report }), /invalid.*report/i);
  });
}

test('rejects an empty response and preserves npm stderr', (t) => {
  const result = runRatchet(t, { stdout: '', stderr: 'npm error no report', status: 1 });
  assertAuditFailed(result, /no JSON report/);
  assert.match(result.stderr, /npm error no report/);
});

test('rejects invalid JSON with scope context', (t) => {
  assertAuditFailed(runRatchet(t, { stdout: '{', status: 1 }), /invalid JSON report/);
});

test('rejects unexpected exit statuses even with a valid report', (t) => {
  assertAuditFailed(runRatchet(t, { report: cleanReport, status: 2 }), /unexpected exit status 2/);
});

test('rejects exit status 1 without any reported vulnerabilities', (t) => {
  assertAuditFailed(runRatchet(t, { report: cleanReport, status: 1 }), /exit status 1 without reported vulnerabilities/);
});

test('rejects signal termination even after a valid JSON report', (t) => {
  assertAuditFailed(runRatchet(t, { report: cleanReport, signal: 'SIGTERM' }), /SIGTERM/);
});

test('reports spawn failures with scope context', (t) => {
  assertAuditFailed(runRatchet(t, { report: cleanReport }, { missingNpm: true }), /ENOENT/);
});
