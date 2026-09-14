export type ExUnits = {
  mem: number;
  steps: number;
};

export function addMaxAlternativeExUnits(common: ExUnits, groups: ReadonlyArray<ReadonlyArray<ExUnits>>): ExUnits {
  return groups.reduce((sum, alternatives) => {
    if (alternatives.length === 0) {
      throw new Error('execution-unit max group must contain at least one alternative');
    }
    return {
      mem: sum.mem + Math.max(...alternatives.map(({ mem }) => mem)),
      steps: sum.steps + Math.max(...alternatives.map(({ steps }) => steps)),
    };
  }, common);
}

export function subtractBaselineExUnits(measured: ExUnits, baseline: ExUnits): ExUnits {
  if (baseline.mem > measured.mem || baseline.steps > measured.steps) {
    throw new Error(
      `execution-unit baseline mem=${baseline.mem} steps=${baseline.steps} exceeds ` +
        `measured mem=${measured.mem} steps=${measured.steps}`,
    );
  }

  return {
    mem: measured.mem - baseline.mem,
    steps: measured.steps - baseline.steps,
  };
}
