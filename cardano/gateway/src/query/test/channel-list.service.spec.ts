import { Logger } from '@nestjs/common';
import { QueryChannelsRequest } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/query';
import { ChannelService } from '../services/channel.service';
import { decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { resolveProofHeightForCurrentRoot } from '../services/proof-context';

jest.mock('../../shared/types/channel/channel-datum', () => ({
  decodeChannelDatum: jest.fn(),
}));

jest.mock('../../shared/helpers/channel', () => ({
  getChannelIdByTokenName: jest.fn(() => '8'),
}));

jest.mock('../services/proof-context', () => ({
  resolveProofContextForQuery: jest.fn(),
  resolveProofHeightForCurrentRoot: jest.fn(),
}));

const toHex = (value: string) => Buffer.from(value, 'utf8').toString('hex');

describe('ChannelService channel listings', () => {
  const request = QueryChannelsRequest.fromJSON({
    pagination: {
      key: '',
      offset: 0,
      limit: 50,
      count_total: true,
      reverse: false,
    },
  });

  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'deployment') {
        return {
          hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
          validators: {
            mintChannelStt: { scriptHash: 'channel-policy' },
            spendChannel: { address: 'addr_test1channel' },
          },
        };
      }
      if (key === 'cardanoLightClientMode') {
        return 'stake-weighted-stability';
      }
      return undefined;
    }),
  };
  const lucidService = {
    LucidImporter: {},
    generateTokenName: jest.fn(() => 'channel-token-prefix'),
  };
  const kupoService = {
    queryUtxosAtAddressByPolicyAndTokenPrefix: jest.fn().mockResolvedValue([
      {
        datum: 'channel-datum',
        matchedTokenNames: ['channel-token-name'],
      },
    ]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      {
        datum: 'channel-datum',
        matchedTokenNames: ['channel-token-name'],
      },
    ]);
    (decodeChannelDatum as jest.Mock).mockResolvedValue({
      port: toHex('transfer'),
      state: {
        channel: {
          state: 'Open',
          ordering: 'Unordered',
          counterparty: {
            port_id: toHex('transfer'),
            channel_id: toHex('channel-77133'),
          },
          connection_hops: [toHex('connection-9')],
          version: toHex('ics20-1'),
        },
      },
    });
  });

  function createService() {
    return new ChannelService(
      logger,
      configService as any,
      lucidService as any,
      kupoService as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('lists current channel ends without resolving a proof height', async () => {
    (resolveProofHeightForCurrentRoot as jest.Mock).mockRejectedValue(new Error('proof height should not be queried'));

    const response = await createService().listCurrentChannelEnds(request);

    expect(resolveProofHeightForCurrentRoot).not.toHaveBeenCalled();
    expect(kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix).toHaveBeenCalledWith(
      'addr_test1channel',
      'channel-policy',
      'channel-token-prefix'.slice(0, 48),
    );
    expect(response.channels).toEqual([
      expect.objectContaining({
        state: 3,
        ordering: 1,
        port_id: 'transfer',
        channel_id: 'channel-8',
        counterparty: {
          port_id: 'transfer',
          channel_id: 'channel-77133',
        },
      }),
    ]);
    expect(response.pagination?.total).toBe(1);
  });

  it('keeps the proof height on the existing IBC channel query', async () => {
    (resolveProofHeightForCurrentRoot as jest.Mock).mockResolvedValue(4992646n);

    const service = createService();
    const lightweight = await service.listCurrentChannelEnds(request);
    const response = await service.queryChannels(request);

    expect(resolveProofHeightForCurrentRoot).toHaveBeenCalledTimes(1);
    expect(response.channels).toEqual(lightweight.channels);
    expect(response.pagination).toEqual(lightweight.pagination);
    expect(response.height.revision_number).toBe(0n);
    expect(response.height.revision_height).toBe(4992646n);
  });
});
