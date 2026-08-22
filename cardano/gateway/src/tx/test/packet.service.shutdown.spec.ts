import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcFailedPreconditionException } from '~@/exception/grpc_exceptions';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { PacketService } from '../packet.service';

describe('PacketService shutdown packet rules', () => {
  it('rejects a new generic module packet before changing the HostState tree', async () => {
    const lucidService = {
      findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({
        txHash: 'host-state',
        outputIndex: 0,
        datum: 'host-state-datum',
        assets: {},
      }),
      decodeDatum: jest.fn().mockResolvedValue({
        state: {
          ibc_state_root: '00'.repeat(32),
        },
        shutdown: {
          ShuttingDown: {
            initiated_at: 1_000n,
            grace_period_end: 2_000n,
          },
        },
      }),
    };
    const service = new PacketService(
      { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger,
      { get: jest.fn() } as unknown as ConfigService,
      lucidService as unknown as LucidService,
      {} as DenomTraceService,
      {} as any,
      {} as any,
      {} as any,
    );
    const alignTree = jest.spyOn(service as any, 'ensureTreeAligned');

    await expect(
      (service as any).buildHostStateUpdateForHandlePacket({} as any, {} as any, 'channel-0', true),
    ).rejects.toThrow(GrpcFailedPreconditionException);
    expect(alignTree).not.toHaveBeenCalled();
  });
});
