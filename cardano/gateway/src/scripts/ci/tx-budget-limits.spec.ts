import { addMaxAlternativeExUnits } from './tx-budget-limits';

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

  it('rejects an empty alternative group', () => {
    expect(() => addMaxAlternativeExUnits({ mem: 0, steps: 0 }, [[]])).toThrow(
      'execution-unit max group must contain at least one alternative',
    );
  });
});
