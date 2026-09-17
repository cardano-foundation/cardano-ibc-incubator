import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCoverage } from './check-aiken-fuzz-coverage.mjs';

const a = 'fuzz.unit.amount.small', b = 'fuzz.unit.amount.large';
const config = { minCount: 25, minIterations: 100, requiredLabels: [a, b], distributions: { amounts: { [a]: 2000, [b]: 2000 } } };
const property = (title = 'amounts', labels = { [a]: 250, [b]: 250 }) => ({ title, status: 'pass', iterations: 500, labels });
const report = (...tests) => ({ modules: [{ name: 'test', tests }] });
const check = (deep, smoke = deep) => checkCoverage(deep, smoke, config).failures;

test('accepts represented buckets', () => assert.deepEqual(check(report(property())), []));
test('unrelated properties cannot dilute existing coverage', () => {
  const extra = Array.from({ length: 100 }, (_, i) => property(`extra${i}`, { 'fuzz.unit.unrelated': 500 }));
  assert.deepEqual(check(report(property(), ...extra)), []);
});
test('detects missing deep properties even when all required labels pass', () => {
  assert(check(report(property()), report(property(), property('forgotten'))).some(x => x.includes('missing from deep')));
});
test('detects smoke-only iteration counts', () => {
  assert(check(report({ ...property(), iterations: 1, labels: { [a]: 1 } })).some(x => x.includes('at least 100')));
});
test('rejects duplicate property records instead of summing repetitions', () => {
  assert(check(report(property(), property())).some(x => x.includes('Duplicate')));
});
test('rejects starved local buckets', () => {
  assert(check(report(property('amounts', { [a]: 499, [b]: 1 }))).some(x => x.includes('underrepresented')));
});
test('rejects failed results and malformed label counts', () => {
  assert(check(report({ ...property(), status: 'fail' })).some(x => x.includes('Failed')));
  for (const count of [-1, 501, NaN, '500']) {
    assert(check(report(property('amounts', { [a]: count, [b]: 250 }))).some(x => x.includes('invalid count')));
  }
});
test('requires labels and a nonempty smoke inventory', () => {
  assert(check(report(property('amounts', {}))).some(x => x.includes('missing labels')));
  assert(check(report(property()), report()).some(x => x.includes('no properties')));
});
