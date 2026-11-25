import { createPacketStateMock } from '../../shared/testing/packet-state-test-mock';
import { createTestTreeStore } from '../../shared/testing/ibc-tree-test-store';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GrpcInternalException,
  GrpcInvalidArgumentException,
  GrpcNotFoundException,
} from '~@/exception/grpc_exceptions';
import { DenomTraceService } from '../services/denom-trace.service';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { HistoryService } from '../services/history.service';

describe('QueryService denom trace queries', () => {
  let service: QueryService;
  let denomTraceServiceMock: {
    findByIbcDenomHash: jest.Mock;
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
      findByIbcDenomHash: jest.fn(),
      findAll: jest.fn(),
      getCount: jest.fn(),
    };

    service = new QueryService(
      loggerMock,
      configServiceMock,
      {} as LucidService,
      {} as KupoService,
      {} as HistoryService,
      {} as MiniProtocalsService,
      denomTraceServiceMock as unknown as DenomTraceService,
      {} as any,
      createTestTreeStore(),
      createPacketStateMock() as any,
    );
  });

  it('rejects queryDenom when hash is missing', async () => {
    await expect(service.queryDenom({ hash: '' } as any)).rejects.toThrow(GrpcInvalidArgumentException);
  });

  it('rejects queryDenom when hash is not a 64-character hex value', async () => {
    await expect(service.queryDenom({ hash: 'abcd' } as any)).rejects.toThrow(GrpcInvalidArgumentException);
    expect(denomTraceServiceMock.findByIbcDenomHash).not.toHaveBeenCalled();
  });

  it('normalizes ibc/<hash> input and returns not found when denom does not exist', async () => {
    const upperHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    denomTraceServiceMock.findByIbcDenomHash.mockResolvedValue(null);

    await expect(service.queryDenom({ hash: `ibc/${upperHash}` } as any)).rejects.toThrow(GrpcNotFoundException);
    expect(denomTraceServiceMock.findByIbcDenomHash).toHaveBeenCalledWith(upperHash.toLowerCase());
  });

  it('returns denom for raw 64-character hash input', async () => {
    const mixedCaseHash = 'AaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
    denomTraceServiceMock.findByIbcDenomHash.mockResolvedValue({
      path: 'transfer/channel-0',
      base_denom: 'stake',
    });

    const response = await service.queryDenom({ hash: mixedCaseHash } as any);

    expect(response).toEqual({
      denom: {
        base: 'stake',
        trace: [{ port_id: 'transfer', channel_id: 'channel-0' }],
      },
    });
    expect(denomTraceServiceMock.findByIbcDenomHash).toHaveBeenCalledWith(mixedCaseHash.toLowerCase());
  });

  it('returns denoms with the page continuation key and total count', async () => {
    denomTraceServiceMock.findAll.mockResolvedValue({
      traces: [
        { path: 'transfer/channel-0', base_denom: 'stake' },
        { path: 'transfer/channel-1', base_denom: 'token' },
      ],
      pagination: { next_key: Buffer.from('next'), total: 42n },
    });
    const pagination = { key: new Uint8Array(), offset: 5n, limit: 2n, count_total: false, reverse: true };

    const response = await service.queryDenoms({ pagination } as any);

    expect(denomTraceServiceMock.findAll).toHaveBeenCalledWith({ ...pagination, count_total: true });
    expect(denomTraceServiceMock.getCount).not.toHaveBeenCalled();
    expect(response.denoms).toEqual([
      { base: 'stake', trace: [{ port_id: 'transfer', channel_id: 'channel-0' }] },
      { base: 'token', trace: [{ port_id: 'transfer', channel_id: 'channel-1' }] },
    ]);
    expect(response.pagination).toEqual({ next_key: Buffer.from('next'), total: 42n });
  });

  it('keeps invalid queryDenoms pagination as an invalid argument', async () => {
    denomTraceServiceMock.findAll.mockRejectedValue(new GrpcInvalidArgumentException('malformed pagination key'));

    await expect(service.queryDenoms({} as any)).rejects.toThrow(GrpcInvalidArgumentException);
  });

  it('wraps unexpected queryDenoms errors as internal errors', async () => {
    denomTraceServiceMock.findAll.mockRejectedValue(new Error('db down'));

    await expect(service.queryDenoms({} as any)).rejects.toThrow(GrpcInternalException);
  });
});
