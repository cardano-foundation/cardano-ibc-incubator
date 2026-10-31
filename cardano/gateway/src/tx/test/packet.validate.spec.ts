import {
  MsgRecvPacket,
  MsgTimeout,
  MsgTimeoutOnClose,
  MsgTransfer,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { GrpcFailedPreconditionException, GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
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
import { MAX_PACKET_ENTRIES_PER_CHANNEL } from '@cardano-ibc/tx-builder';
import { credentialToAddress } from '@lucid-evolution/lucid';

function packetEntries(count: number): Map<bigint, string> {
  return new Map<bigint, string>(
    Array.from({ length: count }, (_, index) => [BigInt(index + 1), `packet-${index + 1}`] as [bigint, string]),
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
  const paymentKeyHash = '216e8fc9cdc8d2a748d754c319ee95bd5410f69a6a4e23165e4e5d50';
  const buildMsgTransfer = (denom: string): MsgTransfer =>
    ({
      source_port: 'transfer',
      source_channel: 'channel-0',
      token: { denom, amount: '1' },
      sender: paymentKeyHash,
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

  it.each([
    ['payment key hash', paymentKeyHash],
    ['hex enterprise address', `60${paymentKeyHash}`],
    ['bech32 enterprise address', credentialToAddress('Preview', { type: 'Key', hash: paymentKeyHash })],
  ])('puts the key hash in packet data for a %s', (_format, sender) => {
    const request = buildMsgTransfer('lovelace');
    request.sender = sender;
    request.signer = `60${paymentKeyHash}`;

    const operator = validateAndFormatSendPacketParams(request);

    expect(operator.sender).toBe(paymentKeyHash);
    expect(operator.signer).toBe(request.signer);
  });

  it.each([
    ['script address', credentialToAddress('Preview', { type: 'Script', hash: paymentKeyHash })],
    ['malformed address', `60${paymentKeyHash}ff`],
  ])('rejects a %s as sender before transaction construction', (_format, sender) => {
    const request = buildMsgTransfer('lovelace');
    request.sender = sender;

    expect(() => validateAndFormatSendPacketParams(request)).toThrow(GrpcInvalidArgumentException);
  });
});

describe('Query packet timeout validation', () => {
  const request = (data: Uint8Array): MsgTimeout => ({
    packet: {
      sequence: 1n,
      source_port: 'icqhost',
      source_channel: 'channel-0',
      destination_port: 'icqhost',
      destination_channel: 'channel-1',
      data,
      timeout_height: { revision_number: 0n, revision_height: 0n },
      timeout_timestamp: 1n,
    },
    proof_unreceived: new Uint8Array(),
    proof_height: { revision_number: 0n, revision_height: 1n },
    next_sequence_recv: 1n,
    signer: 'addr_test1qsigner',
  });

  it('keeps query bytes opaque when preparing a timeout', () => {
    const message = request(Uint8Array.from([0x0a, 0x00, 0xff]));
    const result = validateAndFormatTimeoutPacketParams(message);
    expect(result.timeoutPacketOperator.packet.data).toBe('0a00ff');
    expect(result.timeoutPacketOperator.proofUnreceived.proofs).toHaveLength(0);
  });

  it('keeps the counterparty close proof separate from the unreceived proof', () => {
    const message: MsgTimeoutOnClose = {
      ...request(Uint8Array.from([1])),
      proof_close: Uint8Array.from([0x0a, 0x02, 0x1a, 0x00]),
      counterparty_upgrade_sequence: 2n,
    };
    const result = validateAndFormatTimeoutOnClosePacketParams(message);
    expect(result.constructedAddress).toBe(message.signer);
    expect(result.timeoutOnClosePacketOperator.proofUnreceived.proofs).toHaveLength(0);
    expect(result.timeoutOnClosePacketOperator.proofClose.proofs).toHaveLength(1);
    expect(result.timeoutOnClosePacketOperator.counterpartyUpgradeSequence).toBe(2n);
  });
});

describe('Packet collection capacity validation', () => {
  it('allows the insertion that reaches the configured boundary', () => {
    const sendDatum = channelDatum();
    sendDatum.state.packet_commitment = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL - 1);
    const recvDatum = channelDatum();
    recvDatum.state.packet_receipt = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL / 2 - 1);
    recvDatum.state.packet_acknowledgement = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL / 2 - 1);

    expect(() => validateSendPacketCommitmentCapacity(sendDatum)).not.toThrow();
    expect(() => validateRecvPacketHistoryCapacity(recvDatum)).not.toThrow();
  });

  it('rejects a send when packet commitment capacity is exhausted', () => {
    const datum = channelDatum();
    datum.state.packet_commitment = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL);

    expect(() => validateSendPacketCommitmentCapacity(datum)).toThrow(GrpcFailedPreconditionException);
  });

  it('rejects an unordered receive when packet receipt capacity is exhausted', () => {
    const datum = channelDatum();
    datum.state.packet_receipt = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL);

    expect(() => validateRecvPacketHistoryCapacity(datum)).toThrow(GrpcFailedPreconditionException);
  });

  it('rejects a receive when packet acknowledgement capacity is exhausted', () => {
    const datum = channelDatum(Order.Ordered);
    datum.state.packet_acknowledgement = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL);

    expect(() => validateRecvPacketHistoryCapacity(datum)).toThrow(GrpcFailedPreconditionException);
  });

  it('rejects insertion when the combined packet collections exhaust capacity', () => {
    const datum = channelDatum();
    datum.state.packet_receipt = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL / 2);
    datum.state.packet_acknowledgement = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL / 2);

    expect(() => validateSendPacketCommitmentCapacity(datum)).toThrow(GrpcFailedPreconditionException);
    expect(() => validateRecvPacketHistoryCapacity(datum)).toThrow(GrpcFailedPreconditionException);
  });

  it('allows an ordered receive when one combined entry remains', () => {
    const datum = channelDatum(Order.Ordered);
    datum.state.packet_receipt = packetEntries(MAX_PACKET_ENTRIES_PER_CHANNEL - 1);

    expect(() => validateRecvPacketHistoryCapacity(datum)).not.toThrow();
  });
});
