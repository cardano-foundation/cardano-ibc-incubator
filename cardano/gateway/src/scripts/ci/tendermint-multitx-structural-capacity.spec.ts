import {
  buildDefaultTendermintMultitxStructuralReports,
  formatTendermintMultitxStructuralReports,
  TENDERMINT_MULTITX_STRUCTURAL_DISCLAIMER,
} from './tendermint-multitx-structural-capacity';

describe('Tendermint staged-v1 structural capacity', () => {
  const reports = buildDefaultTendermintMultitxStructuralReports();

  it('reports deterministic transaction counts through the 256-validator protocol limit', () => {
    expect(
      reports.map(({ mode, targetValidatorCount, trustedValidatorCount, transactions }) => ({
        mode,
        targetValidatorCount,
        trustedValidatorCount,
        transactions,
      })),
    ).toEqual([
      {
        mode: 'adjacent',
        targetValidatorCount: 45,
        trustedValidatorCount: 0,
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 8, finalize: 1, total: 10 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 45,
        trustedValidatorCount: 45,
        transactions: { initialize: 1, verifyTrusted: 8, verifyTarget: 8, finalize: 1, total: 18 },
      },
      {
        mode: 'adjacent',
        targetValidatorCount: 100,
        trustedValidatorCount: 0,
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 17, finalize: 1, total: 19 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 100,
        trustedValidatorCount: 100,
        transactions: { initialize: 1, verifyTrusted: 17, verifyTarget: 17, finalize: 1, total: 36 },
      },
      {
        mode: 'adjacent',
        targetValidatorCount: 200,
        trustedValidatorCount: 0,
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 34, finalize: 1, total: 36 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 200,
        trustedValidatorCount: 200,
        transactions: { initialize: 1, verifyTrusted: 34, verifyTarget: 34, finalize: 1, total: 70 },
      },
      {
        mode: 'adjacent',
        targetValidatorCount: 256,
        trustedValidatorCount: 0,
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 43, finalize: 1, total: 45 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 256,
        trustedValidatorCount: 256,
        transactions: { initialize: 1, verifyTrusted: 43, verifyTarget: 43, finalize: 1, total: 88 },
      },
    ]);
  });

  it('caps per-transaction validator and signature work at one batch', () => {
    for (const report of reports) {
      expect(report.batchSize).toBe(6);
      expect(report.peakPerTransaction.validators).toBe(6);
      expect(report.peakPerTransaction.commitSignatures).toBe(6);
      expect(report.peakPerTransaction.trustedMembershipProofs).toBe(report.mode === 'non_adjacent' ? 6 : 0);
    }
  });

  it('labels every row and its rendered table as structural rather than measured', () => {
    expect(reports.every((report) => report.classification === 'deterministic-structural-model')).toBe(true);
    expect(reports.every((report) => report.measured === false)).toBe(true);

    const rendered = formatTendermintMultitxStructuralReports(reports);
    expect(rendered).toContain(TENDERMINT_MULTITX_STRUCTURAL_DISCLAIMER);
    expect(rendered).toContain('not measurements of serialized transaction bytes, execution units, fees, latency');
    expect(rendered).toContain('| non_adjacent | 200 | 200 | 1 | 34 | 34 | 1 | 70 | 6 | 6 | 6 |');
  });
});
