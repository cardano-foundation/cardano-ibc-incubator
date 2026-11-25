import { createTestTreeStore } from '../../shared/testing/ibc-tree-test-store';
import { status } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import {
  QueryChannelsRequest,
  QueryConnectionChannelsRequest,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/query';
import { GATEWAY_GRPC_ERROR_CODE, GrpcUnavailableException } from '../../exception/grpc_exceptions';
import { ChannelService } from '../services/channel.service';
import { decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { resolveProofHeightForCurrentRoot } from '../services/proof-context';

jest.mock('../../shared/types/channel/channel-datum', () => ({
  decodeChannelDatum: jest.fn(),
}));

jest.mock('../../shared/helpers/channel', () => ({
  getChannelIdByTokenName: jest.fn((tokenName: string) => (tokenName === 'channel-token-name-2' ? '2' : '8')),
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
    (resolveProofHeightForCurrentRoot as jest.Mock).mockResolvedValue(4_992_646n);
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
      createTestTreeStore(),
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
    expect(response.pagination?.total).toBe(1n);
  });

  it('applies offsets to channel listings that fit within the limit', async () => {
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      { datum: 'channel-datum', matchedTokenNames: ['channel-token-name'] },
      { datum: 'channel-datum', matchedTokenNames: ['channel-token-name-2'] },
    ]);
    const page = (offset: number) =>
      QueryChannelsRequest.fromJSON({ pagination: { offset, limit: 100, count_total: true } }).pagination;
    const service = createService();

    const channels = await service.listCurrentChannelEnds({ pagination: page(1) });
    expect(channels.channels.map((channel) => channel.channel_id)).toEqual(['channel-8']);
    expect(channels.pagination).toEqual({ next_key: new Uint8Array(), total: 2n });
    expect((await service.listCurrentChannelEnds({ pagination: page(999) })).channels).toEqual([]);

    const connectionChannels = await service.queryConnectionChannels({
      connection: 'connection-9',
      pagination: page(1),
    });
    expect(connectionChannels.channels.map((channel) => channel.channel_id)).toEqual(['channel-8']);
    expect(connectionChannels.height.revision_height).toBe(4_992_646n);
    expect(
      (await service.queryConnectionChannels({ connection: 'connection-9', pagination: page(999) })).channels,
    ).toEqual([]);
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

  it.each([
    ['the height lookup fails', () => Promise.reject(new Error('history service offline')), 'history service offline'],
    ['the height lookup resolves zero', () => Promise.resolve(0n), 'resolved height 0'],
  ])('rejects channel listings as unavailable when %s', async (_description, resolveHeight, cause) => {
    (resolveProofHeightForCurrentRoot as jest.Mock).mockImplementation(resolveHeight);
    const service = createService();
    const connectionChannelsRequest = QueryConnectionChannelsRequest.fromJSON({
      connection: 'connection-9',
      pagination: request.pagination,
    });

    await expectQueryHeightUnavailable(service.queryChannels(request), cause);
    await expectQueryHeightUnavailable(service.queryConnectionChannels(connectionChannelsRequest), cause);
  });
});

async function expectQueryHeightUnavailable(promise: Promise<unknown>, cause: string) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GrpcUnavailableException);
  const payload = (error as GrpcUnavailableException).getError() as { code: number; message: string };
  expect(payload.code).toBe(status.UNAVAILABLE);
  expect(payload.message).toContain(GATEWAY_GRPC_ERROR_CODE.QUERY_HEIGHT_UNAVAILABLE);
  expect(payload.message).toContain(cause);
}
