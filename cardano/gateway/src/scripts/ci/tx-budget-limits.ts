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

const KNOWN_BUDGET_OVERRUN_CEILINGS: Readonly<Record<string, KnownBudgetCeiling>> = {
  reference_script_deployment: {
    // Proof-backed history adds the witness verifier to consumer scripts. The
    // existing conservative deployment model remains below 16,384 bytes, but
    // above the unchanged 750-byte reserve; it is not a new ledger-size waiver.
    unsignedBytes: 15_818,
    signedBytesEstimate: 16_078,
  },
  send_packet_at_commitment_capacity: {
    // Existing unsupported capacity model, remeasured after proof-backed
    // history/witness-envelope integration and removing the redundant singleton
    // check. These are full Aiken fixture estimates, not supported ledger flows.
    // Network limits and execution/size reserves are unchanged.
    mem: 38_257_823,
    steps: 12_088_544_688,
  },
  recv_packet_at_history_capacity: {
    // The same already-unsupported capacity fixture now includes proof-backed
    // history dispatch and the VerifyProofEnvelope rather than archive UTxOs.
    mem: 40_930_575,
    steps: 12_835_088_040,
  },
  prune_packet_history_at_capacity: {
    // Packet-history pruning is unchanged; its existing unsupported capacity
    // fixture uses the new consensus-history witness/envelope proof consumer.
    mem: 25_427_902,
  },
  trace_registry_rollover: {
    mem: 25_643_260,
    steps: 10_897_080_470,
  },
  first_seen_voucher_receive_at_capacity: {
    // Already unsupported in both size and execution. The proof envelope adds
    // six modeled bytes; execution inherits the updated RecvPacket component.
    unsignedBytes: 20_621,
    signedBytesEstimate: 20_881,
    mem: 83_473_293,
    steps: 27_721_323_739,
  },
  first_seen_voucher_mint: {
    mem: 33_842_210,
    steps: 12_321_606_174,
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
