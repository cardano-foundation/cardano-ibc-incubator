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

const KNOWN_EX_UNIT_OVERRUN_CEILINGS: Readonly<Record<string, Partial<ExUnits>>> = {
  send_packet_at_commitment_capacity: {
    mem: 57_749_497,
    steps: 18_035_494_695,
  },
  recv_packet_at_history_capacity: {
    mem: 47_508_992,
    steps: 14_651_291_183,
  },
  prune_packet_history_at_capacity: {
    mem: 27_615_479,
  },
  trace_registry_rollover: {
    mem: 32_118_256,
    steps: 12_585_112_433,
  },
  first_seen_voucher_mint: {
    mem: 35_511_099,
    steps: 13_083_237_379,
  },
};

export function checkTransactionBudgets(
  reports: BudgetScenario[],
  limits: BudgetLimits,
  knownCeilings: Readonly<Record<string, Partial<ExUnits>>> = KNOWN_EX_UNIT_OVERRUN_CEILINGS,
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

  for (const report of reports) {
    if (report.unsignedBytes > safeTxSize) {
      failures.push(`${report.name}: unsigned bytes ${report.unsignedBytes} exceed safe budget ${safeTxSize}`);
    }
    if (report.signedBytesEstimate > safeTxSize) {
      failures.push(
        `${report.name}: signed bytes estimate ${report.signedBytesEstimate} exceeds safe budget ${safeTxSize}`,
      );
    }
    checkExUnits(report, 'mem', 'memory ex units', safeMem);
    checkExUnits(report, 'steps', 'CPU steps', safeSteps);
  }

  return { failures, knownViolations };
}
