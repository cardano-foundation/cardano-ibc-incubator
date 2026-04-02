import { Logger } from '@nestjs/common';
import * as Lucid from '@lucid-evolution/lucid';
import { DenomTraceService } from '../services/denom-trace.service';
import { encodeTraceRegistryDatum } from '../../shared/types/trace-registry';
import { convertString2Hex, hashSHA256 } from '../../shared/helpers/hex';

describe('DenomTraceService', () => {
  let service: DenomTraceService;
  let lucidServiceMock: {
    findUtxoByUnit: jest.Mock;
    lucid: {
      config: jest.Mock;
      wallet: () => { getUtxos: jest.Mock };
    };
    estimateUnsignedTxSizeBytes: jest.Mock;
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
    datum: encodeTraceRegistryDatum(
      {
        Shard: {
          bucket_index: BigInt(index),
          entries,
        },
      },
      Lucid,
    ),
  });

  const makeDirectoryUtxo = (buckets: Array<{ bucket_index: bigint; active_shard_name: string; archived_shard_names: string[] }>) => ({
    txHash: 'trace-directory',
    outputIndex: 0,
    assets: {},
    datum: encodeTraceRegistryDatum(
      {
        Directory: {
          buckets,
        },
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
            directory: { policyId: 'trace-shard-policy', name: 'dir' },
          },
        };
      }),
    };

    const shardUtxos = new Map<string, ReturnType<typeof makeShardUtxo>>([
      [
        'trace-shard-policydir',
        makeDirectoryUtxo([
          { bucket_index: 0n, active_shard_name: '00', archived_shard_names: [] },
          { bucket_index: 10n, active_shard_name: '0a', archived_shard_names: [] },
          { bucket_index: 15n, active_shard_name: '0f', archived_shard_names: [] },
        ]),
      ],
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
      lucid: {
        config: jest.fn(() => ({
          protocolParameters: {
            maxTxSize: 16_384,
          },
        })),
        wallet: () => ({
          getUtxos: jest.fn(async () => [
            {
              txHash: '11'.repeat(32),
              outputIndex: 0,
              assets: { lovelace: 10_000_000n },
            },
          ]),
        }),
      },
      estimateUnsignedTxSizeBytes: jest.fn(async () => 1_000),
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
    expect(result?.kind).toBe('append');
    if (!result || result.kind !== 'append') {
      throw new Error('expected append context');
    }
    expect(result.traceRegistryShardUtxo.txHash).toBe('trace-shard-10');
    expect(result.encodedTraceRegistryRedeemer).toBeTruthy();
    expect(result.encodedUpdatedTraceRegistryDatum).toBeTruthy();
  });

  it('skips an on-chain insert when the shard already contains the same mapping', async () => {
    const hash = `f${'2'.repeat(63)}`;
    const fullDenom = 'transfer/channel-44/factory/osmo1abcd/mytoken';
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy0f') {
        return makeShardUtxo([{ voucher_hash: hash, full_denom: fullDenom }], 15);
      }
      if (unit === 'trace-shard-policydir') {
        return makeDirectoryUtxo([
          { bucket_index: 15n, active_shard_name: '0f', archived_shard_names: [] },
        ]);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    const result = await service.prepareOnChainInsert(hash, fullDenom);

    expect(result.kind).toBe('existing');
    if (result.kind !== 'existing') {
      throw new Error('expected existing proof context');
    }
    expect(result.traceRegistryDirectoryUtxo.txHash).toBe('trace-directory');
    expect(result.traceRegistryShardUtxo.txHash).toBe('trace-shard-15');
  });

  it('fails hard when the same voucher hash resolves to a conflicting full denom', async () => {
    const hash = `0${'3'.repeat(63)}`;
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy00') {
        return makeShardUtxo([{ voucher_hash: hash, full_denom: 'transfer/channel-9/uosmo' }], 0);
      }
      if (unit === 'trace-shard-policydir') {
        return makeDirectoryUtxo([
          { bucket_index: 0n, active_shard_name: '00', archived_shard_names: [] },
        ]);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    await expect(service.prepareOnChainInsert(hash, 'transfer/channel-7/uatom')).rejects.toThrow(
      'Conflicting on-chain denom trace',
    );
  });

  it('fails closed when trace registry deployment config is missing', async () => {
    configServiceMock.get.mockImplementation(() => ({
      validators: {
        mintVoucher: {
          scriptHash: 'mint-voucher-policy-id',
        },
      },
    }));

    await expect(
      service.prepareOnChainInsert(`a${'4'.repeat(63)}`, 'transfer/channel-7/uatom'),
    ).rejects.toThrow('Trace registry deployment config is missing for voucher minting');
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
      if (unit === 'trace-shard-policydir') {
        return makeDirectoryUtxo([
          { bucket_index: 0n, active_shard_name: '00', archived_shard_names: [] },
          { bucket_index: 10n, active_shard_name: '0a', archived_shard_names: [] },
          { bucket_index: 15n, active_shard_name: '0f', archived_shard_names: [] },
        ]);
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
      if (unit === 'trace-shard-policydir') {
        return makeDirectoryUtxo([
          { bucket_index: 0n, active_shard_name: '00', archived_shard_names: [] },
          { bucket_index: 10n, active_shard_name: '0a', archived_shard_names: [] },
          { bucket_index: 15n, active_shard_name: '0f', archived_shard_names: [] },
        ]);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    const traces = await service.findAll({ offset: 1 } as any);

    expect(traces).toHaveLength(2);
    expect(traces[0].base_denom).toBe('uatom');
    expect(traces[1].base_denom).toBe('uosmo');
    await expect(service.getCount()).resolves.toBe(3);
  });

  it('prepares a rollover context when forced', async () => {
    const hash = `a${'4'.repeat(63)}`;
    const fullDenom = 'transfer/channel-77/uatom';

    const result = await service.prepareOnChainInsert(hash, fullDenom, { forceRollover: true });

    expect(result).not.toBeNull();
    expect(result?.kind).toBe('rollover');
    if (!result || result.kind !== 'rollover') {
      throw new Error('expected rollover context');
    }
    expect(result.traceRegistryDirectoryUtxo.txHash).toBe('trace-directory');
    expect(result.traceRegistryShardUtxo.txHash).toBe('trace-shard-10');
    expect(result.newActiveTraceRegistryShardTokenUnit.startsWith('trace-shard-policy')).toBe(true);
  });

  it('summarizes bucket and shard counts from the on-chain directory', async () => {
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy00') {
        return makeShardUtxo([{ voucher_hash: `0${'1'.repeat(63)}`, full_denom: 'transfer/channel-9/uosmo' }], 0);
      }
      if (unit === 'trace-shard-policy0a') {
        return makeShardUtxo([{ voucher_hash: `a${'2'.repeat(63)}`, full_denom: 'transfer/channel-7/uatom' }], 10);
      }
      if (unit === 'trace-shard-policy1a') {
        return makeShardUtxo([{ voucher_hash: `a${'3'.repeat(63)}`, full_denom: 'transfer/channel-8/uatom' }], 10);
      }
      if (unit === 'trace-shard-policy0f') {
        return makeShardUtxo([], 15);
      }
      if (unit === 'trace-shard-policydir') {
        return makeDirectoryUtxo([
          { bucket_index: 0n, active_shard_name: '00', archived_shard_names: [] },
          { bucket_index: 10n, active_shard_name: '0a', archived_shard_names: ['1a'] },
          { bucket_index: 15n, active_shard_name: '0f', archived_shard_names: [] },
        ]);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    const summary = await service.getSummary();

    expect(summary.maxTxSize).toBe(16_384);
    expect(summary.txHeadroomBytes).toBe(1_024);
    expect(summary.projectedMaxShardDatumBytesUpperBound).toBe(15_360);
    expect(summary.totalEntries).toBe(3);
    expect(summary.buckets).toHaveLength(3);
    expect(summary.buckets[1]).toMatchObject({
      bucketIndex: 10,
      shardCount: 2,
      rolloverCount: 1,
      totalEntries: 2,
      activeShardEntryCount: 1,
    });
    expect(summary.buckets[1].shards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tokenName: '0a', isActive: true, entryCount: 1 }),
        expect.objectContaining({ tokenName: '1a', isActive: false, entryCount: 1 }),
      ]),
    );
  });

  it('simulates bucket growth and projects rollovers with a size-only upper bound', async () => {
    lucidServiceMock.findUtxoByUnit.mockImplementation(async (unit: string) => {
      if (unit === 'trace-shard-policy0a') {
        return makeShardUtxo([], 10);
      }
      if (unit === 'trace-shard-policydir') {
        return makeDirectoryUtxo([{ bucket_index: 10n, active_shard_name: '0a', archived_shard_names: [] }]);
      }
      throw new Error(`unexpected unit lookup: ${unit}`);
    });

    const summary = await service.getSummary();
    const simulation = await service.simulateBucketGrowth(10, 6);

    expect(summary.buckets[0]).toMatchObject({
      bucketIndex: 10,
      shardCount: 1,
      rolloverCount: 0,
      totalEntries: 0,
    });
    expect(simulation.sizeModel).toBe('datum-only-upper-bound');
    expect(simulation.bucketIndex).toBe(10);
    expect(simulation.simulatedInserts).toBe(6);
    expect(simulation.initialBucket.totalEntries).toBe(0);
    expect(simulation.projectedBucket.totalEntries).toBe(6);
    expect(simulation.projectedBucket.shardCount).toBeGreaterThanOrEqual(1);
    expect(simulation.sampleInserts.length).toBeGreaterThan(0);
    expect(simulation.sampleInserts[0]).toMatchObject({
      step: 1,
      rolledOver: false,
    });
  });
});
