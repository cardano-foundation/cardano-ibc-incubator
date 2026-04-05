import { SubmissionService } from '../submission.service';

describe('SubmissionService pending update strictness', () => {
  let service: SubmissionService;
  let lucidServiceMock: {
    LucidImporter: Record<string, unknown>;
    decodeDatum: jest.Mock;
  };
  let configServiceMock: {
    get: jest.Mock;
  };
  let ibcTreePendingUpdatesServiceMock: {
    take: jest.Mock;
    takeByExpectedRoot: jest.Mock;
  };

  beforeEach(() => {
    ibcTreePendingUpdatesServiceMock = {
      take: jest.fn().mockReturnValue(undefined),
      takeByExpectedRoot: jest.fn().mockReturnValue(undefined),
    };

    lucidServiceMock = {
      LucidImporter: {},
      decodeDatum: jest.fn().mockResolvedValue({ state: { ibc_state_root: 'root-at-tx' } }),
    };

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
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
    const txEventsServiceMock = {};
    const ibcTreeCacheServiceMock = {};

    service = new SubmissionService(
      lucidServiceMock as any,
      configServiceMock as any,
      txEventsServiceMock as any,
      ibcTreePendingUpdatesServiceMock as any,
      ibcTreeCacheServiceMock as any,
    );
  });

  it('fails hard when confirmed tx has no pending update entry', async () => {
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockResolvedValueOnce('root-at-tx');

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'abc123')).rejects.toThrow();

    expect(ibcTreePendingUpdatesServiceMock.take).toHaveBeenCalledWith('abc123');
    expect(ibcTreePendingUpdatesServiceMock.takeByExpectedRoot).toHaveBeenCalledWith('root-at-tx');
  });

  it('fails hard on confirmed tx root lookup error instead of falling back to current HostState', async () => {
    // Simulate a real pending update that would otherwise be eligible to commit.
    ibcTreePendingUpdatesServiceMock.take.mockReturnValueOnce({
      expectedNewRoot: 'fallback-root',
      commit: jest.fn(),
    });
    jest.spyOn(service as any, 'readConfirmedTxRoot').mockRejectedValueOnce(new Error('tx root decode error'));

    await expect((service as any).applyPendingIbcTreeUpdate('deadbeef', 'tx-hash-abc')).rejects.toThrow(
      'tx root decode error',
    );
  });
});
