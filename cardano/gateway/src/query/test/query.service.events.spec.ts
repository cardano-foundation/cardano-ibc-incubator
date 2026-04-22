import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { HistoryService } from '../services/history.service';

describe('QueryService queryEvents', () => {
  it('uses raw history tip in stake-weighted stability mode instead of accepted stability height', async () => {
    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    const configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'cardanoLightClientMode') return 'stake-weighted-stability';
        return undefined;
      }),
    } as unknown as ConfigService;

    const historyServiceMock = {
      findLatestBlock: jest.fn().mockResolvedValue({
        height: 7,
      }),
    } as unknown as HistoryService;

    const service = new QueryService(
      loggerMock,
      configServiceMock,
      {} as LucidService,
      {} as KupoService,
      historyServiceMock,
      {} as MiniProtocalsService,
      {} as MithrilService,
      {} as DenomTraceService,
    );

    const latestHeightSpy = jest
      .spyOn(service, 'latestHeight')
      .mockRejectedValue(new Error('queryEvents must not depend on accepted stability height'));

    const queryBlockResultsSpy = jest
      .spyOn(service, 'queryBlockResults')
      .mockImplementation(async ({ height }: any) => ({
        block_results: {
          txs_results: height === 6n ? [{ type: 'create_client' }] : [],
        },
      }) as any);

    await expect(service.queryEvents({ since_height: 5n })).resolves.toEqual({
      current_height: 7n,
      scanned_to_height: 7n,
      events: [
        {
          height: 6n,
          events: [{ type: 'create_client' }],
        },
      ],
    });

    expect(latestHeightSpy).not.toHaveBeenCalled();
    expect(queryBlockResultsSpy).toHaveBeenCalledTimes(2);
    expect(queryBlockResultsSpy).toHaveBeenNthCalledWith(1, { height: 6n });
    expect(queryBlockResultsSpy).toHaveBeenNthCalledWith(2, { height: 7n });
  });
});
