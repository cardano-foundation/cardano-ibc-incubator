import {
  TRANSFER_ESCROW_SHARD_REGISTERED_VALUE,
  TRANSFER_ESCROW_SHARD_RETIRED_VALUE,
  escrowDenomTokenFromPacketDenom,
  transferEscrowShardChannelLiveCountKey,
  transferEscrowShardCountValue,
  transferEscrowShardRegistryKey,
  transferEscrowShardTokenName,
} from './transfer-escrow-shard';

describe('transfer escrow shard framing', () => {
  it('matches golden framed token names', () => {
    expect(transferEscrowShardTokenName('', '')).toBe('450c7dedec743c7add2b6b968aa86445a2fc5f116cf0a1a5548aa0a8');
    expect(transferEscrowShardTokenName('aa', 'bbcc')).toBe('f3fb665f2e13cebb798c67dfa87af4142cad8593d66a627383f52aae');
    expect(transferEscrowShardTokenName('aabb', 'cc')).toBe('03b01f0239f6ad093d095fcc7dba2bbf778220cb8927bac6799b2d0e');
    expect(
      transferEscrowShardTokenName(
        Buffer.from('channel-1').toString('hex'),
        Buffer.from(`23${'ab'.repeat(28)}`).toString('hex'),
      ),
    ).toBe('82bd61ddc779508a845de79b0119ec03c6c5f4adaec7e1462052cc50');
  });

  it('separates channel and denom byte boundaries that collide when concatenated', () => {
    const first = transferEscrowShardTokenName('aa', 'bbcc');
    const second = transferEscrowShardTokenName('aabb', 'cc');

    expect(Buffer.concat([Buffer.from('aa', 'hex'), Buffer.from('bbcc', 'hex')])).toEqual(
      Buffer.concat([Buffer.from('aabb', 'hex'), Buffer.from('cc', 'hex')]),
    );
    expect(first).not.toBe(second);
    expect(transferEscrowShardRegistryKey(first)).toBe(`escrowShards/${first}`);
  });

  it('keeps lifecycle values and per-channel count paths aligned with Aiken', () => {
    expect(TRANSFER_ESCROW_SHARD_REGISTERED_VALUE).toEqual(Buffer.from([1]));
    expect(TRANSFER_ESCROW_SHARD_RETIRED_VALUE).toEqual(Buffer.from([2]));
    expect(transferEscrowShardChannelLiveCountKey(Buffer.from('channel-1').toString('hex'))).toBe(
      'escrowShardCounts/6368616e6e656c2d31',
    );
    expect(transferEscrowShardCountValue(0n)).toEqual(Buffer.from([0]));
    expect(transferEscrowShardCountValue(24n)).toEqual(Buffer.from([0x18, 0x18]));
    expect(() => transferEscrowShardCountValue(-1n)).toThrow('cannot be negative');
  });

  it('decodes the canonical packet denom representation', () => {
    expect(escrowDenomTokenFromPacketDenom(Buffer.from('6c6f76656c616365').toString('hex'))).toBe('lovelace');
    const assetUnit = 'ab'.repeat(28) + '01';
    expect(escrowDenomTokenFromPacketDenom(Buffer.from(assetUnit).toString('hex'))).toBe(assetUnit);
    expect(escrowDenomTokenFromPacketDenom(Buffer.from(assetUnit.toUpperCase()).toString('hex'))).toBe(assetUnit);
  });
});
