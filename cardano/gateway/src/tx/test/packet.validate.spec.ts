import { MsgTransfer } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import {
  GrpcFailedPreconditionException,
  GrpcInvalidArgumentException,
} from '~@/exception/grpc_exceptions';
import { normalizeDenomTokenTransfer } from '../helper/helper';
import {
  validateAndFormatSendPacketParams,
  validateRecvPacketHistoryCapacity,
  validateSendPacketCommitmentCapacity,
} from '../helper/packet.validate';
import { ChannelDatum } from '@shared/types/channel/channel-datum';
import { Order } from '@shared/types/channel/order';
import { MAX_PACKET_ENTRIES_PER_CHANNEL } from '@cardano-ibc/tx-builder';

function packetEntries(count: number): Map<bigint, string> {
  return new Map<bigint, string>(
    Array.from({ length: count }, (_, index) => [
      BigInt(index + 1),
      `packet-${index + 1}`,
    ] as [bigint, string]),
  );
}

function channelDatum(ordering: Order = Order.Unordered): ChannelDatum {
  return {
    port: 'transfer',
    state: {
      channel: { ordering },
      packet_commitment: new Map(),
      packet_receipt: new Map(),
      packet_acknowledgement: new Map(),
    },
  } as unknown as ChannelDatum;
}

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

describe('Packet collection capacity validation', () => {
  it('allows the insertion that reaches the configured boundary', () => {
    const sendDatum = channelDatum();
    sendDatum.state.packet_commitment = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL - 1,
    );
    const recvDatum = channelDatum();
    recvDatum.state.packet_receipt = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL / 2 - 1,
    );
    recvDatum.state.packet_acknowledgement = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL / 2 - 1,
    );

    expect(() =>
      validateSendPacketCommitmentCapacity(sendDatum),
    ).not.toThrow();
    expect(() =>
      validateRecvPacketHistoryCapacity(recvDatum),
    ).not.toThrow();
  });

  it('rejects a send when packet commitment capacity is exhausted', () => {
    const datum = channelDatum();
    datum.state.packet_commitment = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL,
    );

    expect(() => validateSendPacketCommitmentCapacity(datum)).toThrow(
      GrpcFailedPreconditionException,
    );
  });

  it('rejects an unordered receive when packet receipt capacity is exhausted', () => {
    const datum = channelDatum();
    datum.state.packet_receipt = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL,
    );

    expect(() => validateRecvPacketHistoryCapacity(datum)).toThrow(
      GrpcFailedPreconditionException,
    );
  });

  it('rejects a receive when packet acknowledgement capacity is exhausted', () => {
    const datum = channelDatum(Order.Ordered);
    datum.state.packet_acknowledgement = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL,
    );

    expect(() => validateRecvPacketHistoryCapacity(datum)).toThrow(
      GrpcFailedPreconditionException,
    );
  });

  it('rejects insertion when the combined packet collections exhaust capacity', () => {
    const datum = channelDatum();
    datum.state.packet_receipt = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL / 2,
    );
    datum.state.packet_acknowledgement = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL / 2,
    );

    expect(() => validateSendPacketCommitmentCapacity(datum)).toThrow(
      GrpcFailedPreconditionException,
    );
    expect(() => validateRecvPacketHistoryCapacity(datum)).toThrow(
      GrpcFailedPreconditionException,
    );
  });

  it('allows an ordered receive when one combined entry remains', () => {
    const datum = channelDatum(Order.Ordered);
    datum.state.packet_receipt = packetEntries(
      MAX_PACKET_ENTRIES_PER_CHANNEL - 1,
    );

    expect(() => validateRecvPacketHistoryCapacity(datum)).not.toThrow();
  });
});
