import {
  MsgRecvPacket,
  MsgTimeout,
  MsgTimeoutOnClose,
  MsgTransfer,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import {
  GrpcFailedPreconditionException,
  GrpcInvalidArgumentException,
} from '~@/exception/grpc_exceptions';
import { normalizeDenomTokenTransfer } from '../helper/helper';
import {
  validateAndFormatRecvPacketParams,
  validateAndFormatSendPacketParams,
  validateAndFormatTimeoutOnClosePacketParams,
  validateAndFormatTimeoutPacketParams,
  validateRecvPacketHistoryCapacity,
  validateSendPacketCommitmentCapacity,
} from '../helper/packet.validate';
import { ChannelDatum } from '@shared/types/channel/channel-datum';
import { Order } from '@shared/types/channel/order';
import { ICS20_CLASSIC_JSON_LIMITS, MAX_PACKET_ENTRIES_PER_CHANNEL } from '@cardano-ibc/tx-builder';
import { ICS20_PACKET_CODEC } from '../../config/bridge-manifest';
import { stringifyLegacyIcs20PacketData } from '../../shared/helpers/ics20-packet-codec';

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

describe('Timeout packet ICS-20 JSON validation', () => {
  const buildMsgTimeout = (packetData: Uint8Array): MsgTimeout => ({
    packet: {
      sequence: 1n,
      source_port: 'transfer',
      source_channel: 'channel-0',
      destination_port: 'transfer',
      destination_channel: 'channel-1',
      data: packetData,
      timeout_height: {
        revision_number: 0n,
        revision_height: 0n,
      },
      timeout_timestamp: 1n,
    },
    proof_unreceived: new Uint8Array(),
    proof_height: { revision_number: 0n, revision_height: 1n },
    next_sequence_recv: 1n,
    signer: 'addr_test1qsigner',
  });

  it.each([
    ['ibc-go v8', '{"amount":"12","denom":"uatom","receiver":"addr_test1receiver","sender":"cosmos1sender"}'],
    ['ibc-go v10', '{"denom":"uatom","amount":"12","sender":"cosmos1sender","receiver":"addr_test1receiver"}'],
  ])('accepts canonical %s packet bytes', (_profile, packetJson) => {
    const result = validateAndFormatTimeoutPacketParams(buildMsgTimeout(Buffer.from(packetJson, 'utf8')));

    expect(result.timeoutPacketOperator.fungibleTokenPacketData).toEqual({
      denom: 'uatom',
      amount: '12',
      sender: 'cosmos1sender',
      receiver: 'addr_test1receiver',
      memo: '',
    });
  });

  it.each([
    ['malformed JSON', Buffer.from('{bad}', 'utf8')],
    [
      'unknown fields',
      Buffer.from('{"denom":"uatom","amount":"12","sender":"sender","receiver":"receiver","extra":"value"}', 'utf8'),
    ],
    [
      'unsupported field order',
      Buffer.from('{"denom":"uatom","sender":"sender","amount":"12","receiver":"receiver"}', 'utf8'),
    ],
    ['invalid UTF-8', new Uint8Array([0xc3, 0x28])],
    ['oversized packet', new Uint8Array(ICS20_CLASSIC_JSON_LIMITS.packetBytes + 1)],
  ])('rejects %s', (_case, packetData) => {
    const validate = () => validateAndFormatTimeoutPacketParams(buildMsgTimeout(packetData));

    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('Invalid ICS-20 packet data');
  });

  it('allows a legacy deployment to settle a previously committed oversized packet', () => {
    const packetJson = stringifyLegacyIcs20PacketData({
      denom: 'uatom',
      amount: '12',
      sender: 'cosmos1sender',
      receiver: 'addr_test1receiver',
      memo: 'm'.repeat(600),
    });

    const result = validateAndFormatTimeoutPacketParams(
      buildMsgTimeout(Buffer.from(packetJson, 'utf8')),
      ICS20_PACKET_CODEC.LEGACY,
    );

    expect(result.timeoutPacketOperator.fungibleTokenPacketData.memo).toHaveLength(600);
  });

  it('keeps the counterparty close proof separate from the unreceived proof', () => {
    const packetData = Buffer.from(
      '{"denom":"uatom","amount":"12","sender":"cosmos1sender","receiver":"addr_test1receiver"}',
      'utf8',
    );
    const proofClose = Uint8Array.from([0x0a, 0x02, 0x1a, 0x00]);
    const message: MsgTimeoutOnClose = {
      ...buildMsgTimeout(packetData),
      proof_close: proofClose,
    };

    const result = validateAndFormatTimeoutOnClosePacketParams(message);

    expect(result.constructedAddress).toBe(message.signer);
    expect(result.timeoutOnClosePacketOperator.proofUnreceived.proofs).toHaveLength(0);
    expect(result.timeoutOnClosePacketOperator.proofClose.proofs).toHaveLength(1);
    expect(result.timeoutOnClosePacketOperator.packet.sequence).toBe(1n);
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
