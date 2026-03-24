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
    save: jest.Mock;
  };
  let denomTraceServiceMock: {
    setTxHashForTraces: jest.Mock;
  };
  let submitTxMock: jest.Mock;

  beforeEach(() => {
    submitTxMock = jest.fn().mockResolvedValue('tx-hash-abc');
    lucidServiceMock = {
      LucidImporter: {},
      lucid: {
        wallet: jest.fn().mockReturnValue({
          submitTx: submitTxMock,
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
      save: jest.fn().mockResolvedValue(undefined),
    };

    denomTraceServiceMock = {
      setTxHashForTraces: jest.fn().mockResolvedValue(1),
    };

    service = new SubmissionService(
      lucidServiceMock as any,
      configServiceMock as any,
      txEventsServiceMock as any,
      ibcTreePendingUpdatesServiceMock as any,
      ibcTreeCacheServiceMock as any,
      denomTraceServiceMock as any,
    );
  });

  it('fails hard when confirmation polling times out', async () => {
    await expect((service as any).waitForConfirmation('tx-timeout', 0)).rejects.toThrow();
  });

  it('fails hard when exact Ogmios inclusion height lookup times out instead of falling back', async () => {
    await expect((service as any).waitForTxInclusionBlockHeight('tx-no-height', 'origin', 0)).rejects.toThrow();
  });

  it('does not finalize denom traces if on-chain root verification fails', async () => {
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'expected-root',
      commit: jest.fn(),
      denomTraceHashes: ['voucher-hash'],
    });
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockRejectedValueOnce(new Error('hoststate unavailable'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc')).rejects.toThrow();
    expect(denomTraceServiceMock.setTxHashForTraces).not.toHaveBeenCalled();
  });

  it('does not return submit success when confirmation status is unknown', async () => {
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'expected-root',
      commit: jest.fn(),
      denomTraceHashes: ['voucher-hash'],
    });
    jest.spyOn(service as any, 'capturePreSubmitPoint').mockResolvedValueOnce('origin');
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockResolvedValueOnce('expected-root');

    jest.spyOn(service as any, 'waitForConfirmation').mockResolvedValueOnce(undefined);
    jest.spyOn(service as any, 'waitForTxInclusionBlockHeight').mockResolvedValueOnce(9999);

    await expect(
      service.submitSignedTransaction({
        signed_tx_cbor: 'deadbeef',
      } as any),
    ).rejects.toThrow();
    expect(denomTraceServiceMock.setTxHashForTraces).not.toHaveBeenCalled();
  });

  it('retries transient unknown-input submission races before failing', async () => {
    const retryDelays: number[] = [];
    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((callback: (...args: any[]) => void, delay?: number) => {
      retryDelays.push(delay ?? 0);
      callback();
      return 0 as any;
    }) as any);

    submitTxMock
      .mockRejectedValueOnce(
        new Error(
          '{"jsonrpc":"2.0","method":"submitTransaction","error":{"code":3117,"message":"The transaction contains unknown UTxO references as inputs.","data":{"unknownOutputReferences":[{"transaction":{"id":"deadbeef"},"index":2}]}},"id":null}',
        ),
      )
      .mockResolvedValueOnce('tx-hash-after-retry');

    await expect((service as any).submitToCardano('deadbeef')).resolves.toBe('tx-hash-after-retry');
    expect(submitTxMock).toHaveBeenCalledTimes(2);
    expect(retryDelays).toContain(500);

    timeoutSpy.mockRestore();
  });
});
