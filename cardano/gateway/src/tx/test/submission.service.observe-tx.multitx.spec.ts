import { SubmissionService } from '../submission.service';

const TX_HASH = 'ab'.repeat(32);

describe('SubmissionService staged ObserveTx', () => {
  let service: SubmissionService;
  let pendingUpdates: { peek: jest.Mock; commit: jest.Mock; takeByExpectedRoot: jest.Mock };
  let history: { findTxByHash: jest.Mock; findTransactionEvidenceByHash: jest.Mock };

  beforeEach(() => {
    pendingUpdates = {
      peek: jest.fn(),
      commit: jest.fn().mockReturnValue(true),
      takeByExpectedRoot: jest.fn(),
    };
    history = { findTxByHash: jest.fn(), findTransactionEvidenceByHash: jest.fn() };
    service = new SubmissionService(
      { LucidImporter: {}, decodeDatum: jest.fn() } as any,
      { get: jest.fn() } as any,
      { take: jest.fn(), takeByExpectedRoot: jest.fn() } as any,
      pendingUpdates as any,
      { saveAliases: jest.fn() } as any,
      history as any,
      {} as any,
    );
  });

  it('rejects non-canonical and unregistered transaction hashes before polling history', async () => {
    await expect(service.observeTransaction({ tx_hash: TX_HASH.toUpperCase() })).rejects.toThrow('canonical lowercase');
    await expect(service.observeTransaction({ tx_hash: TX_HASH })).rejects.toThrow('Missing exact pending');
    expect(history.findTransactionEvidenceByHash).not.toHaveBeenCalled();
  });

  it('confirms an exact tree-neutral phase boundary without reading or committing HostState', async () => {
    const pending = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn() };
    pendingUpdates.peek.mockReturnValue(pending);
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockResolvedValue({ blockNo: 1234 });
    const verifyEvidence = jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockReturnValue('body-cbor');
    const applyTreeUpdate = jest.spyOn(service as any, 'applyExactPendingIbcTreeUpdate');

    await expect(service.observeTransaction({ tx_hash: TX_HASH })).resolves.toEqual({
      tx_hash: TX_HASH,
      height: '0-1234',
      events: [],
    });

    expect(verifyEvidence).toHaveBeenCalledWith(TX_HASH, { blockNo: 1234 });
    expect(pendingUpdates.commit).toHaveBeenCalledWith(TX_HASH, pending);
    expect(applyTreeUpdate).not.toHaveBeenCalled();
  });

  it('does not consume a tree-neutral registration if exact evidence verification fails', async () => {
    const pending = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn() };
    pendingUpdates.peek.mockReturnValue(pending);
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockResolvedValue({ blockNo: 1234 });
    jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockImplementation(() => {
      throw new Error('body hash mismatch');
    });

    await expect(service.observeTransaction({ tx_hash: TX_HASH })).rejects.toThrow('body hash mismatch');
    expect(pendingUpdates.commit).not.toHaveBeenCalled();
  });

  it('coalesces concurrent observations of the same phase boundary', async () => {
    const pending = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn() };
    pendingUpdates.peek.mockReturnValue(pending);
    let releaseEvidence!: () => void;
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseEvidence = () => resolve({ blockNo: 1234 });
        }),
    );
    jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockReturnValue('body-cbor');

    const first = service.observeTransaction({ tx_hash: TX_HASH });
    const second = service.observeTransaction({ tx_hash: TX_HASH });
    releaseEvidence();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { tx_hash: TX_HASH, height: '0-1234', events: [] },
      { tx_hash: TX_HASH, height: '0-1234', events: [] },
    ]);
    expect((service as any).waitForIndexedTransactionEvidence).toHaveBeenCalledTimes(1);
    expect(pendingUpdates.commit).toHaveBeenCalledTimes(1);
  });
});
