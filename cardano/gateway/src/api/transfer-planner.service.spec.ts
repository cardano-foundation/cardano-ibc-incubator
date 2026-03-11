import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { TransferPlannerService } from './transfer-planner.service';
import { DenomTraceService } from '~@/query/services/denom-trace.service';

type FetchJsonResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
};

const ENTRYPOINT_REST_ENDPOINT = 'http://entrypoint:1317';
const LOCAL_OSMOSIS_REST_ENDPOINT = 'http://localosmosis:1318';

const ibcHash = (fullDenom: string) =>
  `ibc/${createHash('sha256').update(fullDenom).digest('hex').toUpperCase()}`;

const denom = (base: string, trace: Array<{ port_id: string; channel_id: string }> = []) => ({
  base,
  trace,
});

const openChannel = ({
  channelId,
  counterpartyChannelId,
}: {
  channelId: string;
  counterpartyChannelId: string;
}) => ({
  channel_id: channelId,
  port_id: 'transfer',
  state: 'STATE_OPEN',
  counterparty: {
    channel_id: counterpartyChannelId,
    port_id: 'transfer',
  },
});

describe('TransferPlannerService', () => {
  let service: TransferPlannerService;
  let denomTraceServiceMock: {
    findByHash: jest.Mock;
  };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    denomTraceServiceMock = {
      findByHash: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'cardanoChainId') return 'cardano-devnet';
        if (key === 'entrypointRestEndpoint') return ENTRYPOINT_REST_ENDPOINT;
        if (key === 'localOsmosisRestEndpoint') return LOCAL_OSMOSIS_REST_ENDPOINT;
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new TransferPlannerService(
      configService,
      denomTraceServiceMock as unknown as DenomTraceService,
      new Logger(),
    );

    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('plans the unique native forward route from Cardano to local Osmosis', async () => {
    mockPlannerNetwork({
      entrypointChannels: [
        { channelId: 'channel-0', counterpartyChannelId: 'channel-9', destChainId: 'cardano-devnet' },
        { channelId: 'channel-1', counterpartyChannelId: 'channel-3', destChainId: 'localosmosis' },
      ],
      entrypointDenomTraces: [],
      localOsmosisDenomTraces: [],
    });

    await expect(
      service.planTransferRoute({
        fromChainId: 'cardano-devnet',
        toChainId: 'localosmosis',
        tokenDenom: 'lovelace',
      }),
    ).resolves.toEqual({
      foundRoute: true,
      mode: 'native-forward',
      chains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
      routes: ['transfer/channel-9', 'transfer/channel-1'],
      tokenTrace: {
        kind: 'native',
        path: '',
        baseDenom: 'lovelace',
        fullDenom: 'lovelace',
      },
    });
  });

  it('chooses the exact unwind path for an ibc voucher instead of guessing', async () => {
    const fullDenom = 'transfer/channel-1/transfer/channel-9/lovelace';

    mockPlannerNetwork({
      entrypointChannels: [
        { channelId: 'channel-0', counterpartyChannelId: 'channel-9', destChainId: 'cardano-devnet' },
        { channelId: 'channel-1', counterpartyChannelId: 'channel-3', destChainId: 'localosmosis' },
      ],
      entrypointDenomTraces: [],
      localOsmosisDenomTraces: [
        denom('lovelace', [
          { port_id: 'transfer', channel_id: 'channel-1' },
          { port_id: 'transfer', channel_id: 'channel-9' },
        ]),
      ],
    });

    await expect(
      service.planTransferRoute({
        fromChainId: 'localosmosis',
        toChainId: 'cardano-devnet',
        tokenDenom: ibcHash(fullDenom),
      }),
    ).resolves.toEqual({
      foundRoute: true,
      mode: 'unwind',
      chains: ['localosmosis', 'entrypoint', 'cardano-devnet'],
      routes: ['transfer/channel-3', 'transfer/channel-0'],
      tokenTrace: {
        kind: 'ibc_voucher',
        path: 'transfer/channel-1/transfer/channel-9',
        baseDenom: 'lovelace',
        fullDenom,
      },
    });
  });

  it('fails when an unwrap-required hop is missing instead of re-wrapping', async () => {
    const fullDenom = 'transfer/channel-77/transfer/channel-9/lovelace';

    mockPlannerNetwork({
      entrypointChannels: [
        { channelId: 'channel-0', counterpartyChannelId: 'channel-9', destChainId: 'cardano-devnet' },
        { channelId: 'channel-1', counterpartyChannelId: 'channel-3', destChainId: 'localosmosis' },
      ],
      entrypointDenomTraces: [],
      localOsmosisDenomTraces: [
        denom('lovelace', [
          { port_id: 'transfer', channel_id: 'channel-77' },
          { port_id: 'transfer', channel_id: 'channel-9' },
        ]),
      ],
    });

    await expect(
      service.planTransferRoute({
        fromChainId: 'localosmosis',
        toChainId: 'cardano-devnet',
        tokenDenom: ibcHash(fullDenom),
      }),
    ).resolves.toMatchObject({
      foundRoute: false,
      mode: null,
      chains: ['localosmosis'],
      routes: [],
      failureCode: 'missing-unwind-hop',
    });
  });

  it('fails when multiple open channels exist for the same forward hop', async () => {
    mockPlannerNetwork({
      entrypointChannels: [
        { channelId: 'channel-0', counterpartyChannelId: 'channel-9', destChainId: 'cardano-devnet' },
        { channelId: 'channel-1', counterpartyChannelId: 'channel-3', destChainId: 'localosmosis' },
        { channelId: 'channel-2', counterpartyChannelId: 'channel-4', destChainId: 'localosmosis' },
      ],
      entrypointDenomTraces: [],
      localOsmosisDenomTraces: [],
    });

    await expect(
      service.planTransferRoute({
        fromChainId: 'cardano-devnet',
        toChainId: 'localosmosis',
        tokenDenom: 'lovelace',
      }),
    ).resolves.toMatchObject({
      foundRoute: false,
      mode: null,
      chains: ['cardano-devnet'],
      routes: [],
      failureCode: 'ambiguous-forward-hop',
    });
  });

  const mockPlannerNetwork = ({
    entrypointChannels,
    entrypointDenomTraces,
    localOsmosisDenomTraces,
  }: {
    entrypointChannels: Array<{
      channelId: string;
      counterpartyChannelId: string;
      destChainId: string;
    }>;
    entrypointDenomTraces: Array<{
      base: string;
      trace: Array<{ port_id: string; channel_id: string }>;
    }>;
    localOsmosisDenomTraces: Array<{
      base: string;
      trace: Array<{ port_id: string; channel_id: string }>;
    }>;
  }) => {
    fetchMock.mockImplementation((url: string): Promise<FetchJsonResponse> => {
      if (url === `${ENTRYPOINT_REST_ENDPOINT}/ibc/core/channel/v1/channels?pagination.count_total=true&pagination.limit=10000`) {
        return Promise.resolve(jsonResponse({
          channels: entrypointChannels.map(({ channelId, counterpartyChannelId }) =>
            openChannel({ channelId, counterpartyChannelId }),
          ),
          pagination: {},
        }));
      }

      for (const channel of entrypointChannels) {
        if (
          url ===
          `${ENTRYPOINT_REST_ENDPOINT}/ibc/core/channel/v1/channels/${channel.channelId}/ports/transfer/client_state`
        ) {
          return Promise.resolve(
            jsonResponse({
              identified_client_state: {
                client_state: {
                  chain_id: channel.destChainId,
                },
              },
            }),
          );
        }
      }

      if (
        url ===
        `${ENTRYPOINT_REST_ENDPOINT}/ibc/apps/transfer/v1/denoms?pagination.limit=10000`
      ) {
        return Promise.resolve(
          jsonResponse({
            denoms: entrypointDenomTraces,
            pagination: {},
          }),
        );
      }

      if (
        url ===
        `${LOCAL_OSMOSIS_REST_ENDPOINT}/ibc/apps/transfer/v1/denoms?pagination.limit=10000`
      ) {
        return Promise.resolve(
          jsonResponse({
            denoms: localOsmosisDenomTraces,
            pagination: {},
          }),
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });
  };

  const jsonResponse = (body: unknown): FetchJsonResponse => ({
    ok: true,
    json: async () => body,
  });
});
