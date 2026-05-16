import { ConfigService } from '@nestjs/config';
import { TransferPlannerService } from './transfer-planner.service';
import { DenomTraceService } from '~@/query/services/denom-trace.service';
import { PlannerClientService } from './planner-client.service';

const LOCAL_OSMOSIS_REST_ENDPOINT = 'http://localosmosis:1318';
const CARDANO_REST_ENDPOINT = 'http://gateway:3000';

describe('TransferPlannerService', () => {
  let service: TransferPlannerService;
  let denomTraceServiceMock: {
    findByHash: jest.Mock;
  };

  beforeEach(() => {
    denomTraceServiceMock = {
      findByHash: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'cardanoChainId') return 'cardano-devnet';
        if (key === 'cardanoRestEndpoint') return CARDANO_REST_ENDPOINT;
        if (key === 'localOsmosisRestEndpoint') return LOCAL_OSMOSIS_REST_ENDPOINT;
        return undefined;
      }),
    } as unknown as ConfigService;

    const plannerClientService = new PlannerClientService(
      configService,
      denomTraceServiceMock as unknown as DenomTraceService,
    );
    service = new TransferPlannerService(plannerClientService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns a same-chain route without consulting a route chain', async () => {
    await expect(
      service.planTransferRoute({
        fromChainId: 'cardano-devnet',
        toChainId: 'cardano-devnet',
        tokenDenom: 'lovelace',
      }),
    ).resolves.toEqual({
      foundRoute: true,
      mode: 'same-chain',
      chains: ['cardano-devnet'],
      routes: [],
      tokenTrace: {
        kind: 'native',
        path: '',
        baseDenom: 'lovelace',
        fullDenom: 'lovelace',
      },
    });
  });

  it('fails closed for cross-chain routes until direct routes are implemented', async () => {
    await expect(
      service.planTransferRoute({
        fromChainId: 'cardano-devnet',
        toChainId: 'localosmosis',
        tokenDenom: 'lovelace',
      }),
    ).resolves.toMatchObject({
      foundRoute: false,
      mode: null,
      chains: ['cardano-devnet', 'localosmosis'],
      routes: [],
      tokenTrace: null,
      failureCode: 'direct-route-unsupported',
      routeDiagnostics: {
        expectedChainPath: ['cardano-devnet', 'localosmosis'],
        missingHops: [
          {
            fromChainId: 'cardano-devnet',
            toChainId: 'localosmosis',
            reason: 'no-channel-to-destination',
            availableDestChainIds: [],
          },
        ],
      },
    });
  });

  it('rejects incomplete route planning requests', async () => {
    await expect(
      service.planTransferRoute({
        fromChainId: 'cardano-devnet',
        toChainId: '',
        tokenDenom: 'lovelace',
      }),
    ).resolves.toMatchObject({
      foundRoute: false,
      mode: null,
      chains: [],
      routes: [],
      tokenTrace: null,
      failureCode: 'invalid-request',
    });
  });
});
