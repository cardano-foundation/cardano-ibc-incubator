import { MsgRecvPacket, MsgTransfer } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { normalizeDenomTokenTransfer } from '../helper/helper';
import { validateAndFormatRecvPacketParams, validateAndFormatSendPacketParams } from '../helper/packet.validate';

describe('Receive packet timeout validation', () => {
  const futureTimestamp = 4102444800000000000n;

  const buildMsgRecvPacket = (revisionHeight: bigint, timeoutTimestamp: bigint): MsgRecvPacket => ({
    packet: {
      sequence: 1n,
      source_port: 'transfer',
      source_channel: 'channel-0',
      destination_port: 'transfer',
      destination_channel: 'channel-0',
      data: new Uint8Array([1]),
      timeout_height: {
        revision_number: 0n,
        revision_height: revisionHeight,
      },
      timeout_timestamp: timeoutTimestamp,
    },
    proof_commitment: new Uint8Array(),
    proof_height: { revision_number: 0n, revision_height: 1n },
    signer: 'addr_test1qsigner',
  });

  it('accepts a timestamp-only receive timeout', () => {
    const result = validateAndFormatRecvPacketParams(buildMsgRecvPacket(0n, futureTimestamp));

    expect(result.recvPacketOperator.timeoutHeight).toEqual({
      revisionHeight: 0n,
      revisionNumber: 0n,
    });
    expect(result.recvPacketOperator.timeoutTimestamp).toBe(futureTimestamp);
  });

  it('rejects a height-only receive timeout', () => {
    const validate = () => validateAndFormatRecvPacketParams(buildMsgRecvPacket(100n, 0n));

    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('timeout_height');
  });

  it('rejects a mixed height and timestamp receive timeout', () => {
    const validate = () => validateAndFormatRecvPacketParams(buildMsgRecvPacket(100n, futureTimestamp));

    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('timeout_height');
  });
});

describe('Send packet denom validation', () => {
  const buildMsgTransfer = (denom: string): MsgTransfer =>
    ({
      source_port: 'transfer',
      source_channel: 'channel-0',
      token: { denom, amount: '1' },
      sender: 'addr_test1qsxsender',
      receiver: 'cosmos1receiver',
      signer: 'addr_test1qsigner',
      timeout_height: undefined,
      timeout_timestamp: '0',
      memo: '',
    }) as unknown as MsgTransfer;

  it('rejects empty denom at send-packet validation boundary', () => {
    const request = buildMsgTransfer('   ');
    expect(() => validateAndFormatSendPacketParams(request)).toThrow(GrpcInvalidArgumentException);
  });

  it('trims token.denom before passing into send packet operator', () => {
    const request = buildMsgTransfer('  lovelace  ');
    const operator = validateAndFormatSendPacketParams(request);

    expect(operator.token.denom).toBe('lovelace');
  });

  it('normalizes token.amount to bigint before tx assembly', () => {
    const request = buildMsgTransfer('lovelace');
    const operator = validateAndFormatSendPacketParams(request);

    expect(operator.token.amount).toBe(1n);
  });

  it('does not allow empty denom normalization in core helpers', () => {
    expect(() => normalizeDenomTokenTransfer('')).toThrow(GrpcInvalidArgumentException);
  });
});
