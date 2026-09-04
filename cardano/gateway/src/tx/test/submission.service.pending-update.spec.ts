import { SubmissionService } from '../submission.service';

describe('SubmissionService pending update strictness', () => {
  let service: SubmissionService;
  let pendingUpdates: {
    peek: jest.Mock;
    commit: jest.Mock;
    takeByExpectedRoot: jest.Mock;
  };

  beforeEach(() => {
    pendingUpdates = {
      peek: jest.fn().mockReturnValue(undefined),
      commit: jest.fn().mockReturnValue(true),
      takeByExpectedRoot: jest.fn().mockReturnValue(undefined),
    };
    service = new SubmissionService(
      { LucidImporter: {}, decodeDatum: jest.fn() } as any,
      { get: jest.fn() } as any,
      {} as any,
      pendingUpdates as any,
      { saveAliases: jest.fn() } as any,
      { findTxByHash: jest.fn(), findTransactionEvidenceByHash: jest.fn() } as any,
      {} as any,
    );
  });

  it('fails hard when a confirmed transaction has no pending update entry', async () => {
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockResolvedValueOnce('root-at-tx');

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'abc123', 1234)).rejects.toThrow(
      'Missing pending IBC update',
    );

    expect(pendingUpdates.peek).toHaveBeenCalledWith('abc123');
    expect(pendingUpdates.takeByExpectedRoot).toHaveBeenCalledWith('root-at-tx');
  });

  it('fails hard on confirmed root lookup error without consuming the exact pending entry', async () => {
    const pending = { expectedNewRoot: 'fallback-root', commit: jest.fn() };
    pendingUpdates.peek.mockReturnValueOnce(pending);
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockRejectedValueOnce(new Error('tx root decode error'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 1234)).rejects.toThrow(
      'tx root decode error',
    );
    expect(pendingUpdates.commit).not.toHaveBeenCalled();
  });
});
