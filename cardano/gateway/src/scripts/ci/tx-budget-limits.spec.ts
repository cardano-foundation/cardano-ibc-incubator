import { type BudgetLimits, type BudgetScenario, checkTransactionBudgets } from './tx-budget-limits';

const limits: BudgetLimits = {
  maxTxSize: 16_384,
  txHeadroomBytes: 750,
  maxTxExMem: 16_500_000,
  maxTxExSteps: 10_000_000_000,
  exUnitHeadroomBps: 500,
};

function scenario(overrides: Partial<BudgetScenario> = {}): BudgetScenario {
  return {
    id: 'scenario',
    name: 'Scenario',
    unsignedBytes: 1_000,
    signedBytesEstimate: 1_260,
    exUnits: { mem: 1_000_000, steps: 1_000_000_000 },
    ...overrides,
  };
}

describe('transaction budget limits', () => {
  it('accepts an ordinary scenario within the public-network limits', () => {
    expect(checkTransactionBudgets([scenario()], limits, {})).toEqual({
      failures: [],
      knownViolations: [],
    });
  });

  it('reports a known violation at its exact regression ceiling', () => {
    const result = checkTransactionBudgets([scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } })], limits, {
      scenario: { mem: 20_000_000 },
    });

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toHaveLength(1);
  });

  it('rejects a one-unit regression above a known ceiling', () => {
    const result = checkTransactionBudgets([scenario({ exUnits: { mem: 20_000_001, steps: 1_000_000_000 } })], limits, {
      scenario: { mem: 20_000_000 },
    });

    expect(result.failures).toEqual([
      'Scenario: memory ex units 20000001 exceed known-overrun ceiling 20000000 (safe budget 15675000)',
    ]);
  });

  it('requires an improved overrun to lower its ceiling immediately', () => {
    const result = checkTransactionBudgets([scenario({ exUnits: { mem: 19_999_999, steps: 1_000_000_000 } })], limits, {
      scenario: { mem: 20_000_000 },
    });

    expect(result.failures).toEqual([
      'Scenario: memory ex units improved from known-overrun ceiling 20000000 to 19999999; lower the ceiling to 19999999',
    ]);
  });

  it('rejects a new over-limit scenario without a ceiling', () => {
    const result = checkTransactionBudgets(
      [scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } })],
      limits,
      {},
    );

    expect(result.failures).toEqual(['Scenario: memory ex units 20000000 exceed safe budget 15675000']);
  });

  it('always rejects a transaction-size overrun', () => {
    const result = checkTransactionBudgets([scenario({ signedBytesEstimate: 16_000 })], limits, {});

    expect(result.failures).toEqual(['Scenario: signed bytes estimate 16000 exceeds safe budget 15634']);
  });

  it('rejects stale and orphaned ceilings', () => {
    const result = checkTransactionBudgets([scenario()], limits, {
      scenario: { mem: 20_000_000 },
      removed_scenario: { steps: 20_000_000_000 },
    });

    expect(result.failures).toEqual([
      'known-overrun ceiling references missing scenario: removed_scenario',
      'Scenario: memory ex units now fit safe budget 15675000; remove stale known-overrun ceiling 20000000',
    ]);
  });
});
