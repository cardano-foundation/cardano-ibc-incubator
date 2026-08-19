import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { PacketService } from '../packet.service';

describe('PacketService escrow shard lookup', () => {
  const shardPolicyId = '55'.repeat(28);
  const shardAddress = 'addr_test1transfermodule';
  const encodedDatum = 'encoded-transfer-escrow-datum';
  const creationInput = {
    txHash: 'aa'.repeat(32),
    outputIndex: 0,
    address: shardAddress,
    assets: { ['66'.repeat(28)]: 1n },
  };

  function makeService(moduleUtxos: unknown[]) {
    const configService = {
      get: jest.fn().mockReturnValue({
        validators: {
          mintTransferEscrowShard: { scriptHash: shardPolicyId },
        },
        modules: {
          transfer: {
            address: shardAddress,
            identifier: '66'.repeat(28),
          },
        },
      }),
    } as unknown as ConfigService;
    const lucidService = {
      encode: jest.fn().mockResolvedValue(encodedDatum),
      findUtxoAt: jest.fn().mockResolvedValue(moduleUtxos),
    } as unknown as LucidService;
    const service = new PacketService(
      {} as Logger,
      configService,
      lucidService,
      {} as DenomTraceService,
      {} as any,
      {} as any,
    );
    return { service, lucidService };
  }

  function shard(txHash: string, tokenName: string) {
    const shardTokenUnit = shardPolicyId + tokenName;
    return {
      txHash,
      outputIndex: 0,
      address: shardAddress,
      datum: encodedDatum,
      assets: {
        lovelace: 10_000_000n,
        [shardTokenUnit]: 1n,
      },
    };
  }

  it('enumerates the module address and returns the sole exact match', async () => {
    const expected = shard('bb'.repeat(32), '11'.repeat(28));
    const { service, lucidService } = makeService([
      { ...shard('cc'.repeat(32), '22'.repeat(28)), datum: 'other-datum' },
      expected,
    ]);

    const result = await (service as any).findTransferEscrowShard(
      '6368616e6e656c2d31',
      '32333435',
      'lovelace',
      creationInput,
    );

    expect(lucidService.findUtxoAt).toHaveBeenCalledWith(shardAddress);
    expect(result.utxo).toBe(expected);
    expect(result.shardTokenUnit).toBe(shardPolicyId + '11'.repeat(28));
  });

  it('rejects duplicate exact matches instead of choosing one asset-unit result', async () => {
    const { service } = makeService([
      shard('bb'.repeat(32), '11'.repeat(28)),
      shard('cc'.repeat(32), '22'.repeat(28)),
    ]);

    await expect(
      (service as any).findTransferEscrowShard(
        '6368616e6e656c2d31',
        '32333435',
        'lovelace',
        creationInput,
      ),
    ).rejects.toThrow(/Multiple transfer escrow shards match/);
  });
});
