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
  let configServiceMock: {
    get: jest.Mock;
  };
  let txEventsServiceMock: {
    take: jest.Mock;
  };
  let ibcTreePendingUpdatesServiceMock: {
    take: jest.Mock;
  };
  let ibcTreeCacheServiceMock: {
    saveAliases: jest.Mock;
  };
  let historyServiceMock: {
    findTxByHash: jest.Mock;
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

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ogmiosEndpoint') {
          return 'ws://localhost:1337';
        }
        if (key === 'deployment') {
          return {
            hostStateNFT: {
              policyId: 'policy-id',
              name: 'token-name',
            },
          };
        }
        return undefined;
      }),
    };

    txEventsServiceMock = {
      take: jest.fn().mockReturnValue([]),
    };

    ibcTreePendingUpdatesServiceMock = {
      take: jest.fn().mockReturnValue(undefined),
    };

    ibcTreeCacheServiceMock = {
      saveAliases: jest.fn().mockResolvedValue(undefined),
    };
    historyServiceMock = {
      findTxByHash: jest.fn().mockResolvedValue(null),
    };

    service = new SubmissionService(
      lucidServiceMock as any,
      configServiceMock as any,
      txEventsServiceMock as any,
      ibcTreePendingUpdatesServiceMock as any,
      ibcTreeCacheServiceMock as any,
      historyServiceMock as any,
    );
  });

  it('fails hard when history-backed confirmation polling times out', async () => {
    await expect((service as any).waitForIndexedConfirmation('tx-timeout', 0)).rejects.toThrow(
      'history indexing timeout',
    );
  });

  it('does not finalize denom traces if on-chain root verification fails', async () => {
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'expected-root',
      commit: jest.fn(),
    });
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockRejectedValueOnce(new Error('hoststate unavailable'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999)).rejects.toThrow();
  });

  it('does not return submit success when confirmation status is unknown', async () => {
    jest.spyOn(service as any, 'submitToCardano').mockResolvedValueOnce('tx-hash-abc');
    jest.spyOn(service as any, 'waitForIndexedConfirmation').mockRejectedValueOnce(new Error('not indexed'));

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
      } as any),
    ).rejects.toThrow();
  });

  it('persists confirmed IBC tree snapshots by current id, root, and block height', async () => {
    const commit = jest.fn();
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'ab'.repeat(32),
      commit,
    });
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockResolvedValueOnce('ab'.repeat(32));

    await (service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc', 9999);

    expect(commit).toHaveBeenCalled();
    expect(ibcTreeCacheServiceMock.saveAliases).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['current', `root:${'ab'.repeat(32)}`, 'height:9999']),
    );
  });
});
