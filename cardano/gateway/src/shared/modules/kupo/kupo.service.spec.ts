import { ConfigService } from '@nestjs/config';
import { GrpcNotFoundException } from '../../../exception/grpc_exceptions';
import { LucidService } from '../lucid/lucid.service';
import { KupoService } from './kupo.service';
import type { KupoHistoricalOutput } from './kupo.types';

describe('KupoService live IBC UTxO queries', () => {
  const CLIENT_POLICY_ID = 'a'.repeat(56);
  const CONNECTION_POLICY_ID = 'b'.repeat(56);
  const CHANNEL_POLICY_ID = 'c'.repeat(56);
  const getKupoHistoryAtAddressByPolicy = jest.fn();
  const lucidService = {
    findUtxoAt: jest.fn(),
    lucid: {
      provider: {
        getKupoHistoryAtAddressByPolicy,
      },
    },
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
    getKupoHistoryAtAddressByPolicy.mockReset();
    lucidService.lucid.provider = { getKupoHistoryAtAddressByPolicy };
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

  it('selects the latest output for each canonical auth token in deterministic token order', async () => {
    const header10 = '1'.repeat(64);
    const header12 = '2'.repeat(64);
    const tokenA = `${CLIENT_POLICY_ID}aa`;
    const tokenB = `${CLIENT_POLICY_ID}bb`;
    const output = (
      txDigit: string,
      tokenName: string,
      slotNo: number,
      transactionIndex: number,
      spentAt: KupoHistoricalOutput['spentAt'],
      headerHash = header12,
    ): KupoHistoricalOutput => ({
      txHash: txDigit.repeat(64),
      outputIndex: 0,
      transactionIndex,
      address: 'addr_test1client',
      assets: { lovelace: 2_000_000n, [`${CLIENT_POLICY_ID}${tokenName}`]: 1n },
      datum: 'd87980',
      inlineDatumHash: 'd'.repeat(64),
      createdAt: { slotNo, headerHash },
      spentAt,
      authToken: { policyId: CLIENT_POLICY_ID, name: tokenName, unit: `${CLIENT_POLICY_ID}${tokenName}` },
    });
    const olderA = output('1', 'aa', 10, 3, { slotNo: 12, headerHash: header12 }, header10);
    const latestA = output('2', 'aa', 12, 1, null);
    const latestB = output('3', 'bb', 11, 2, null, '3'.repeat(64));
    getKupoHistoryAtAddressByPolicy.mockResolvedValue([latestB, latestA, olderA]);

    const result = await service.queryLatestUtxosAtAddressByPolicyFromHistory('addr_test1client', CLIENT_POLICY_ID);

    expect(getKupoHistoryAtAddressByPolicy).toHaveBeenCalledWith('addr_test1client', CLIENT_POLICY_ID);
    expect(result.map((item) => item.authToken.unit)).toEqual([tokenA, tokenB]);
    expect(result[0]).toBe(latestA);
    expect(result[1]).toBe(latestB);
  });

  it('fails closed instead of choosing between multiple unspent outputs for one token', async () => {
    const unit = `${CLIENT_POLICY_ID}aa`;
    const base = {
      outputIndex: 0,
      address: 'addr_test1client',
      assets: { lovelace: 2_000_000n, [unit]: 1n },
      datum: 'd87980',
      inlineDatumHash: 'd'.repeat(64),
      spentAt: null,
      authToken: { policyId: CLIENT_POLICY_ID, name: 'aa', unit },
    };
    getKupoHistoryAtAddressByPolicy.mockResolvedValue([
      {
        ...base,
        txHash: '1'.repeat(64),
        transactionIndex: 0,
        createdAt: { slotNo: 10, headerHash: '1'.repeat(64) },
      },
      {
        ...base,
        txHash: '2'.repeat(64),
        transactionIndex: 0,
        createdAt: { slotNo: 11, headerHash: '2'.repeat(64) },
      },
    ]);

    await expect(
      service.queryLatestUtxosAtAddressByPolicyFromHistory('addr_test1client', CLIENT_POLICY_ID),
    ).rejects.toThrow('non-latest unspent output');
  });

  it('fails closed when two outputs claim the same canonical chain position', async () => {
    const unit = `${CLIENT_POLICY_ID}aa`;
    const base = {
      outputIndex: 0,
      transactionIndex: 0,
      address: 'addr_test1client',
      assets: { lovelace: 2_000_000n, [unit]: 1n },
      datum: 'd87980',
      inlineDatumHash: 'd'.repeat(64),
      createdAt: { slotNo: 10, headerHash: '1'.repeat(64) },
      authToken: { policyId: CLIENT_POLICY_ID, name: 'aa', unit },
    };
    getKupoHistoryAtAddressByPolicy.mockResolvedValue([
      {
        ...base,
        txHash: '1'.repeat(64),
        spentAt: { slotNo: 10, headerHash: '1'.repeat(64) },
      },
      {
        ...base,
        txHash: '2'.repeat(64),
        spentAt: null,
      },
    ]);

    await expect(
      service.queryLatestUtxosAtAddressByPolicyFromHistory('addr_test1client', CLIENT_POLICY_ID),
    ).rejects.toThrow('duplicate chain positions');
  });

  it('fails closed when the configured Lucid provider has no history capability', async () => {
    lucidService.lucid.provider = {} as typeof lucidService.lucid.provider;

    await expect(
      service.queryLatestUtxosAtAddressByPolicyFromHistory('addr_test1client', CLIENT_POLICY_ID),
    ).rejects.toThrow('does not support Kupo historical matches');
  });

  it('scopes point channel-history queries to the exact token name', async () => {
    getKupoHistoryAtAddressByPolicy.mockResolvedValue([]);
    const tokenName = 'abcd';

    await expect(
      service.queryLatestChannelUtxosFromHistory(
        `${CHANNEL_POLICY_ID}${tokenName}`,
      ),
    ).resolves.toEqual([]);

    expect(getKupoHistoryAtAddressByPolicy).toHaveBeenCalledWith(
      'addr_test1channel',
      CHANNEL_POLICY_ID,
      tokenName,
    );
  });

  it('retains the unscoped channel-history scan for cold tree rebuilds', async () => {
    getKupoHistoryAtAddressByPolicy.mockResolvedValue([]);

    await expect(service.queryLatestChannelUtxosFromHistory()).resolves.toEqual(
      [],
    );

    expect(getKupoHistoryAtAddressByPolicy).toHaveBeenCalledWith(
      'addr_test1channel',
      CHANNEL_POLICY_ID,
    );
  });

  it.each([
    ['a'.repeat(56), 'an empty token name'],
    [`${'d'.repeat(56)}abcd`, 'the wrong policy'],
    [`${CHANNEL_POLICY_ID}abc`, 'an odd-length token name'],
    [`${CHANNEL_POLICY_ID}AB`, 'a non-lowercase token name'],
  ])('rejects an invalid point-history channel unit with %s (%s)', async (unit) => {
    await expect(
      service.queryLatestChannelUtxosFromHistory(unit),
    ).rejects.toThrow('Invalid channel token unit');
    expect(getKupoHistoryAtAddressByPolicy).not.toHaveBeenCalled();
  });
});
