import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcInternalException, GrpcInvalidArgumentException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { DbSyncService } from '../services/db-sync.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';

describe('QueryService denom trace queries', () => {
  let service: QueryService;
  let denomTraceServiceMock: {
    findByHash: jest.Mock;
    findAll: jest.Mock;
    getCount: jest.Mock;
  };

  beforeEach(() => {
    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    const configServiceMock = {
      get: jest.fn(),
    } as unknown as ConfigService;

    denomTraceServiceMock = {
      findByHash: jest.fn(),
      findAll: jest.fn(),
      getCount: jest.fn(),
    };

    service = new QueryService(
      loggerMock,
      configServiceMock,
      {} as LucidService,
      {} as KupoService,
      {} as DbSyncService,
      {} as MiniProtocalsService,
      {} as MithrilService,
      denomTraceServiceMock as unknown as DenomTraceService,
    );
  });

  it('rejects queryDenomTrace when hash is missing', async () => {
    await expect(service.queryDenomTrace({ hash: '' } as any)).rejects.toThrow(GrpcInvalidArgumentException);
  });

  it('returns not found when denom trace hash does not exist', async () => {
    denomTraceServiceMock.findByHash.mockResolvedValue(null);

    await expect(service.queryDenomTrace({ hash: 'abcd' } as any)).rejects.toThrow(GrpcNotFoundException);
  });

  it('returns denom trace for a known hash', async () => {
    denomTraceServiceMock.findByHash.mockResolvedValue({
      path: 'transfer/channel-0',
      base_denom: 'stake',
    });

    const response = await service.queryDenomTrace({ hash: 'abcd' } as any);

    expect(response).toEqual({
      denom_trace: {
        path: 'transfer/channel-0',
        base_denom: 'stake',
      },
    });
  });

  it('returns denom traces and total count for pagination', async () => {
    denomTraceServiceMock.findAll.mockResolvedValue([
      { path: 'transfer/channel-0', base_denom: 'stake' },
      { path: 'transfer/channel-1', base_denom: 'token' },
    ]);
    denomTraceServiceMock.getCount.mockResolvedValue(42);

    const response = await service.queryDenomTraces({ pagination: { offset: 5n } } as any);

    expect(denomTraceServiceMock.findAll).toHaveBeenCalledWith({ offset: 5 });
    expect(response.denom_traces).toEqual([
      { path: 'transfer/channel-0', base_denom: 'stake' },
      { path: 'transfer/channel-1', base_denom: 'token' },
    ]);
    expect(response.pagination?.total).toBe(42n);
  });

  it('wraps unexpected queryDenomTraces errors as internal errors', async () => {
    denomTraceServiceMock.findAll.mockRejectedValue(new Error('db down'));

    await expect(service.queryDenomTraces({} as any)).rejects.toThrow(GrpcInternalException);
  });
});
