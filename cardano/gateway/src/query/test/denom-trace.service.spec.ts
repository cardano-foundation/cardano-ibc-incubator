import { Logger } from '@nestjs/common';
import { DenomTraceService } from '../services/denom-trace.service';
import { convertString2Hex, hashSHA256 } from '../../shared/helpers/hex';

describe('DenomTraceService', () => {
  let service: DenomTraceService;
  let repositoryMock: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    find: jest.Mock;
    query: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let queryBuilderMock: {
    select: jest.Mock;
    addSelect: jest.Mock;
    orderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    getMany: jest.Mock;
    getRawMany: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(() => {
    queryBuilderMock = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getRawMany: jest.fn(),
      execute: jest.fn(),
    };

    repositoryMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      find: jest.fn(),
      query: jest.fn(),
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
    const ibcDenomHash = hashSHA256(convertString2Hex('transfer/channel-0/stake'));

    expect(repositoryMock.findOne).toHaveBeenCalledWith({ where: { hash: 'h1' } });
    expect(repositoryMock.save).toHaveBeenCalled();
    expect(saved).toEqual({
      ...trace,
      ibc_denom_hash: ibcDenomHash,
    });
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

  it('fails hard when duplicate hash maps to conflicting canonical denom trace data', async () => {
    const existing = {
      hash: 'h1',
      path: 'transfer/channel-0',
      base_denom: 'stake',
      voucher_policy_id: 'policy-a',
    };
    repositoryMock.findOne.mockResolvedValue(existing);

    await expect(
      service.saveDenomTrace({
        hash: 'h1',
        path: 'transfer/channel-9',
        base_denom: 'uatom',
        voucher_policy_id: 'policy-b',
      }),
    ).rejects.toThrow('Conflicting denom trace for hash');

    expect(repositoryMock.save).not.toHaveBeenCalled();
  });

  it('fails hard when caller-supplied ibc_denom_hash conflicts with canonical path/base_denom', async () => {
    repositoryMock.findOne.mockResolvedValue(null);

    await expect(
      service.saveDenomTrace({
        hash: 'h2',
        path: 'transfer/channel-0',
        base_denom: 'stake',
        voucher_policy_id: 'policy',
        ibc_denom_hash: 'deadbeef',
      } as any),
    ).rejects.toThrow('Conflicting ibc_denom_hash');

    expect(repositoryMock.create).not.toHaveBeenCalled();
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

  it('resolves traces by indexed ibc denom hash', async () => {
    const target = { path: 'transfer/channel-7', base_denom: 'uatom' };
    const denomHash = hashSHA256(convertString2Hex('transfer/channel-7/uatom'));

    repositoryMock.findOne.mockResolvedValue(target);

    const result = await service.findByIbcDenomHash(denomHash.toUpperCase());

    expect(result).toEqual(target);
    expect(repositoryMock.findOne).toHaveBeenCalledWith({
      where: { ibc_denom_hash: denomHash.toLowerCase() },
      order: { first_seen: 'DESC' },
    });
  });

  it('backfills missing ibc denom hashes in batches', async () => {
    const row = { hash: 'trace-hash', path: 'transfer/channel-9', base_denom: 'uosmo' };
    const expectedIbcHash = hashSHA256(convertString2Hex('transfer/channel-9/uosmo'));

    queryBuilderMock.getRawMany
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([]);
    repositoryMock.query.mockResolvedValue(undefined);

    const updated = await service.backfillMissingIbcDenomHashes(1);

    expect(updated).toBe(1);
    expect(repositoryMock.query).toHaveBeenCalledTimes(1);
    expect(repositoryMock.query.mock.calls[0][0]).toContain('UPDATE denom_traces AS dt');
    expect(repositoryMock.query.mock.calls[0][1]).toEqual([row.hash, expectedIbcHash]);
  });

  it('updates tx_hash for traces after confirmation', async () => {
    queryBuilderMock.execute.mockResolvedValue({ affected: 2 });

    const updated = await service.setTxHashForTraces(['aa', 'bb'], 'tx123');

    expect(queryBuilderMock.update).toHaveBeenCalled();
    expect(queryBuilderMock.set).toHaveBeenCalledWith({ tx_hash: 'tx123' });
    expect(queryBuilderMock.where).toHaveBeenCalled();
    expect(updated).toBe(2);
  });

  it('ensures schema and runs backfill on module init', async () => {
    queryBuilderMock.getRawMany.mockResolvedValue([]);
    repositoryMock.query.mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(repositoryMock.query).toHaveBeenCalledTimes(3);
    expect(repositoryMock.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS denom_traces');
    expect(repositoryMock.query.mock.calls[1][0]).toContain('ADD COLUMN IF NOT EXISTS ibc_denom_hash');
    expect(repositoryMock.query.mock.calls[2][0]).toContain('CREATE INDEX IF NOT EXISTS idx_denom_traces_ibc_denom_hash');
  });
});
