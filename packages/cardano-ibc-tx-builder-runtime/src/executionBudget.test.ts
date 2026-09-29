import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CML } from '@lucid-evolution/lucid';
import { assertExecutionBudget } from './executionBudget';

for (const encoding of ['map', 'legacy']) {
  const fixture = (memory: number, steps: number) => CML.Redeemers.from_cbor_hex(
    // Two distinct spend redeemers with integer datum zero and equal budgets.
    // CBOR is independent of the traversal/accumulation being tested.
    encoding === 'map'
      ? `a2820000820082${memory.toString(16).padStart(2, '0')}${steps.toString(16).padStart(2, '0')}820001820082${memory.toString(16).padStart(2, '0')}${steps.toString(16).padStart(2, '0')}`
      : `828400000082${memory.toString(16).padStart(2, '0')}${steps.toString(16).padStart(2, '0')}8400010082${memory.toString(16).padStart(2, '0')}${steps.toString(16).padStart(2, '0')}`,
  );
  test(`${encoding}: individual scripts fit, aggregate memory and CPU must also fit`, () => {
    const limits = { maxTxExMem: 10n, maxTxExSteps: 20n };
    assert.deepEqual(assertExecutionBudget(fixture(5, 10), limits), { memory: 10n, steps: 20n });
    assert.throws(() => assertExecutionBudget(fixture(6, 10), limits), /memory 12\/10, steps 20\/20/);
    assert.throws(() => assertExecutionBudget(fixture(5, 11), limits), /memory 10\/10, steps 22\/20/);
  });
}

test('missing, zero, negative, unsafe or differently typed limits fail closed', () => {
  for (const invalid of [undefined, null, 0n, -1n, 10, '10', Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertExecutionBudget(undefined, { maxTxExMem: invalid, maxTxExSteps: 20n }), /invalid ledger/);
    assert.throws(() => assertExecutionBudget(undefined, { maxTxExMem: 10n, maxTxExSteps: invalid }), /invalid ledger/);
  }
  assert.deepEqual(assertExecutionBudget(undefined, { maxTxExMem: 10n, maxTxExSteps: 20n }), { memory: 0n, steps: 0n });
});
