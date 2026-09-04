import { SubmissionService } from '../submission.service';

describe('SubmissionService confirmation strictness regressions', () => {
  let service: SubmissionService;
  let pendingUpdates: {
    peek: jest.Mock;
    commit: jest.Mock;
    takeByExpectedRoot: jest.Mock;
  };
  let treeCache: { saveAliases: jest.Mock };
  let history: { findTxByHash: jest.Mock; findTransactionEvidenceByHash: jest.Mock };

  beforeEach(() => {
    const lucidService = {
      LucidImporter: {},
      lucid: { wallet: jest.fn().mockReturnValue({ submitTx: jest.fn().mockResolvedValue('tx-hash-abc') }) },
      decodeDatum: jest.fn(),
    };
    pendingUpdates = {
      peek: jest.fn().mockReturnValue(undefined),
      commit: jest.fn().mockReturnValue(true),
      takeByExpectedRoot: jest.fn().mockReturnValue(undefined),
    };
    treeCache = { saveAliases: jest.fn().mockResolvedValue(undefined) };
    history = { findTxByHash: jest.fn(), findTransactionEvidenceByHash: jest.fn() };
    service = new SubmissionService(
      lucidService as any,
      { get: jest.fn() } as any,
      { take: jest.fn().mockReturnValue([]), takeByExpectedRoot: jest.fn() } as any,
      pendingUpdates as any,
      treeCache as any,
      history as any,
      {
        queryClientEventsByTxHash: jest.fn().mockResolvedValue({ events: [] }),
        queryPacketEventsByTxHash: jest.fn().mockResolvedValue({ events: [] }),
      } as any,
    );
  });

  it('fails hard when history indexing confirmation times out', async () => {
    await expect((service as any).waitForIndexedConfirmation('tx-timeout', 0)).rejects.toThrow(
      'history indexing timeout',
    );
  });

  it('does not return submit success when confirmation status is unknown', async () => {
    jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('tx-hash-abc');
    jest.spyOn(service as any, 'waitForIndexedConfirmation').mockRejectedValueOnce(new Error('not confirmed'));

    await expect(service.submitSignedTransaction({ signed_tx_cbor: 'deadbeef' })).rejects.toThrow('not confirmed');
    expect(history.findTxByHash).not.toHaveBeenCalled();
  });

  it('does not finalize the IBC tree if confirmed HostState lookup fails', async () => {
    const pending = { expectedNewRoot: 'expected-root', commit: jest.fn() };
    pendingUpdates.peek.mockReturnValueOnce(pending);
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockRejectedValueOnce(new Error('hoststate unavailable'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999)).rejects.toThrow(
      'hoststate unavailable',
    );
    expect(pendingUpdates.commit).not.toHaveBeenCalled();
  });

  it('persists snapshots only after committing the exact pending entry', async () => {
    const pending = { expectedNewRoot: 'ab'.repeat(32), commit: jest.fn() };
    pendingUpdates.peek.mockReturnValueOnce(pending);
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockResolvedValueOnce('ab'.repeat(32));

    await (service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999);

    expect(pendingUpdates.commit).toHaveBeenCalledWith('tx-hash-abc', pending);
    expect(treeCache.saveAliases).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['current', `root:${'ab'.repeat(32)}`, 'height:9999']),
    );
  });
});
