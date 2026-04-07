import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { PlannerClientService } from './planner-client.service';

describe('LocalOsmosisSwapPlannerService', () => {
  let service: LocalOsmosisSwapPlannerService;
  let plannerClientServiceMock: {
    getClient: jest.Mock;
  };
  let plannerClientMock: {
    getLocalOsmosisSwapOptions: jest.Mock;
    estimateLocalOsmosisSwap: jest.Mock;
  };

  beforeEach(() => {
    plannerClientMock = {
      getLocalOsmosisSwapOptions: jest.fn(),
      estimateLocalOsmosisSwap: jest.fn(),
    };
    plannerClientServiceMock = {
      getClient: jest.fn(() => plannerClientMock),
    };

    service = new LocalOsmosisSwapPlannerService(
      plannerClientServiceMock as unknown as PlannerClientService,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('delegates swap option loading to the shared planner client', async () => {
    plannerClientMock.getLocalOsmosisSwapOptions.mockResolvedValue({
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
    expect(plannerClientServiceMock.getClient).toHaveBeenCalledTimes(1);
    expect(plannerClientMock.getLocalOsmosisSwapOptions).toHaveBeenCalledWith();
  });

  it('delegates swap estimation to the shared planner client', async () => {
    plannerClientMock.estimateLocalOsmosisSwap.mockResolvedValue({
      message: '',
      tokenOutAmount: '80',
      tokenOutTransferBackAmount: '72',
      tokenSwapAmount: '90',
      outToken: 'uion',
      transferRoutes: ['transfer/channel-9', 'transfer/channel-1'],
      transferBackRoutes: ['transfer/channel-1', 'transfer/channel-9'],
      transferChains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
    });

    const request = {
      fromChainId: 'cardano-devnet',
      tokenInDenom: 'lovelace',
      tokenInAmount: '100',
      toChainId: 'localosmosis',
      tokenOutDenom: 'uosmo',
    };

    await expect(service.estimateSwap(request)).resolves.toEqual({
      message: '',
      tokenOutAmount: '80',
      tokenOutTransferBackAmount: '72',
      tokenSwapAmount: '90',
      outToken: 'uion',
      transferRoutes: ['transfer/channel-9', 'transfer/channel-1'],
      transferBackRoutes: ['transfer/channel-1', 'transfer/channel-9'],
      transferChains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
    });
    expect(plannerClientServiceMock.getClient).toHaveBeenCalledTimes(1);
    expect(plannerClientMock.estimateLocalOsmosisSwap).toHaveBeenCalledWith(
      request,
    );
  });
});
