import {
  addMaxAlternativeExUnits,
  type BudgetLimits,
  type BudgetScenario,
  checkTransactionBudgets,
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

  it('accepts an ordinary scenario within the public-network limits', () => {
    expect(checkTransactionBudgets([scenario()], limits, [], {})).toEqual({
      failures: [],
      knownViolations: [],
    });
  });

  it('reports a known violation that matches its base measurement', () => {
    const current = scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } });
    const result = checkTransactionBudgets([current], limits, [current], { scenario: ['mem'] });

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: memory ex units 20000000 exceed safe budget 15675000 (base 20000000)',
    ]);
  });

  it('rejects a one-unit regression from the base measurement', () => {
    const result = checkTransactionBudgets(
      [scenario({ exUnits: { mem: 20_000_001, steps: 1_000_000_000 } })],
      limits,
      [scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } })],
      { scenario: ['mem'] },
    );

    expect(result.failures).toEqual([
      'Scenario: memory ex units regressed from base 20000000 to 20000001 (safe budget 15675000)',
    ]);
  });

  it('accepts a reviewed regression without changing a numerical ceiling', () => {
    const result = checkTransactionBudgets(
      [scenario({ exUnits: { mem: 20_000_001, steps: 1_000_000_000 } })],
      limits,
      [scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } })],
      { scenario: ['mem'] },
      true,
    );

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: memory ex units 20000001 exceed safe budget 15675000 (approved increase from base 20000000)',
    ]);
  });

  it('accepts an improvement without requiring a new checked-in number', () => {
    const result = checkTransactionBudgets(
      [scenario({ exUnits: { mem: 19_999_999, steps: 1_000_000_000 } })],
      limits,
      [scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } })],
      { scenario: ['mem'] },
    );

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: memory ex units 19999999 exceed safe budget 15675000 (base 20000000)',
    ]);
  });

  it('reports an allowed overrun when a base measurement is unavailable', () => {
    const result = checkTransactionBudgets(
      [scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } })],
      limits,
      [],
      { scenario: ['mem'] },
    );

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: memory ex units 20000000 exceed safe budget 15675000 (base measurement unavailable)',
    ]);
  });

  it('rejects a new over-limit scenario even when reviewed regressions are allowed', () => {
    const result = checkTransactionBudgets(
      [scenario({ exUnits: { mem: 20_000_000, steps: 1_000_000_000 } })],
      limits,
      [],
      {},
      true,
    );

    expect(result.failures).toEqual(['Scenario: memory ex units 20000000 exceed safe budget 15675000']);
  });

  it('compares an allowed transaction-size overrun with the base', () => {
    const result = checkTransactionBudgets(
      [scenario({ signedBytesEstimate: 16_000 })],
      limits,
      [scenario({ signedBytesEstimate: 16_001 })],
      { scenario: ['signedBytesEstimate'] },
    );

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: signed bytes estimate 16000 exceed safe budget 15634 with 750-byte reserve (base 16001)',
    ]);
  });

  it('requires combined first-seen receive-voucher minting to be split away from the normal receive tx', () => {
    const result = checkTransactionBudgets(
      [
        scenario({
          id: 'first_seen_voucher_receive_at_capacity',
          name: 'Combined modeled first-seen voucher RecvPacket path at packet and history capacity',
          unsignedBytes: 20_615,
          signedBytesEstimate: 20_875,
          exUnits: { mem: 83_090_764, steps: 27_585_360_530 },
        }),
      ],
      limits,
      [],
      {},
    );

    expect(result.failures).toEqual(
      expect.arrayContaining([
        'Combined modeled first-seen voucher RecvPacket path at packet and history capacity: unsigned bytes 20615 exceeds safe budget 15634',
      ]),
    );
  });

  it('rejects a transaction-size regression from the base', () => {
    const result = checkTransactionBudgets(
      [scenario({ signedBytesEstimate: 16_001 })],
      limits,
      [scenario({ signedBytesEstimate: 16_000 })],
      { scenario: ['signedBytesEstimate'] },
    );

    expect(result.failures).toEqual([
      'Scenario: signed bytes estimate regressed from base 16000 to 16001 (safe budget 15634, ledger maximum 16384)',
    ]);
  });

  it('identifies an allowed modeled transaction that exceeds the ledger maximum', () => {
    const current = scenario({ signedBytesEstimate: 16_500 });
    const result = checkTransactionBudgets([current], limits, [current], {
      scenario: ['signedBytesEstimate'],
    });

    expect(result.failures).toEqual([]);
    expect(result.knownViolations).toEqual([
      'Scenario: signed bytes estimate 16500 exceed ledger maximum 16384 (base 16500)',
    ]);
  });

  it('requires a stale allowance to be removed once the safe budget is met', () => {
    const result = checkTransactionBudgets([scenario()], limits, [], {
      scenario: ['mem'],
      removed_scenario: ['steps'],
    });

    expect(result.failures).toEqual([
      'known-overrun allowance references missing scenario: removed_scenario',
      'Scenario: memory ex units now fit safe budget 15675000; remove the stale known-overrun allowance',
    ]);
  });

  it('rejects duplicate base scenario IDs', () => {
    const result = checkTransactionBudgets([scenario()], limits, [scenario(), scenario()], {});

    expect(result.failures).toEqual(['base transaction budget scenario IDs must be unique']);
  });
});
