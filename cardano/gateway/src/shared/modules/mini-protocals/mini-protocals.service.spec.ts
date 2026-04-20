import { Logger } from '@nestjs/common';
import { MiniProtocalsService } from './mini-protocals.service';

describe('MiniProtocalsService', () => {
  let historyServiceMock: {
    findBlockCborByHash: jest.Mock;
    findTransactionEvidenceByHash: jest.Mock;
  };
  let loggerMock: {
    warn: jest.Mock;
    error: jest.Mock;
  };
  let service: MiniProtocalsService;

  beforeEach(() => {
    historyServiceMock = {
      findBlockCborByHash: jest.fn(),
      findTransactionEvidenceByHash: jest.fn(),
    };
    loggerMock = {
      warn: jest.fn(),
      error: jest.fn(),
    };

    service = new MiniProtocalsService(historyServiceMock as any, loggerMock as unknown as Logger);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('loads block witnesses from bridge history', async () => {
    const blockCbor = Buffer.from('deadbeef', 'hex');
    historyServiceMock.findBlockCborByHash.mockResolvedValueOnce(blockCbor);

    await expect(
      service.fetchBlockCbor({
        hash: 'ab'.repeat(32),
        slotNo: 123n,
      }),
    ).resolves.toEqual(blockCbor);

    expect(historyServiceMock.findBlockCborByHash).toHaveBeenCalledWith('ab'.repeat(32));
  });

  it('fails when bridge history does not have block witness CBOR', async () => {
    historyServiceMock.findBlockCborByHash.mockResolvedValue(null);

    await expect(
      service.fetchBlockCbor({
        hash: 'cd'.repeat(32),
        slotNo: 456n,
      }),
    ).rejects.toThrow('Bridge history block CBOR unavailable');
  });
});
