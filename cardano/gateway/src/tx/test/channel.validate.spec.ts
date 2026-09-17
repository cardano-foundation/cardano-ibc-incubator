import {
  MsgChannelCloseConfirm,
  MsgChannelCloseInit,
  MsgChannelOpenAck,
  MsgChannelOpenConfirm,
  MsgChannelOpenInit,
  MsgChannelOpenTry,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { Channel, Order as ChannelOrder } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import { MerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { Order } from '@shared/types/channel/order';
import {
  validateAndFormatChannelCloseConfirmParams,
  validateAndFormatChannelCloseInitParams,
  validateAndFormatChannelOpenAckParams,
  validateAndFormatChannelOpenConfirmParams,
  validateAndFormatChannelOpenInitParams,
  validateAndFormatChannelOpenTryParams,
} from '../helper/channel.validate';

const signer = 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql';
const proofHeight = { revision_number: 0n, revision_height: 10n };
// Exercise the real protobuf decoder and proof formatter without mocking either dependency.
const proof = MerkleProof.encode(
  MerkleProof.fromPartial({
    proofs: [{ exist: { key: new Uint8Array([1]), value: new Uint8Array([2]), leaf: {}, path: [] } }],
  }),
).finish();

function channel(overrides: Partial<Channel> = {}): Channel {
  return Channel.fromPartial({
    ordering: ChannelOrder.ORDER_UNORDERED,
    counterparty: { port_id: 'transfer', channel_id: 'channel-1' },
    connection_hops: ['connection-0'],
    version: 'ics20-1',
    ...overrides,
  });
}

function openTryRequest(channel: Channel): MsgChannelOpenTry {
  return MsgChannelOpenTry.fromPartial({
    port_id: 'transfer',
    channel,
    counterparty_version: 'ics20-1',
    proof_init: proof,
    proof_height: proofHeight,
    signer,
  });
}

describe.each([
  {
    name: 'ChannelOpenInit',
    format: (channel: Channel) =>
      validateAndFormatChannelOpenInitParams(MsgChannelOpenInit.fromPartial({ port_id: 'transfer', channel, signer }))
        .channelOpenInitOperator,
  },
  {
    name: 'ChannelOpenTry',
    format: (channel: Channel) => validateAndFormatChannelOpenTryParams(openTryRequest(channel)).channelOpenTryOperator,
  },
])('$name request validation', ({ format }) => {
  it.each([
    [ChannelOrder.ORDER_UNORDERED, Order.Unordered],
    [ChannelOrder.ORDER_ORDERED, Order.Ordered],
  ])('preserves ordering %s', (ordering, expected) => {
    const result = format(channel({ ordering }));

    expect(result.ordering).toBe(expected);
    expect(result.connectionId).toBe('connection-0');
  });

  it.each([ChannelOrder.ORDER_NONE_UNSPECIFIED, ChannelOrder.UNRECOGNIZED, 3, 99])(
    'rejects unsupported ordering %s',
    (ordering) => {
      const validate = () => format(channel({ ordering }));
      expect(validate).toThrow(GrpcInvalidArgumentException);
      expect(validate).toThrow('channel.ordering');
    },
  );

  it.each([[], ['connection-0', 'connection-1'], ['connection-0', 'connection-0']].map((hops) => ({ hops })))(
    'rejects connection_hops $hops instead of dropping entries',
    ({ hops }) => {
      const validate = () => format(channel({ connection_hops: hops }));
      expect(validate).toThrow(GrpcInvalidArgumentException);
      expect(validate).toThrow('connection_hops');
    },
  );

  it.each(['', '0', 'connection-', 'connection-connection-0', 'connection-00', 'connection-0x10'])(
    'rejects malformed connection hop %j',
    (connectionId) => {
      expect(() => format(channel({ connection_hops: [connectionId] }))).toThrow(GrpcInvalidArgumentException);
    },
  );
});

it('decodes and preserves the ChannelOpenTry proof alongside the requested ordering', () => {
  const result = validateAndFormatChannelOpenTryParams(
    openTryRequest(channel({ ordering: ChannelOrder.ORDER_ORDERED })),
  );

  expect(result.channelOpenTryOperator).toMatchObject({
    ordering: Order.Ordered,
    proofHeight: { revisionNumber: 0n, revisionHeight: 10n },
    proofInit: {
      proofs: [{ proof: { CommitmentProof_Exist: { exist: { key: '01', value: '02' } } } }],
    },
  });
});

describe.each([
  {
    name: 'ChannelOpenAck',
    sequence: (channel_id: string) =>
      validateAndFormatChannelOpenAckParams(
        MsgChannelOpenAck.fromPartial({ channel_id, signer, proof_try: proof, proof_height: proofHeight }),
      ).channelOpenAckOperator.channelSequence,
  },
  {
    name: 'ChannelOpenConfirm',
    sequence: (channel_id: string) =>
      validateAndFormatChannelOpenConfirmParams(
        MsgChannelOpenConfirm.fromPartial({ channel_id, signer, proof_ack: proof, proof_height: proofHeight }),
      ).channelOpenConfirmOperator.channelSequence,
  },
  {
    name: 'ChannelCloseInit',
    sequence: (channel_id: string) =>
      validateAndFormatChannelCloseInitParams(MsgChannelCloseInit.fromPartial({ channel_id, signer }))
        .channelCloseInitOperator.channel_id,
  },
  {
    name: 'ChannelCloseConfirm',
    sequence: (channel_id: string) =>
      validateAndFormatChannelCloseConfirmParams(
        MsgChannelCloseConfirm.fromPartial({ channel_id, signer, proof_init: proof, proof_height: proofHeight }),
      ).channelCloseConfirmOperator.channelSequence,
  },
])('$name channel identifier validation', ({ sequence }) => {
  it.each(['0', '7', '123', '9007199254740993'])('preserves channel sequence %s', (expected) => {
    expect(sequence(`channel-${expected}`)).toBe(expected);
  });

  it.each([
    '',
    '0',
    'connection-0',
    'channel-',
    'channel-channel-0',
    'channel-0channel-',
    'channel-1channel-2',
    'channel--1',
    'channel-+1',
    'channel-01',
    'channel-0x10',
    'channel-1.5',
    'channel- 1',
    'channel-1\n',
  ])('rejects malformed channel_id %j', (channelId) => {
    const validate = () => sequence(channelId);
    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('channel_id');
  });
});
