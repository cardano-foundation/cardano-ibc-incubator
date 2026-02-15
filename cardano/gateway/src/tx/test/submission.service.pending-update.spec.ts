import { SubmissionService } from '../submission.service';

describe('SubmissionService pending update strictness', () => {
  let service: SubmissionService;
  let lucidServiceMock: {
    LucidImporter: Record<string, unknown>;
    findUtxoAtHostStateNFT: jest.Mock;
    decodeDatum: jest.Mock;
  };
  let dbSyncServiceMock: {
    findHostStateUtxoByTxHash: jest.Mock;
  };
  let ibcTreePendingUpdatesServiceMock: {
    take: jest.Mock;
    takeByExpectedRoot: jest.Mock;
  };
  let denomTraceServiceMock: {
    setTxHashForTraces: jest.Mock;
  };

  beforeEach(() => {
    ibcTreePendingUpdatesServiceMock = {
      take: jest.fn().mockReturnValue(undefined),
      takeByExpectedRoot: jest.fn().mockReturnValue(undefined),
    };

    denomTraceServiceMock = {
      setTxHashForTraces: jest.fn(),
    };

    lucidServiceMock = {
      LucidImporter: {},
      findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({ datum: 'host-state-datum' }),
      decodeDatum: jest.fn().mockResolvedValue({ state: { ibc_state_root: 'root-at-tx' } }),
    };

    dbSyncServiceMock = {
      findHostStateUtxoByTxHash: jest.fn().mockResolvedValue({ datum: 'host-state-datum' }),
    };
    const txEventsServiceMock = {};
    const kupoServiceMock = {};
    const ibcTreeCacheServiceMock = {};

    service = new SubmissionService(
      lucidServiceMock as any,
      dbSyncServiceMock as any,
      txEventsServiceMock as any,
      kupoServiceMock as any,
      ibcTreePendingUpdatesServiceMock as any,
      ibcTreeCacheServiceMock as any,
      denomTraceServiceMock as any,
    );
  });

  it('fails hard when confirmed tx has no pending update entry', async () => {
    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'abc123')).rejects.toThrow();

    expect(ibcTreePendingUpdatesServiceMock.take).toHaveBeenCalledWith('abc123');
    expect(ibcTreePendingUpdatesServiceMock.takeByExpectedRoot).toHaveBeenCalledWith('root-at-tx');
    expect(denomTraceServiceMock.setTxHashForTraces).not.toHaveBeenCalled();
  });

  it('fails hard on db-sync runtime error instead of falling back to current HostState', async () => {
    // Simulate a real pending update that would otherwise be eligible to commit.
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'fallback-root',
      commit: jest.fn(),
      denomTraceHashes: [],
    });
    // Simulate db-sync/runtime failure when reading tx-scoped HostState.
    dbSyncServiceMock.findHostStateUtxoByTxHash.mockRejectedValueOnce(new Error('db-sync runtime error'));
    // Even if a hypothetical fallback path could decode a matching root, the
    // service must reject and never use current/latest HostState for this tx.
    lucidServiceMock.decodeDatum.mockResolvedValueOnce({
      state: { ibc_state_root: 'fallback-root' },
    });

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc')).rejects.toThrow(
      'db-sync runtime error',
    );
    expect(lucidServiceMock.findUtxoAtHostStateNFT).not.toHaveBeenCalled();
  });
});
