import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { queryCurrentEpochVerificationData } from '../../shared/helpers/ogmios';
import { YaciHistoryService } from '../services/yaci-history.service';

jest.mock('../../shared/helpers/ogmios', () => ({
  queryCurrentEpochVerificationData: jest.fn(),
}));

describe('YaciHistoryService', () => {
  let service: YaciHistoryService;
  let configServiceMock: { get: jest.Mock };
  let entityManagerMock: { query: jest.Mock };

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ogmiosEndpoint') {
          return 'ws://ogmios.local';
        }
        if (key === 'cardanoEpochLength') {
          return 432000;
        }
        return undefined;
      }),
    };

    entityManagerMock = {
      query: jest.fn(),
    };

    service = new YaciHistoryService(
      configServiceMock as unknown as ConfigService,
      {} as any,
      entityManagerMock as unknown as EntityManager,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('sources epoch nonce and slots-per-kes-period from Ogmios local state', async () => {
    entityManagerMock.query.mockResolvedValueOnce([{ start_slot: '1000' }]).mockResolvedValueOnce([{ start_slot: '1200' }]);
    (queryCurrentEpochVerificationData as jest.Mock).mockResolvedValue({
      currentEpoch: 7,
      epochNonce: '11'.repeat(32),
      slotsPerKesPeriod: 129600,
    });

    await expect(service.findEpochVerificationContext(7)).resolves.toEqual({
      epochNonce: '11'.repeat(32),
      slotsPerKesPeriod: 129600,
      currentEpochStartSlot: 1000n,
      currentEpochEndSlotExclusive: 1200n,
    });

    expect(queryCurrentEpochVerificationData).toHaveBeenCalledWith('ws://ogmios.local');
  });

  it('fails closed for non-current epochs according to node local state', async () => {
    entityManagerMock.query.mockResolvedValueOnce([{ start_slot: '1000' }]).mockResolvedValueOnce([{ start_slot: '1200' }]);
    (queryCurrentEpochVerificationData as jest.Mock).mockResolvedValue({
      currentEpoch: 8,
      epochNonce: '22'.repeat(32),
      slotsPerKesPeriod: 129600,
    });

    await expect(service.findEpochVerificationContext(7)).resolves.toBeNull();
  });
});
