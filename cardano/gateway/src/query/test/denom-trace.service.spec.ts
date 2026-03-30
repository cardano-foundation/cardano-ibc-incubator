import { Logger } from '@nestjs/common';
import * as Lucid from '@lucid-evolution/lucid';
import { DenomTraceService } from '../services/denom-trace.service';
import { encodeTraceRegistryShardDatum } from '../../shared/types/trace-registry';
import { convertString2Hex, hashSHA256 } from '../../shared/helpers/hex';

describe('DenomTraceService', () => {
  let service: DenomTraceService;
  let lucidServiceMock: {
    findUtxoByUnit: jest.Mock;
    LucidImporter: typeof Lucid;
  };
  let configServiceMock: {
    get: jest.Mock;
  };
  let metricsMock: {
    denomTraceQueryDuration: { observe: jest.Mock };
  };

  const makeShardUtxo = (entries: Array<{ voucher_hash: string; full_denom: string }>, index: number) => ({
    txHash: `trace-shard-${index}`,
    outputIndex: index,
    assets: {},
    datum: encodeTraceRegistryShardDatum(
      {
        shard_index: BigInt(index),
        entries,
      },
      Lucid,
    ),
  });

  beforeEach(() => {
    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    metricsMock = {
      denomTraceQueryDuration: { observe: jest.fn() },
    };

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key !== 'deployment') return undefined;
        return {
          validators: {
            mintVoucher: {
              scriptHash: 'mint-voucher-policy-id',
            },
          },
          traceRegistry: {
            address: 'addr_test1trace',
            shardPolicyId: 'trace-shard-policy',
            shards: [
              { index: 0, policyId: 'trace-shard-policy', name: '00' },
              { index: 10, policyId: 'trace-shard-policy', name: '0a' },
              { index: 15, policyId: 'trace-shard-policy', name: '0f' },
            ],
          },
        };
      }),
    };

    const shardUtxos = new Map<string, ReturnType<typeof makeShardUtxo>>([
      ['trace-shard-policy00', makeShardUtxo([], 0)],
      ['trace-shard-policy0a', makeShardUtxo([], 10)],
      ['trace-shard-policy0f', makeShardUtxo([], 15)],
    ]);

    lucidServiceMock = {
      findUtxoByUnit: jest.fn(async (unit: string) => {
        const utxo = shardUtxos.get(unit);
        if (!utxo) {
          throw new Error(`unexpected unit lookup: ${unit}`);
        }
        return utxo;
      }),
      LucidImporter: Lucid,
    };

    service = new DenomTraceService(
      loggerMock,
      configServiceMock as any,
      lucidServiceMock as any,
      metricsMock as any,
    );
  });

  it('builds an on-chain insert context for a first-seen voucher hash', async () => {
    const hash = `a${'1'.repeat(63)}`;
    const fullDenom = 'transfer/channel-7/uatom';

    const result = await service.prepareOnChainInsert(hash, fullDenom);

    expect(result).not.toBeNull();
    expect(result?.traceRegistryShardUtxo.txHash).toBe('trace-shard-10');
    expect(result?.encodedTraceRegistryRedeemer).toBeTruthy();
    expect(result?.encodedUpdatedTraceRegistryShardDatum).toBeTruthy();
  });

  it('skips an on-chain insert when the shard already contains the same mapping', async () => {
    const hash = `f${'2'.repeat(63)}`;
    const fullDenom = 'transfer/channel-44/factory/osmo1abcd/mytoken';
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy0f') {
        return makeShardUtxo([{ voucher_hash: hash, full_denom: fullDenom }], 15);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    await expect(service.prepareOnChainInsert(hash, fullDenom)).resolves.toBeNull();
  });

  it('fails hard when the same voucher hash resolves to a conflicting full denom', async () => {
    const hash = `0${'3'.repeat(63)}`;
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy00') {
        return makeShardUtxo([{ voucher_hash: hash, full_denom: 'transfer/channel-9/uosmo' }], 0);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    await expect(service.prepareOnChainInsert(hash, 'transfer/channel-7/uatom')).rejects.toThrow(
      'Conflicting on-chain denom trace',
    );
  });

  it('materializes traces from shard data and resolves by ibc denom hash', async () => {
    const atomTrace = 'transfer/channel-7/uatom';
    const osmoTrace = 'transfer/channel-44/factory/osmo1abcd/mytoken';
    const atomHash = `0${'a'.repeat(63)}`;
    const osmoHash = `f${'b'.repeat(63)}`;
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy00') {
        return makeShardUtxo([{ voucher_hash: atomHash, full_denom: atomTrace }], 0);
      }
      if (unit === 'trace-shard-policy0a') {
        return makeShardUtxo([], 10);
      }
      if (unit === 'trace-shard-policy0f') {
        return makeShardUtxo([{ voucher_hash: osmoHash, full_denom: osmoTrace }], 15);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    await expect(service.findByHash(atomHash)).resolves.toEqual({
      hash: atomHash,
      path: 'transfer/channel-7',
      base_denom: 'uatom',
      voucher_policy_id: 'mint-voucher-policy-id',
      ibc_denom_hash: hashSHA256(convertString2Hex(atomTrace)).toLowerCase(),
    });

    await expect(
      service.findByIbcDenomHash(hashSHA256(convertString2Hex(osmoTrace)).toUpperCase()),
    ).resolves.toEqual({
      hash: osmoHash,
      path: 'transfer/channel-44',
      base_denom: 'factory/osmo1abcd/mytoken',
      voucher_policy_id: 'mint-voucher-policy-id',
      ibc_denom_hash: hashSHA256(convertString2Hex(osmoTrace)).toLowerCase(),
    });
  });

  it('lists all traces in sorted order and honors pagination offset', async () => {
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy00') {
        return makeShardUtxo([{ voucher_hash: `0${'1'.repeat(63)}`, full_denom: 'transfer/channel-9/uosmo' }], 0);
      }
      if (unit === 'trace-shard-policy0a') {
        return makeShardUtxo([{ voucher_hash: `a${'2'.repeat(63)}`, full_denom: 'transfer/channel-7/uatom' }], 10);
      }
      if (unit === 'trace-shard-policy0f') {
        return makeShardUtxo([{ voucher_hash: `f${'3'.repeat(63)}`, full_denom: 'factory/osmo1abcd/mytoken' }], 15);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    const traces = await service.findAll({ offset: 1 } as any);

    expect(traces).toHaveLength(2);
    expect(traces[0].base_denom).toBe('uatom');
    expect(traces[1].base_denom).toBe('uosmo');
    await expect(service.getCount()).resolves.toBe(3);
  });
});
