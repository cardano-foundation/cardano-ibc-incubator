import {
  addMaxAlternativeExUnits,
  type BudgetLimits,
  type BudgetScenario,
  checkTransactionBudgets,
  subtractBaselineExUnits,
} from './tx-budget-limits';

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
  it('adds independent memory and CPU maxima for alternative profiles instead of summing them', () => {
    expect(
      addMaxAlternativeExUnits({ mem: 100, steps: 1_000 }, [
        [
          { mem: 30, steps: 10 },
          { mem: 20, steps: 40 },
        ],
      ]),
    ).toEqual({ mem: 130, steps: 1_040 });
  });

  it('subtracts paired fixture setup costs from measured execution units', () => {
    expect(
      subtractBaselineExUnits({ mem: 15_069_589, steps: 4_975_552_709 }, { mem: 605_411, steps: 475_552_709 }),
    ).toEqual({ mem: 14_464_178, steps: 4_500_000_000 });
  });

  it('rejects a fixture baseline larger than its paired measurement', () => {
    expect(() => subtractBaselineExUnits({ mem: 10, steps: 20 }, { mem: 11, steps: 20 })).toThrow(
      'execution-unit baseline mem=11 steps=20 exceeds measured mem=10 steps=20',
    );
  });

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

  it('rejects a transaction-size overrun without an exact ceiling', () => {
    const result = checkTransactionBudgets([scenario({ signedBytesEstimate: 16_000 })], limits, {});

    expect(result.failures).toEqual(['Scenario: signed bytes estimate 16000 exceeds safe budget 15634']);
  });

  it('ratchets a known transaction-size headroom violation', () => {
    const result = checkTransactionBudgets([scenario({ signedBytesEstimate: 16_000 })], limits, {
      scenario: { signedBytesEstimate: 16_000 },
    });

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: signed bytes estimate 16000 exceed safe budget 15634 with 750-byte reserve (regression ceiling 16000)',
    ]);
  });

  it('rejects a transaction-size increase above its recorded ceiling', () => {
    const result = checkTransactionBudgets([scenario({ signedBytesEstimate: 16_001 })], limits, {
      scenario: { signedBytesEstimate: 16_000 },
    });

    expect(result.failures).toEqual([
      'Scenario: signed bytes estimate 16001 exceed known-overrun ceiling 16000 (safe budget 15634, ledger maximum 16384)',
    ]);
  });

  it('requires a transaction-size improvement to lower its ceiling', () => {
    const result = checkTransactionBudgets([scenario({ signedBytesEstimate: 15_999 })], limits, {
      scenario: { signedBytesEstimate: 16_000 },
    });

    expect(result.failures).toEqual([
      'Scenario: signed bytes estimate improved from known-overrun ceiling 16000 to 15999; lower the ceiling to 15999',
    ]);
  });

  it('removes a stale size ceiling once the safe budget is met', () => {
    const result = checkTransactionBudgets([scenario({ signedBytesEstimate: 15_634 })], limits, {
      scenario: { signedBytesEstimate: 16_000 },
    });

    expect(result.failures).toEqual([
      'Scenario: signed bytes estimate now fit safe budget 15634; remove stale known-overrun ceiling 16000',
    ]);
  });

  it('identifies a ratcheted transaction that exceeds the ledger maximum', () => {
    const result = checkTransactionBudgets([scenario({ signedBytesEstimate: 16_500 })], limits, {
      scenario: { signedBytesEstimate: 16_500 },
    });

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: signed bytes estimate 16500 exceed ledger maximum 16384 (regression ceiling 16500)',
    ]);
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
