export type ExUnits = {
  mem: number;
  steps: number;
};

export type BudgetScenario = {
  id: string;
  name: string;
  unsignedBytes: number;
  signedBytesEstimate: number;
  exUnits: ExUnits;
};

export type BudgetLimits = {
  maxTxSize: number;
  txHeadroomBytes: number;
  maxTxExMem: number;
  maxTxExSteps: number;
  exUnitHeadroomBps: number;
};

type BudgetCheckResult = {
  failures: string[];
  knownViolations: string[];
};

type KnownBudgetCeiling = Partial<ExUnits> & Partial<Pick<BudgetScenario, 'unsignedBytes' | 'signedBytesEstimate'>>;

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

const KNOWN_BUDGET_OVERRUN_CEILINGS: Readonly<Record<string, KnownBudgetCeiling>> = {
  reference_script_deployment: {
    signedBytesEstimate: 15_775,
  },
  send_packet_at_commitment_capacity: {
    mem: 52_840_821,
    steps: 16_532_223_749,
  },
  recv_packet_at_history_capacity: {
    mem: 49_397_051,
    steps: 15_371_937_200,
  },
  prune_packet_history_at_capacity: {
    mem: 27_591_361,
  },
  trace_registry_rollover: {
    mem: 32_118_256,
    steps: 12_585_112_433,
  },
  first_seen_voucher_receive_at_capacity: {
    unsignedBytes: 20_615,
    signedBytesEstimate: 20_875,
    mem: 96_805_885,
    steps: 31_541_023_235,
  },
  first_seen_voucher_mint: {
    mem: 38_315_184,
    steps: 13_488_487_490,
  },
};

export function checkTransactionBudgets(
  reports: BudgetScenario[],
  limits: BudgetLimits,
  knownCeilings: Readonly<Record<string, KnownBudgetCeiling>> = KNOWN_BUDGET_OVERRUN_CEILINGS,
): BudgetCheckResult {
  const failures: string[] = [];
  const knownViolations: string[] = [];
  const safeTxSize = limits.maxTxSize - limits.txHeadroomBytes;
  const safeMem = Math.floor((limits.maxTxExMem * (10_000 - limits.exUnitHeadroomBps)) / 10_000);
  const safeSteps = Math.floor((limits.maxTxExSteps * (10_000 - limits.exUnitHeadroomBps)) / 10_000);
  const reportsById = new Map(reports.map((report) => [report.id, report]));

  if (reportsById.size !== reports.length) {
    failures.push('transaction budget scenario IDs must be unique');
  }

  for (const scenarioId of Object.keys(knownCeilings)) {
    if (!reportsById.has(scenarioId)) {
      failures.push(`known-overrun ceiling references missing scenario: ${scenarioId}`);
    }
  }

  const checkExUnits = (report: BudgetScenario, metric: keyof ExUnits, label: string, safeBudget: number): void => {
    const actual = report.exUnits[metric];
    const knownCeiling = knownCeilings[report.id]?.[metric];

    if (actual <= safeBudget) {
      if (knownCeiling !== undefined) {
        failures.push(
          `${report.name}: ${label} now fit safe budget ${safeBudget}; remove stale known-overrun ceiling ${knownCeiling}`,
        );
      }
      return;
    }

    if (knownCeiling === undefined) {
      failures.push(`${report.name}: ${label} ${actual} exceed safe budget ${safeBudget}`);
      return;
    }

    if (actual > knownCeiling) {
      failures.push(
        `${report.name}: ${label} ${actual} exceed known-overrun ceiling ${knownCeiling} (safe budget ${safeBudget})`,
      );
      return;
    }

    if (actual < knownCeiling) {
      failures.push(
        `${report.name}: ${label} improved from known-overrun ceiling ${knownCeiling} to ${actual}; lower the ceiling to ${actual}`,
      );
      return;
    }

    knownViolations.push(
      `${report.name}: ${label} ${actual} exceed safe budget ${safeBudget} (regression ceiling ${knownCeiling})`,
    );
  };

  const checkSize = (report: BudgetScenario, metric: 'unsignedBytes' | 'signedBytesEstimate', label: string): void => {
    const actual = report[metric];
    const knownCeiling = knownCeilings[report.id]?.[metric];

    if (actual <= safeTxSize) {
      if (knownCeiling !== undefined) {
        failures.push(
          `${report.name}: ${label} now fit safe budget ${safeTxSize}; remove stale known-overrun ceiling ${knownCeiling}`,
        );
      }
      return;
    }

    if (knownCeiling === undefined) {
      failures.push(`${report.name}: ${label} ${actual} exceeds safe budget ${safeTxSize}`);
      return;
    }

    if (actual > knownCeiling) {
      failures.push(
        `${report.name}: ${label} ${actual} exceed known-overrun ceiling ${knownCeiling} (safe budget ${safeTxSize}, ledger maximum ${limits.maxTxSize})`,
      );
      return;
    }

    if (actual < knownCeiling) {
      failures.push(
        `${report.name}: ${label} improved from known-overrun ceiling ${knownCeiling} to ${actual}; lower the ceiling to ${actual}`,
      );
      return;
    }

    const status =
      actual > limits.maxTxSize
        ? `exceed ledger maximum ${limits.maxTxSize}`
        : `exceed safe budget ${safeTxSize} with ${limits.txHeadroomBytes}-byte reserve`;
    knownViolations.push(`${report.name}: ${label} ${actual} ${status} (regression ceiling ${knownCeiling})`);
  };

  for (const report of reports) {
    checkSize(report, 'unsignedBytes', 'unsigned bytes');
    checkSize(report, 'signedBytesEstimate', 'signed bytes estimate');
    checkExUnits(report, 'mem', 'memory ex units', safeMem);
    checkExUnits(report, 'steps', 'CPU steps', safeSteps);
  }

  return { failures, knownViolations };
}
