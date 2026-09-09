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
        spendConsensusState: { address: 'addr_test1history' },
      },
    },
  });
  return new KupoService({ findUtxoAt } as never, config);
}

describe('KupoService consensus-state history reads', () => {
  it('returns no records when a fresh archive address has no UTxOs', async () => {
    const findUtxoAt = jest.fn().mockRejectedValue(new GrpcNotFoundException('missing'));

    await expect(serviceWith(findUtxoAt).queryAllConsensusStateUtxos()).resolves.toEqual([]);
  });

  it('does not hide provider failures', async () => {
    const providerFailure = new Error('provider unavailable');
    const findUtxoAt = jest.fn().mockRejectedValue(providerFailure);

    await expect(serviceWith(findUtxoAt).queryAllConsensusStateUtxos()).rejects.toBe(providerFailure);
  });
});
