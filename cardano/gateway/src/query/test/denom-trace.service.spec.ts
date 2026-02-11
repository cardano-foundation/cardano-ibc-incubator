import { Logger } from '@nestjs/common';
import { DenomTraceService } from '../services/denom-trace.service';

describe('DenomTraceService', () => {
  let service: DenomTraceService;
  let repositoryMock: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let queryBuilderMock: {
    orderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    getMany: jest.Mock;
  };

  beforeEach(() => {
    queryBuilderMock = {
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };

    repositoryMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
    };

    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    const metricsMock = {
      denomTraceSavesTotal: { inc: jest.fn() },
      denomTraceSaveErrorsTotal: { inc: jest.fn() },
      denomTraceQueryDuration: { observe: jest.fn() },
    };

    service = new DenomTraceService(loggerMock, repositoryMock as any, metricsMock as any);
  });

  it('saves a new trace when hash does not already exist', async () => {
    repositoryMock.findOne.mockResolvedValue(null);
    repositoryMock.create.mockImplementation((value: unknown) => value);
    repositoryMock.save.mockImplementation(async (value: unknown) => value);

    const trace = {
      hash: 'h1',
      path: 'transfer/channel-0',
      base_denom: 'stake',
      voucher_policy_id: 'policy',
      tx_hash: 'tx1',
    };
    const saved = await service.saveDenomTrace(trace);

    expect(repositoryMock.findOne).toHaveBeenCalledWith({ where: { hash: 'h1' } });
    expect(repositoryMock.save).toHaveBeenCalled();
    expect(saved).toEqual(trace);
  });

  it('returns existing trace for duplicate hash and does not save again', async () => {
    const existing = {
      hash: 'h1',
      path: 'transfer/channel-0',
      base_denom: 'stake',
      voucher_policy_id: 'policy',
    };
    repositoryMock.findOne.mockResolvedValue(existing);

    const result = await service.saveDenomTrace({ hash: 'h1' });

    expect(result).toBe(existing);
    expect(repositoryMock.save).not.toHaveBeenCalled();
  });

  it('applies pagination offset in findAll', async () => {
    queryBuilderMock.getMany.mockResolvedValue([{ hash: 'h1' }]);

    const result = await service.findAll({ offset: 10 } as any);

    expect(repositoryMock.createQueryBuilder).toHaveBeenCalledWith('denom_trace');
    expect(queryBuilderMock.orderBy).toHaveBeenCalledWith('denom_trace.first_seen', 'DESC');
    expect(queryBuilderMock.offset).toHaveBeenCalledWith(10);
    expect(queryBuilderMock.limit).toHaveBeenCalledWith(100);
    expect(result).toEqual([{ hash: 'h1' }]);
  });

  it('returns count from repository', async () => {
    repositoryMock.count.mockResolvedValue(7);

    await expect(service.getCount()).resolves.toBe(7);
  });
});
