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
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 2, finalize: 1, total: 4 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 45,
        trustedValidatorCount: 45,
        transactions: { initialize: 1, verifyTrusted: 2, verifyTarget: 8, finalize: 1, total: 12 },
      },
      {
        mode: 'adjacent',
        targetValidatorCount: 100,
        trustedValidatorCount: 0,
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 5, finalize: 1, total: 7 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 100,
        trustedValidatorCount: 100,
        transactions: { initialize: 1, verifyTrusted: 5, verifyTarget: 17, finalize: 1, total: 24 },
      },
      {
        mode: 'adjacent',
        targetValidatorCount: 200,
        trustedValidatorCount: 0,
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 9, finalize: 1, total: 11 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 200,
        trustedValidatorCount: 200,
        transactions: { initialize: 1, verifyTrusted: 9, verifyTarget: 34, finalize: 1, total: 45 },
      },
      {
        mode: 'adjacent',
        targetValidatorCount: 256,
        trustedValidatorCount: 0,
        transactions: { initialize: 1, verifyTrusted: 0, verifyTarget: 11, finalize: 1, total: 13 },
      },
      {
        mode: 'non_adjacent',
        targetValidatorCount: 256,
        trustedValidatorCount: 256,
        transactions: { initialize: 1, verifyTrusted: 11, verifyTarget: 43, finalize: 1, total: 56 },
      },
    ]);
  });

  it('caps per-transaction validator and signature work at one batch', () => {
    for (const report of reports) {
      expect(report.batchSize).toBe(24);
      expect(report.peakPerTransaction.validators).toBe(24);
      expect(report.peakPerTransaction.commitSignatures).toBe(report.mode === 'non_adjacent' ? 6 : 24);
      expect(report.peakPerTransaction.trustedMembershipProofs).toBe(report.mode === 'non_adjacent' ? 6 : 0);
    }
  });

  it('labels every row and its rendered table as structural rather than measured', () => {
    expect(reports.every((report) => report.classification === 'deterministic-structural-model')).toBe(true);
    expect(reports.every((report) => report.measured === false)).toBe(true);

    const rendered = formatTendermintMultitxStructuralReports(reports);
    expect(rendered).toContain(TENDERMINT_MULTITX_STRUCTURAL_DISCLAIMER);
    expect(rendered).toContain('not measurements of serialized transaction bytes, execution units, fees, latency');
    expect(rendered).toContain('| non_adjacent | 200 | 200 | 1 | 9 | 34 | 1 | 45 | 24 | 6 | 6 |');
  });
});
