import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { BridgeHistoryService } from '../services/bridge-history.service';

describe('BridgeHistoryService', () => {
  let service: BridgeHistoryService;
  let configServiceMock: { get: jest.Mock };
  let lucidServiceMock: { generateTokenName: jest.Mock };
  let entityManagerMock: { query: jest.Mock };

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'deployment') {
          return {
            hostStateNFT: {
              policyId: 'aa'.repeat(28),
              name: 'hoststate',
            },
            handlerAuthToken: {
              policyId: 'bb'.repeat(28),
            },
            validators: {
              mintClientStt: {
                scriptHash: 'cc'.repeat(28),
              },
            },
          };
        }
        return undefined;
      }),
    };
    lucidServiceMock = {
      generateTokenName: jest.fn().mockReturnValue('abcd1234clienttokenname'),
    };
    entityManagerMock = {
      query: jest.fn(),
    };

    service = new BridgeHistoryService(
      configServiceMock as unknown as ConfigService,
      lucidServiceMock as any,
      entityManagerMock as unknown as EntityManager,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('maps persisted epoch context from bridge-owned history tables', async () => {
    entityManagerMock.query.mockResolvedValueOnce([
      {
        epoch_no: '7',
        current_epoch_start_slot: '1000',
        current_epoch_end_slot_exclusive: '1200',
        epoch_nonce: '0x' + '11'.repeat(32),
        slots_per_kes_period: '129600',
        stake_distribution_json: [
          {
            poolId: 'pool1bridgepool',
            stake: '900',
            vrfKeyHash: '0x' + 'aa'.repeat(32),
          },
        ],
      },
    ]);

    await expect(
      service.findEpochContextAtBlock({
        height: 100,
        hash: 'ab'.repeat(32),
        prevHash: 'cd'.repeat(32),
        slotNo: 1100n,
        epochNo: 7,
        timestampUnixNs: 1_000_000_000n,
        slotLeader: 'pool1bridgepool',
      }),
    ).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1bridgepool',
          stake: 900n,
          vrfKeyHash: 'aa'.repeat(32),
        },
      ],
      verificationContext: {
        epochNonce: '11'.repeat(32),
        slotsPerKesPeriod: 129600,
        currentEpochStartSlot: 1000n,
        currentEpochEndSlotExclusive: 1200n,
      },
    });

    expect(entityManagerMock.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM bridge_epoch_context'),
      [7],
    );
  });

  it('reads block witness CBOR from bridge_block_history', async () => {
    const expected = Buffer.from('deadbeef', 'hex');
    entityManagerMock.query.mockResolvedValueOnce([{ block_cbor: expected }]);

    await expect(service.findBlockCborByHash('ABCD')).resolves.toEqual(expected);

    expect(entityManagerMock.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM bridge_block_history'),
      ['abcd'],
    );
  });
});
