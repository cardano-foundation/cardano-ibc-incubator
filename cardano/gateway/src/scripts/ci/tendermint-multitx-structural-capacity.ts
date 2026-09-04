import {
  buildTendermintUpdatePlan,
  TENDERMINT_MULTITX_MAX_BATCH_SIZE,
  type TendermintUpdateMode,
  type TendermintUpdateStepKind,
} from '../../tx/update-client-plan';

export const TENDERMINT_MULTITX_STRUCTURAL_COUNTS = [45, 100, 200, 256] as const;

export const TENDERMINT_MULTITX_STRUCTURAL_DISCLAIMER =
  'Structural model only. These counts are not measurements of serialized transaction bytes, execution units, fees, latency, or same-block capacity.';

export type TendermintMultitxStructuralReport = {
  classification: 'deterministic-structural-model';
  measured: false;
  mode: TendermintUpdateMode;
  targetValidatorCount: number;
  trustedValidatorCount: number;
  batchSize: number;
  transactions: {
    initialize: number;
    verifyTrusted: number;
    verifyTarget: number;
    finalize: number;
    total: number;
  };
  peakPerTransaction: {
    validators: number;
    commitSignatures: number;
    trustedMembershipProofs: number;
  };
};

function countSteps(steps: ReadonlyArray<{ kind: TendermintUpdateStepKind }>, kind: TendermintUpdateStepKind): number {
  return steps.filter((step) => step.kind === kind).length;
}

export function buildTendermintMultitxStructuralReport(
  targetValidatorCount: number,
  mode: TendermintUpdateMode,
): TendermintMultitxStructuralReport {
  // Equal trusted/target counts give the requested validator-set capacity row
  // for skipped-height updates. Adjacent updates do not stream a trusted set.
  const trustedValidatorCount = mode === 'non_adjacent' ? targetValidatorCount : 0;
  const plan = buildTendermintUpdatePlan({
    clientId: '07-tendermint-structural-capacity',
    clientMessageHash: '00'.repeat(32),
    mode,
    targetValidatorCount,
    trustedValidatorCount,
    batchSize: TENDERMINT_MULTITX_MAX_BATCH_SIZE,
  });

  const initialize = countSteps(plan.steps, 'initialize');
  const verifyTrusted = countSteps(plan.steps, 'verify_trusted');
  const verifyTarget = countSteps(plan.steps, 'verify_target');
  const finalize = countSteps(plan.steps, 'finalize');
  const peakValidators = Math.min(targetValidatorCount, plan.batchSize);

  return {
    classification: 'deterministic-structural-model',
    measured: false,
    mode,
    targetValidatorCount,
    trustedValidatorCount,
    batchSize: plan.batchSize,
    transactions: {
      initialize,
      verifyTrusted,
      verifyTarget,
      finalize,
      total: plan.steps.length,
    },
    peakPerTransaction: {
      validators: peakValidators,
      commitSignatures: peakValidators,
      trustedMembershipProofs: mode === 'non_adjacent' ? peakValidators : 0,
    },
  };
}

export function buildDefaultTendermintMultitxStructuralReports(): TendermintMultitxStructuralReport[] {
  return TENDERMINT_MULTITX_STRUCTURAL_COUNTS.flatMap((validatorCount) => [
    buildTendermintMultitxStructuralReport(validatorCount, 'adjacent'),
    buildTendermintMultitxStructuralReport(validatorCount, 'non_adjacent'),
  ]);
}

export function formatTendermintMultitxStructuralReports(
  reports: ReadonlyArray<TendermintMultitxStructuralReport>,
): string {
  const header =
    '| Mode | Target validators | Trusted validators | Init txs | Trusted txs | Target txs | Final txs | Total txs | Peak validators/tx | Peak signatures/tx | Peak trusted proofs/tx |';
  const separator = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const rows = reports.map((report) => {
    const { transactions, peakPerTransaction } = report;
    return `| ${report.mode} | ${report.targetValidatorCount} | ${report.trustedValidatorCount} | ${transactions.initialize} | ${transactions.verifyTrusted} | ${transactions.verifyTarget} | ${transactions.finalize} | ${transactions.total} | ${peakPerTransaction.validators} | ${peakPerTransaction.commitSignatures} | ${peakPerTransaction.trustedMembershipProofs} |`;
  });

  return [
    TENDERMINT_MULTITX_STRUCTURAL_DISCLAIMER,
    '',
    `Assumptions: staged v1, batch size ${TENDERMINT_MULTITX_MAX_BATCH_SIZE}, one transaction per plan step, and equal trusted/target set sizes for non-adjacent rows.`,
    '',
    header,
    separator,
    ...rows,
  ].join('\n');
}

if (require.main === module) {
  console.log(formatTendermintMultitxStructuralReports(buildDefaultTendermintMultitxStructuralReports()));
}
