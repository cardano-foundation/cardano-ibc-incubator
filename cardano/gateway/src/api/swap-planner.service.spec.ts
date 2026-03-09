import { ConfigService } from '@nestjs/config';
import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { LocalOsmosisSwapClientService } from './local-osmosis-swap-client.service';
import { TransferRouteResolverService } from './transfer-route-resolver.service';
import { SwapMetadata } from './local-osmosis-swap.types';

describe('LocalOsmosisSwapPlannerService', () => {
  let service: LocalOsmosisSwapPlannerService;
  let swapClientMock: {
    buildMetadata: jest.Mock;
    estimateSwapViaRest: jest.Mock;
  };
  let routeResolverMock: {
    resolveSwapCandidates: jest.Mock;
  };

  beforeEach(() => {
    swapClientMock = {
      buildMetadata: jest.fn(),
      estimateSwapViaRest: jest.fn(),
    };
    routeResolverMock = {
      resolveSwapCandidates: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'cardanoChainId') return 'cardano-devnet';
        if (key === 'swapRouterAddress') return 'osmo1router';
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new LocalOsmosisSwapPlannerService(
      configService,
      swapClientMock as unknown as LocalOsmosisSwapClientService,
      routeResolverMock as unknown as TransferRouteResolverService,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('builds swap options from unique pool output denoms', async () => {
    swapClientMock.buildMetadata.mockResolvedValue({
      allChannelMappings: {},
      availableChannelsMap: {},
      pfmFees: {},
      osmosisDenomTraces: {
        'ibc/ABC': {
          path: 'transfer/channel-1',
          baseDenom: 'uosmo',
        },
      },
      routeMap: [
        {
          route: [{ pool_id: '1', token_out_denom: 'ibc/ABC' }],
          inToken: 'assetA',
          outToken: 'ibc/ABC',
        },
        {
          route: [{ pool_id: '2', token_out_denom: 'ibc/ABC' }],
          inToken: 'assetB',
          outToken: 'ibc/ABC',
        },
      ],
    } satisfies SwapMetadata);

    await expect(service.getSwapOptions()).resolves.toEqual({
      from_chain_id: 'cardano-devnet',
      from_chain_name: 'Cardano',
      to_chain_id: 'localosmosis',
      to_chain_name: 'Local Osmosis',
      to_tokens: [
        {
          token_id: 'ibc/ABC',
          token_name: 'uosmo',
          token_logo: null,
        },
      ],
    });
  });

  it('orchestrates route resolution and swap estimation, returning the best candidate', async () => {
    swapClientMock.buildMetadata.mockResolvedValue({
      allChannelMappings: {},
      availableChannelsMap: {},
      pfmFees: {
        entrypoint: 100000000000000000n,
        localosmosis: 100000000000000000n,
      },
      osmosisDenomTraces: {},
      routeMap: [],
    } satisfies SwapMetadata);
    routeResolverMock.resolveSwapCandidates.mockResolvedValue([
      {
        route: [{ pool_id: '1', token_out_denom: 'uosmo' }],
        outToken: 'uosmo',
        transferRoutes: ['transfer/channel-9', 'transfer/channel-1'],
        transferBackRoutes: ['transfer/channel-1', 'transfer/channel-9'],
        transferChains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
      },
      {
        route: [{ pool_id: '2', token_out_denom: 'uion' }],
        outToken: 'uion',
        transferRoutes: ['transfer/channel-9', 'transfer/channel-1'],
        transferBackRoutes: ['transfer/channel-1', 'transfer/channel-9'],
        transferChains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
      },
    ]);
    swapClientMock.estimateSwapViaRest
      .mockResolvedValueOnce({
        message: '',
        tokenOutAmount: 50n,
        tokenSwapAmount: 90n,
      })
      .mockResolvedValueOnce({
        message: '',
        tokenOutAmount: 80n,
        tokenSwapAmount: 90n,
      });

    await expect(
      service.estimateSwap({
        fromChainId: 'cardano-devnet',
        tokenInDenom: 'lovelace',
        tokenInAmount: '100',
        toChainId: 'localosmosis',
        tokenOutDenom: 'uosmo',
      }),
    ).resolves.toEqual({
      message: '',
      tokenOutAmount: '80',
      tokenOutTransferBackAmount: '72',
      tokenSwapAmount: '90',
      outToken: 'uion',
      transferRoutes: ['transfer/channel-9', 'transfer/channel-1'],
      transferBackRoutes: ['transfer/channel-1', 'transfer/channel-9'],
      transferChains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
    });
  });
});
