import { SubmissionService } from '../submission.service';

describe('SubmissionService confirmation strictness regressions', () => {
  let service: SubmissionService;
  let lucidServiceMock: {
    LucidImporter: Record<string, unknown>;
    lucid: {
      wallet: jest.Mock;
      awaitTx: jest.Mock;
    };
    findUtxoAtHostStateNFT: jest.Mock;
    decodeDatum: jest.Mock;
  };
  let dbSyncServiceMock: {
    findHeightByTxHash: jest.Mock;
    queryLatestBlockNo: jest.Mock;
  };
  let txEventsServiceMock: {
    take: jest.Mock;
  };
  let ibcTreePendingUpdatesServiceMock: {
    take: jest.Mock;
  };
  let ibcTreeCacheServiceMock: {
    save: jest.Mock;
  };
  let denomTraceServiceMock: {
    setTxHashForTraces: jest.Mock;
  };

  beforeEach(() => {
    lucidServiceMock = {
      LucidImporter: {},
      lucid: {
        wallet: jest.fn().mockReturnValue({
          submitTx: jest.fn().mockResolvedValue('tx-hash-abc'),
        }),
        awaitTx: jest.fn().mockResolvedValue(false),
      },
      findUtxoAtHostStateNFT: jest.fn(),
      decodeDatum: jest.fn(),
    };

    dbSyncServiceMock = {
      findHeightByTxHash: jest.fn().mockResolvedValue(undefined),
      queryLatestBlockNo: jest.fn().mockResolvedValue(9999),
    };

    txEventsServiceMock = {
      take: jest.fn().mockReturnValue([]),
    };

    ibcTreePendingUpdatesServiceMock = {
      take: jest.fn().mockReturnValue(undefined),
    };

    ibcTreeCacheServiceMock = {
      save: jest.fn().mockResolvedValue(undefined),
    };

    denomTraceServiceMock = {
      setTxHashForTraces: jest.fn().mockResolvedValue(1),
    };

    service = new SubmissionService(
      lucidServiceMock as any,
      dbSyncServiceMock as any,
      txEventsServiceMock as any,
      {} as any,
      ibcTreePendingUpdatesServiceMock as any,
      ibcTreeCacheServiceMock as any,
      denomTraceServiceMock as any,
    );
  });

  it('fails hard when confirmation polling times out', async () => {
    await expect((service as any).waitForConfirmation('tx-timeout', 0)).rejects.toThrow();
  });

  it('fails hard when db-sync height lookup times out instead of falling back', async () => {
    await expect((service as any).waitForDbSyncTxHeight('tx-no-height', 0)).rejects.toThrow();
    expect(dbSyncServiceMock.queryLatestBlockNo).not.toHaveBeenCalled();
  });

  it('does not finalize denom traces if on-chain root verification fails', async () => {
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'expected-root',
      commit: jest.fn(),
      denomTraceHashes: ['voucher-hash'],
    });
    lucidServiceMock.findUtxoAtHostStateNFT.mockRejectedValueOnce(new Error('hoststate unavailable'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc')).rejects.toThrow();
    expect(denomTraceServiceMock.setTxHashForTraces).not.toHaveBeenCalled();
  });

  it('does not return submit success when confirmation status is unknown', async () => {
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'expected-root',
      commit: jest.fn(),
      denomTraceHashes: ['voucher-hash'],
    });
    lucidServiceMock.findUtxoAtHostStateNFT.mockResolvedValueOnce({ datum: 'host-datum' });
    lucidServiceMock.decodeDatum.mockResolvedValueOnce({
      state: {
        ibc_state_root: 'expected-root',
      },
    });

    jest.spyOn(service as any, 'waitForConfirmation').mockResolvedValueOnce(undefined);
    jest.spyOn(service as any, 'waitForDbSyncTxHeight').mockResolvedValueOnce(9999);

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
      } as any),
    ).rejects.toThrow();
    expect(denomTraceServiceMock.setTxHashForTraces).not.toHaveBeenCalled();
  });
});
