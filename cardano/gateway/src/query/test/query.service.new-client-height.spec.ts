import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { DbSyncService } from '../services/db-sync.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';

describe('QueryService new client height strictness', () => {
  let service: QueryService;
  let mithrilServiceMock: {
    getMostRecentMithrilStakeDistributions: jest.Mock;
    getCardanoTransactionsSetSnapshot: jest.Mock;
    getCertificateByHash: jest.Mock;
  };

  beforeEach(() => {
    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    const configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'cardanoChainId') return 'cardano-devnet';
        if (key === 'deployment') {
          return {
            hostStateNFT: {
              policyId: 'a'.repeat(56),
              name: 'b'.repeat(64),
            },
          };
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    mithrilServiceMock = {
      getMostRecentMithrilStakeDistributions: jest.fn().mockResolvedValue([]),
      getCardanoTransactionsSetSnapshot: jest.fn().mockResolvedValue([
        {
          block_number: '100',
          certificate_hash: 'cert-100',
          hash: 'snapshot-hash-100',
          epoch: '1',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
      getCertificateByHash: jest.fn().mockRejectedValue(new Error('must not be called for unknown height')),
    };

    service = new QueryService(
      loggerMock,
      configServiceMock,
      {
        findUtxoAtHostStateNFT: jest.fn(),
        decodeDatum: jest.fn(),
      } as unknown as LucidService,
      {} as KupoService,
      {} as DbSyncService,
      {} as MiniProtocalsService,
      mithrilServiceMock as unknown as MithrilService,
      {} as DenomTraceService,
    );
  });

  it('fails hard when requested new-client height is missing, without falling back to latest snapshot', async () => {
    await expect(service.queryNewMithrilClient({ height: 999n } as any)).rejects.toThrow(GrpcNotFoundException);
    expect(mithrilServiceMock.getCertificateByHash).not.toHaveBeenCalled();
  });
});
