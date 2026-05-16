import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { TransferPlannerService } from './transfer-planner.service';
import { DenomTraceService } from '~@/query/services/denom-trace.service';
import { PlannerClientService } from './planner-client.service';

type FetchJsonResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
};

const ENTRYPOINT_REST_ENDPOINT = 'http://entrypoint:1317';
const LOCAL_OSMOSIS_REST_ENDPOINT = 'http://localosmosis:1318';
const CARDANO_REST_ENDPOINT = 'http://gateway:3000';

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
        if (key === 'cardanoRestEndpoint') return CARDANO_REST_ENDPOINT;
        if (key === 'entrypointRestEndpoint') return ENTRYPOINT_REST_ENDPOINT;
        if (key === 'localOsmosisRestEndpoint') return LOCAL_OSMOSIS_REST_ENDPOINT;
        return undefined;
      }),
    } as unknown as ConfigService;

    const plannerClientService = new PlannerClientService(
      configService,
      denomTraceServiceMock as unknown as DenomTraceService,
    );
    service = new TransferPlannerService(plannerClientService);

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
      chains: ['cardano-devnet', 'cardano-entrypoint', 'localosmosis'],
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
      chains: ['localosmosis', 'cardano-entrypoint', 'cardano-devnet'],
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

  it('selects the latest live channel when multiple open channels exist for the same forward hop', async () => {
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
    ).resolves.toEqual({
      foundRoute: true,
      mode: 'native-forward',
      chains: ['cardano-devnet', 'cardano-entrypoint', 'localosmosis'],
      routes: ['transfer/channel-9', 'transfer/channel-2'],
      tokenTrace: {
        kind: 'native',
        path: '',
        baseDenom: 'lovelace',
        fullDenom: 'lovelace',
      },
    });
  });

  it('keeps the canonical route when the Cardano outbound channel has pending ordered packets', async () => {
    mockPlannerNetwork({
      entrypointChannels: [
        { channelId: 'channel-0', counterpartyChannelId: 'channel-9', destChainId: 'cardano-devnet' },
        { channelId: 'channel-1', counterpartyChannelId: 'channel-3', destChainId: 'localosmosis' },
      ],
      entrypointDenomTraces: [],
      localOsmosisDenomTraces: [],
      cardanoChannelHealth: {
        'transfer/channel-9': {
          port_id: 'transfer',
          channel_id: 'channel-9',
          status: 'blocked',
          reason: 'Ordered Cardano channel transfer/channel-9 has 1 pending packet commitment(s); earliest sequence 1 must be received, acknowledged, or timed out before later packets can progress.',
        },
      },
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
      chains: ['cardano-devnet', 'cardano-entrypoint', 'localosmosis'],
      routes: ['transfer/channel-9', 'transfer/channel-1'],
      tokenTrace: {
        kind: 'native',
        path: '',
        baseDenom: 'lovelace',
        fullDenom: 'lovelace',
      },
    });
  });

  const mockPlannerNetwork = ({
    entrypointChannels,
    entrypointDenomTraces,
    localOsmosisDenomTraces,
    cardanoChannels,
    cardanoChannelHealth = {},
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
    cardanoChannels?: ReturnType<typeof openChannel>[];
    cardanoChannelHealth?: Record<string, unknown>;
  }) => {
    const resolvedCardanoChannels =
      cardanoChannels ||
      entrypointChannels
        .filter((channel) => channel.destChainId === 'cardano-devnet')
        .map((channel) =>
          openChannel({
            channelId: channel.counterpartyChannelId,
            counterpartyChannelId: channel.channelId,
          }),
        );

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

      if (url === `${CARDANO_REST_ENDPOINT}/api/channels?offset=0&limit=10000&countTotal=true&reverse=false`) {
        return Promise.resolve(jsonResponse({
          channels: resolvedCardanoChannels,
          pagination: {},
        }));
      }

      for (const channel of resolvedCardanoChannels) {
        if (
          url ===
          `${CARDANO_REST_ENDPOINT}/api/cardano/channels/${channel.channel_id}/health?port_id=transfer`
        ) {
          return Promise.resolve(
            jsonResponse(
              cardanoChannelHealth[`transfer/${channel.channel_id}`] || {
                port_id: 'transfer',
                channel_id: channel.channel_id,
                status: 'available',
                reason: null,
              },
            ),
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
