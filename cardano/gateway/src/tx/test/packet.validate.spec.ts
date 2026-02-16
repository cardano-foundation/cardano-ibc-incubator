import { MsgTransfer } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { normalizeDenomTokenTransfer } from '../helper/helper';
import { validateAndFormatSendPacketParams } from '../helper/packet.validate';

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

  it('does not allow empty denom normalization in core helpers', () => {
    expect(() => normalizeDenomTokenTransfer('')).toThrow(GrpcInvalidArgumentException);
  });
});
