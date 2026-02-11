import { SubmissionService } from '../submission.service';

describe('SubmissionService pending update strictness', () => {
  let service: SubmissionService;
  let ibcTreePendingUpdatesServiceMock: {
    take: jest.Mock;
  };
  let denomTraceServiceMock: {
    setTxHashForTraces: jest.Mock;
  };

  beforeEach(() => {
    ibcTreePendingUpdatesServiceMock = {
      take: jest.fn().mockReturnValue(undefined),
    };

    denomTraceServiceMock = {
      setTxHashForTraces: jest.fn(),
    };

    const lucidServiceMock = {
      LucidImporter: {},
    };

    const dbSyncServiceMock = {};
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
    expect(denomTraceServiceMock.setTxHashForTraces).not.toHaveBeenCalled();
  });
});
