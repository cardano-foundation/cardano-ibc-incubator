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

export type BudgetMetric = keyof ExUnits | 'unsignedBytes' | 'signedBytesEstimate';

export type KnownBudgetOverruns = Readonly<Record<string, ReadonlyArray<BudgetMetric>>>;

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

const KNOWN_BUDGET_OVERRUNS: KnownBudgetOverruns = {
  reference_script_deployment: ['signedBytesEstimate'],
  send_packet_at_commitment_capacity: ['mem', 'steps'],
  recv_packet_at_history_capacity: ['mem', 'steps'],
  prune_packet_history_at_capacity: ['mem'],
  trace_registry_rollover: ['mem', 'steps'],
  first_seen_voucher_mint: ['mem', 'steps'],
};

export function checkTransactionBudgets(
  reports: BudgetScenario[],
  limits: BudgetLimits,
  baselineReports: BudgetScenario[] = [],
  knownOverruns: KnownBudgetOverruns = KNOWN_BUDGET_OVERRUNS,
  allowBaselineRegressions = false,
): BudgetCheckResult {
  const failures: string[] = [];
  const knownViolations: string[] = [];
  const safeTxSize = limits.maxTxSize - limits.txHeadroomBytes;
  const safeMem = Math.floor((limits.maxTxExMem * (10_000 - limits.exUnitHeadroomBps)) / 10_000);
  const safeSteps = Math.floor((limits.maxTxExSteps * (10_000 - limits.exUnitHeadroomBps)) / 10_000);
  const reportsById = new Map(reports.map((report) => [report.id, report]));
  const baselinesById = new Map(baselineReports.map((report) => [report.id, report]));

  if (reportsById.size !== reports.length) {
    failures.push('transaction budget scenario IDs must be unique');
  }

  if (baselinesById.size !== baselineReports.length) {
    failures.push('base transaction budget scenario IDs must be unique');
  }

  for (const scenarioId of Object.keys(knownOverruns)) {
    if (!reportsById.has(scenarioId)) {
      failures.push(`known-overrun allowance references missing scenario: ${scenarioId}`);
    }
  }

  const checkExUnits = (report: BudgetScenario, metric: keyof ExUnits, label: string, safeBudget: number): void => {
    const actual = report.exUnits[metric];
    const baseline = baselinesById.get(report.id)?.exUnits[metric];
    const isKnownOverrun = knownOverruns[report.id]?.includes(metric) ?? false;

    if (actual <= safeBudget) {
      if (isKnownOverrun) {
        failures.push(
          `${report.name}: ${label} now fit safe budget ${safeBudget}; remove the stale known-overrun allowance`,
        );
      }
      return;
    }

    if (!isKnownOverrun) {
      failures.push(`${report.name}: ${label} ${actual} exceed safe budget ${safeBudget}`);
      return;
    }

    if (baseline !== undefined && actual > baseline && !allowBaselineRegressions) {
      failures.push(
        `${report.name}: ${label} regressed from base ${baseline} to ${actual} (safe budget ${safeBudget})`,
      );
      return;
    }

    const comparison =
      baseline === undefined
        ? 'base measurement unavailable'
        : actual > baseline
          ? `approved increase from base ${baseline}`
          : `base ${baseline}`;
    knownViolations.push(`${report.name}: ${label} ${actual} exceed safe budget ${safeBudget} (${comparison})`);
  };

  const checkSize = (report: BudgetScenario, metric: 'unsignedBytes' | 'signedBytesEstimate', label: string): void => {
    const actual = report[metric];
    const baseline = baselinesById.get(report.id)?.[metric];
    const isKnownOverrun = knownOverruns[report.id]?.includes(metric) ?? false;

    if (actual <= safeTxSize) {
      if (isKnownOverrun) {
        failures.push(
          `${report.name}: ${label} now fit safe budget ${safeTxSize}; remove the stale known-overrun allowance`,
        );
      }
      return;
    }

    if (!isKnownOverrun) {
      failures.push(`${report.name}: ${label} ${actual} exceeds safe budget ${safeTxSize}`);
      return;
    }

    if (baseline !== undefined && actual > baseline && !allowBaselineRegressions) {
      failures.push(
        `${report.name}: ${label} regressed from base ${baseline} to ${actual} (safe budget ${safeTxSize}, ledger maximum ${limits.maxTxSize})`,
      );
      return;
    }

    const status =
      actual > limits.maxTxSize
        ? `exceed ledger maximum ${limits.maxTxSize}`
        : `exceed safe budget ${safeTxSize} with ${limits.txHeadroomBytes}-byte reserve`;
    const comparison =
      baseline === undefined
        ? 'base measurement unavailable'
        : actual > baseline
          ? `approved increase from base ${baseline}`
          : `base ${baseline}`;
    knownViolations.push(`${report.name}: ${label} ${actual} ${status} (${comparison})`);
  };

  for (const report of reports) {
    checkSize(report, 'unsignedBytes', 'unsigned bytes');
    checkSize(report, 'signedBytesEstimate', 'signed bytes estimate');
    checkExUnits(report, 'mem', 'memory ex units', safeMem);
    checkExUnits(report, 'steps', 'CPU steps', safeSteps);
  }

  return { failures, knownViolations };
}
