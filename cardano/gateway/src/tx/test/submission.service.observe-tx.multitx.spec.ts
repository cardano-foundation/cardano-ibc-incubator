import { createTestTreeStore } from '../../shared/testing/ibc-tree-test-store';
import { SubmissionService } from '../submission.service';

const TX_HASH = 'ab'.repeat(32);
const EVIDENCE = { blockNo: 1234, blockHash: 'ef'.repeat(32) };

describe('SubmissionService staged ObserveTx', () => {
  let service: SubmissionService;
  let pendingUpdates: { peek: jest.Mock; commitNeutral: jest.Mock; takeByExpectedRoot: jest.Mock };
  let history: { findTxByHash: jest.Mock; findTransactionEvidenceByHash: jest.Mock; findBlockByHeight: jest.Mock };

  beforeEach(() => {
    pendingUpdates = {
      peek: jest.fn(),
      commitNeutral: jest.fn().mockResolvedValue(true),
      takeByExpectedRoot: jest.fn(),
    };
    history = { findTxByHash: jest.fn(), findTransactionEvidenceByHash: jest.fn(), findBlockByHeight: jest.fn() };
    service = new SubmissionService(
      { LucidImporter: {}, decodeDatum: jest.fn() } as any,
      { get: jest.fn() } as any,
      { take: jest.fn(), takeByExpectedRoot: jest.fn() } as any,
      pendingUpdates as any,
      { saveAliases: jest.fn() } as any,
      history as any,
      {} as any,
      createTestTreeStore(),
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
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockResolvedValue(EVIDENCE);
    const verifyEvidence = jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockReturnValue('body-cbor');
    const applyTreeUpdate = jest.spyOn(service as any, 'applyExactPendingIbcTreeUpdate');

    await expect(service.observeTransaction({ tx_hash: TX_HASH })).resolves.toEqual({
      tx_hash: TX_HASH,
      height: '0-1234',
      events: [],
    });

    expect(verifyEvidence).toHaveBeenCalledWith(TX_HASH, EVIDENCE);
    expect(pendingUpdates.commitNeutral).toHaveBeenCalledWith(TX_HASH, pending);
    expect(applyTreeUpdate).not.toHaveBeenCalled();
  });

  it('observes an explicitly allowed trace prelude without committing staged state', async () => {
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockResolvedValue(EVIDENCE);
    const verifyEvidence = jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockReturnValue('body-cbor');
    const indexedEvents = jest.spyOn(service as any, 'findIndexedIbcEvents').mockResolvedValue([]);
    const applyTreeUpdate = jest.spyOn(service as any, 'applyExactPendingIbcTreeUpdate');

    await expect(service.observeTransaction({ tx_hash: TX_HASH, allow_untracked: true })).resolves.toEqual({
      tx_hash: TX_HASH,
      height: '0-1234',
      events: [],
    });

    expect(verifyEvidence).toHaveBeenCalledWith(TX_HASH, EVIDENCE);
    expect(indexedEvents).toHaveBeenCalledWith(TX_HASH);
    expect(pendingUpdates.commitNeutral).not.toHaveBeenCalled();
    expect(applyTreeUpdate).not.toHaveBeenCalled();
  });

  it('re-resolves a cached trace prelude observation after its block is rolled back', async () => {
    const reorgEvidence = { blockNo: 1240, blockHash: '12'.repeat(32) };
    const waitForEvidence = jest
      .spyOn(service as any, 'waitForIndexedTransactionEvidence')
      .mockResolvedValueOnce(EVIDENCE)
      .mockResolvedValueOnce(reorgEvidence);
    const verifyEvidence = jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockReturnValue('body-cbor');
    const event = { type: 'recv_packet', attributes: [{ key: 'packet_sequence', value: '1' }] };
    const indexedEvents = jest.spyOn(service as any, 'findIndexedIbcEvents').mockResolvedValue([event]);
    const request = { tx_hash: TX_HASH, allow_untracked: true };

    await expect(service.observeTransaction(request)).resolves.toEqual({
      tx_hash: TX_HASH,
      height: '0-1234',
      events: [event],
    });
    history.findBlockByHeight.mockResolvedValueOnce({ hash: EVIDENCE.blockHash });
    await expect(service.observeTransaction(request)).resolves.toMatchObject({ height: '0-1234' });
    history.findBlockByHeight.mockResolvedValueOnce({ hash: '00'.repeat(32) });
    await expect(service.observeTransaction(request)).resolves.toEqual({
      tx_hash: TX_HASH,
      height: '0-1240',
      events: [event],
    });

    expect(history.findBlockByHeight.mock.calls).toEqual([[1234n], [1234n]]);
    expect(waitForEvidence).toHaveBeenCalledTimes(2);
    expect(verifyEvidence).toHaveBeenLastCalledWith(TX_HASH, reorgEvidence);
    expect(indexedEvents).toHaveBeenCalledTimes(1);
  });

  it('does not consume a tree-neutral registration if exact evidence verification fails', async () => {
    const pending = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn() };
    pendingUpdates.peek.mockReturnValue(pending);
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockResolvedValue(EVIDENCE);
    jest.spyOn(service as any, 'verifyObservedTransactionEvidence').mockImplementation(() => {
      throw new Error('body hash mismatch');
    });

    await expect(service.observeTransaction({ tx_hash: TX_HASH })).rejects.toThrow('body hash mismatch');
    expect(pendingUpdates.commitNeutral).not.toHaveBeenCalled();
  });

  it('coalesces concurrent observations of the same phase boundary', async () => {
    const pending = { kind: 'tree_neutral' as const, expectedNewRoot: '', commit: jest.fn() };
    pendingUpdates.peek.mockReturnValue(pending);
    let releaseEvidence!: () => void;
    jest.spyOn(service as any, 'waitForIndexedTransactionEvidence').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseEvidence = () => resolve(EVIDENCE);
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
    expect(pendingUpdates.commitNeutral).toHaveBeenCalledTimes(1);
  });
});
