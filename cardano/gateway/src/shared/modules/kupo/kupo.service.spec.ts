import { ConfigService } from '@nestjs/config';
import { GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { KupoService } from './kupo.service';

function serviceWith(findUtxoAt: jest.Mock): KupoService {
  const config = new ConfigService({
    deployment: {
      validators: {
        mintClientStt: { scriptHash: '11'.repeat(28) },
        mintConnectionStt: { scriptHash: '22'.repeat(28) },
        mintChannelStt: { scriptHash: '33'.repeat(28) },
        spendClient: { address: 'addr_test1client' },
        spendConnection: { address: 'addr_test1connection' },
        spendChannel: { address: 'addr_test1channel' },
      },
    },
  });
  return new KupoService({ findUtxoAt } as never, config);
}

describe('KupoService client state reads without archive outputs', () => {
  it('returns no clients before the first client is created', async () => {
    const findUtxoAt = jest.fn().mockRejectedValue(new GrpcNotFoundException('missing'));

    await expect(serviceWith(findUtxoAt).queryAllClientUtxos()).resolves.toEqual([]);
  });

  it('only enumerates the configured client policy at its client address', async () => {
    const client = { txHash: 'aa'.repeat(32), outputIndex: 0, assets: { ['11'.repeat(28) + '01']: 1n } };
    const unrelated = { txHash: 'bb'.repeat(32), outputIndex: 0, assets: { ['44'.repeat(28) + '01']: 1n } };
    const findUtxoAt = jest.fn().mockResolvedValue([client, unrelated]);
    await expect(serviceWith(findUtxoAt).queryAllClientUtxos()).resolves.toEqual([client]);
    expect(findUtxoAt).toHaveBeenCalledWith('addr_test1client');
  });
});
