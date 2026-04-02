import * as Lucid from '@lucid-evolution/lucid';
import {
  type TraceRegistryDatum,
  decodeTraceRegistryDatum,
  encodeTraceRegistryDatum,
  encodeTraceRegistryRedeemer,
} from './trace-registry';
import { convertString2Hex } from '../helpers/hex';

describe('trace-registry codecs', () => {
  it('round-trips shard and directory datums through the nested constructor layout', () => {
    const shardDatum: TraceRegistryDatum = {
      Shard: {
        bucket_index: 10n,
        entries: [
          {
            voucher_hash: 'ab'.repeat(32),
            full_denom: 'transfer/channel-7/uatom',
          },
        ],
      },
    };
    const directoryDatum: TraceRegistryDatum = {
      Directory: {
        buckets: [
          {
            bucket_index: 10n,
            active_shard_name: '0a',
            archived_shard_names: ['0b'],
          },
        ],
      },
    };

    const encodedShard = encodeTraceRegistryDatum(shardDatum, Lucid);
    const encodedDirectory = encodeTraceRegistryDatum(directoryDatum, Lucid);

    expect(decodeTraceRegistryDatum(encodedShard, Lucid)).toEqual(shardDatum);
    expect(decodeTraceRegistryDatum(encodedDirectory, Lucid)).toEqual(
      directoryDatum,
    );
  });

  it('encodes redeemers with the expected constructor indexes and payload ordering', () => {
    const insert = encodeTraceRegistryRedeemer(
      {
        InsertTrace: {
          voucher_hash: 'cd'.repeat(32),
          full_denom: 'transfer/channel-7/uosmo',
        },
      },
      Lucid,
    );
    const rollover = encodeTraceRegistryRedeemer(
      {
        RolloverInsertTrace: {
          voucher_hash: 'ef'.repeat(32),
          full_denom: 'transfer/channel-8/uatom',
          new_active_shard_name: '0c',
        },
      },
      Lucid,
    );
    const advance = encodeTraceRegistryRedeemer(
      {
        AdvanceDirectory: {
          bucket_index: 10n,
          voucher_hash: '12'.repeat(32),
          full_denom: 'transfer/channel-9/utia',
          previous_active_shard_name: '0a',
          new_active_shard_name: '0c',
        },
      },
      Lucid,
    );

    const insertConstr = Lucid.Data.from(insert) as Lucid.Constr<unknown>;
    const rolloverConstr = Lucid.Data.from(rollover) as Lucid.Constr<unknown>;
    const advanceConstr = Lucid.Data.from(advance) as Lucid.Constr<unknown>;

    expect(insertConstr.index).toBe(0);
    expect(insertConstr.fields).toEqual([
      'cd'.repeat(32),
      convertString2Hex('transfer/channel-7/uosmo'),
    ]);
    expect(rolloverConstr.index).toBe(1);
    expect(rolloverConstr.fields).toEqual([
      'ef'.repeat(32),
      convertString2Hex('transfer/channel-8/uatom'),
      '0c',
    ]);
    expect(advanceConstr.index).toBe(2);
    expect(advanceConstr.fields).toEqual([
      10n,
      '12'.repeat(32),
      convertString2Hex('transfer/channel-9/utia'),
      '0a',
      '0c',
    ]);
  });
});
