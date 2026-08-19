import { ChannelDatum } from '../../shared/types/channel/channel-datum';
import { Order } from '../../shared/types/channel/order';
import { ChannelState } from '../../shared/types/channel/state';
import { channelDatumAfterTimeout } from '../packet.service';

function channelDatum(ordering: Order): ChannelDatum {
  return {
    port: Buffer.from('transfer').toString('hex'),
    token: { policyId: 'aa', name: 'bb' },
    state: {
      channel: {
        state: ChannelState.Open,
        ordering,
        counterparty: { port_id: 'aa', channel_id: 'bb' },
        connection_hops: ['cc'],
        version: 'dd',
      },
      next_sequence_send: 1n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
    },
  };
}

describe('channelDatumAfterTimeout', () => {
  it('closes an ordered channel after a timeout without mutating the input datum', () => {
    const input = channelDatum(Order.Ordered);

    const output = channelDatumAfterTimeout(input);

    expect(output.state.channel.state).toBe('Closed');
    expect(input.state.channel.state).toBe('Open');
  });

  it('leaves an unordered channel open after a timeout', () => {
    const input = channelDatum(Order.Unordered);

    expect(channelDatumAfterTimeout(input)).toBe(input);
    expect(input.state.channel.state).toBe('Open');
  });
});
