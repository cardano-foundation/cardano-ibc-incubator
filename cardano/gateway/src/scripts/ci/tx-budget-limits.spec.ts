import { addMaxAlternativeExUnits, subtractBaselineExUnits } from './tx-budget-limits';

describe('transaction cost estimates', () => {
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
      subtractBaselineExUnits({ mem: 38_700_147, steps: 11_520_189_768 }, { mem: 23_634_810, steps: 6_546_126_609 }),
    ).toEqual({ mem: 15_065_337, steps: 4_974_063_159 });
  });

  it('rejects a fixture baseline larger than its paired measurement', () => {
    expect(() => subtractBaselineExUnits({ mem: 10, steps: 20 }, { mem: 11, steps: 20 })).toThrow(
      'execution-unit baseline mem=11 steps=20 exceeds measured mem=10 steps=20',
    );
  });

  it('rejects an empty alternative group', () => {
    expect(() => addMaxAlternativeExUnits({ mem: 0, steps: 0 }, [[]])).toThrow(
      'execution-unit max group must contain at least one alternative',
    );
  });
});
