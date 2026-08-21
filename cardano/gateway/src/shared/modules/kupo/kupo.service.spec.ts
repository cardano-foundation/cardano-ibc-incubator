import { ConfigService } from '@nestjs/config';
import { GrpcNotFoundException } from '../../../exception/grpc_exceptions';
import { LucidService } from '../lucid/lucid.service';
import { KupoService } from './kupo.service';

describe('KupoService live IBC UTxO queries', () => {
  const CLIENT_POLICY_ID = 'a'.repeat(56);
  const CONNECTION_POLICY_ID = 'b'.repeat(56);
  const CHANNEL_POLICY_ID = 'c'.repeat(56);
  const lucidService = {
    findUtxoAt: jest.fn(),
  };
  const configService = {
    get: jest.fn(() => ({
      validators: {
        mintClientStt: { scriptHash: CLIENT_POLICY_ID },
        mintConnectionStt: { scriptHash: CONNECTION_POLICY_ID },
        mintChannelStt: { scriptHash: CHANNEL_POLICY_ID },
        spendClient: { address: 'addr_test1client' },
        spendConnection: { address: 'addr_test1connection' },
        spendChannel: { address: 'addr_test1channel' },
      },
    })),
  };

  let service: KupoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KupoService(lucidService as unknown as LucidService, configService as unknown as ConfigService);
  });

  it('returns only live UTxOs with a matching policy and token-name prefix', async () => {
    lucidService.findUtxoAt.mockResolvedValue([
      {
        txHash: 'matching',
        outputIndex: 0,
        assets: {
          lovelace: 2_000_000n,
          [`${CLIENT_POLICY_ID}deadbeef01`]: 1n,
          [`${CLIENT_POLICY_ID}cafebabe01`]: 1n,
          [`${CONNECTION_POLICY_ID}deadbeef02`]: 1n,
        },
      },
      {
        txHash: 'wrong-prefix',
        outputIndex: 1,
        assets: {
          [`${CLIENT_POLICY_ID}cafebabe02`]: 1n,
        },
      },
    ]);

    const result = await service.queryUtxosAtAddressByPolicyAndTokenPrefix(
      'addr_test1client',
      CLIENT_POLICY_ID,
      'deadbeef',
    );

    expect(lucidService.findUtxoAt).toHaveBeenCalledWith('addr_test1client');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        txHash: 'matching',
        matchedTokenNames: ['deadbeef01'],
      }),
    );
  });

  it('returns an empty list when the address has no live UTxOs', async () => {
    lucidService.findUtxoAt.mockRejectedValue(new GrpcNotFoundException('no live UTxOs'));

    await expect(
      service.queryUtxosAtAddressByPolicyAndTokenPrefix('addr_test1client', CLIENT_POLICY_ID, 'deadbeef'),
    ).resolves.toEqual([]);
  });

  it('preserves empty-list behavior for client, connection, and channel discovery', async () => {
    lucidService.findUtxoAt.mockRejectedValue(new GrpcNotFoundException('no live UTxOs'));

    await expect(service.queryAllClientUtxos()).resolves.toEqual([]);
    await expect(service.queryAllConnectionUtxos()).resolves.toEqual([]);
    await expect(service.queryAllChannelUtxos()).resolves.toEqual([]);
    expect(lucidService.findUtxoAt).toHaveBeenNthCalledWith(1, 'addr_test1client');
    expect(lucidService.findUtxoAt).toHaveBeenNthCalledWith(2, 'addr_test1connection');
    expect(lucidService.findUtxoAt).toHaveBeenNthCalledWith(3, 'addr_test1channel');
  });

  it('propagates provider failures instead of reporting an empty live set', async () => {
    const providerError = new Error('Kupo is unavailable');
    lucidService.findUtxoAt.mockRejectedValue(providerError);

    await expect(
      service.queryUtxosAtAddressByPolicyAndTokenPrefix('addr_test1client', CLIENT_POLICY_ID, 'deadbeef'),
    ).rejects.toBe(providerError);
    await expect(service.queryAllClientUtxos()).rejects.toBe(providerError);
  });
});
