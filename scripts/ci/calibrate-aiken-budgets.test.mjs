import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareFixture, executionUnits, extractFixtures, fixtures, productionValidator } from './calibrate-aiken-budgets.mjs';

function exportReport() {
  return {
    modules: [
      { name: 'host_state_stt.test', tests: [{
        title: 'export_capacity_calibration_fixture', status: 'pass',
        traces: ["budget-calibration:host_state: h'80'"],
      }] },
      { name: 'spending_client_capacity.test', tests: [{
        title: 'export_capacity_calibration_fixtures', status: 'pass',
        traces: fixtures.slice(1).map(([name]) => `budget-calibration:${name}: h'9F00FF'`),
      }] },
    ],
  };
}

test('extracts every fixture from the passing export tests without using their costs', () => {
  assert.deepEqual([...extractFixtures(exportReport())], fixtures.map(([name]) => [name, name === 'host_state' ? '80' : '9f00ff']));
});

test('rejects missing, duplicated and failed fixture exports', () => {
  const missing = exportReport();
  missing.modules[0].tests[0].traces = [];
  assert.throws(() => extractFixtures(missing), /Missing exported fixture/);
  const duplicate = exportReport();
  duplicate.modules[0].tests[0].traces.push(duplicate.modules[0].tests[0].traces[0]);
  assert.throws(() => extractFixtures(duplicate), /Duplicate exported fixture/);
  const failed = exportReport();
  failed.modules[0].tests[0].status = 'fail';
  assert.throws(() => extractFixtures(failed), /Expected one passing test/);
});

test('reports both costs and their difference without assuming the helper is an upper bound', () => {
  assert.deepEqual(compareFixture('example', { mem: 100, cpu: 500 }, { mem: 130, cpu: 450 }), {
    fixture: 'example', helper: { mem: 100, cpu: 500 }, compiled: { mem: 130, cpu: 450 },
    difference: { mem: 30, cpu: -50 },
  });
  for (const invalid of [undefined, { mem: -1, cpu: 1 }, { mem: 1, cpu: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => executionUnits(invalid), /Invalid execution units/);
  }
});

test('requires the matching compiler and exactly one production validator', () => {
  const blueprint = {
    preamble: { compiler: { name: 'Aiken', version: 'v1.1.21+42babe5' }, plutusVersion: 'v3' },
    validators: [{ title: 'example.spend', compiledCode: '00' }],
  };
  assert.equal(productionValidator(blueprint, 'example.spend'), blueprint.validators[0]);
  assert.throws(() => productionValidator(blueprint, 'missing'), /Expected one production validator/);
  blueprint.validators.push(blueprint.validators[0]);
  assert.throws(() => productionValidator(blueprint, 'example.spend'), /Expected one production validator/);
  blueprint.validators.pop();
  blueprint.preamble.compiler.version = 'v1.1.23';
  assert.throws(() => productionValidator(blueprint, 'example.spend'), /Aiken v1.1.21/);
});

test('transaction-budget build and measured tests explicitly disable traces', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  tx-budgets:')[1]?.split('\n  generated-artifacts:')[0];
  assert.ok(job, 'Missing transaction-budget job');
  assert.match(job, /run: aiken build --deny --trace-level silent/);
  assert.match(job, /aiken check \\\s+--deny \\\s+--trace-level silent/);
});
