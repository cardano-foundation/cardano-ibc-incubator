import { ChannelDatum } from '../../shared/types/channel/channel-datum';
import { Order } from '../../shared/types/channel/order';
import { ChannelState } from '../../shared/types/channel/state';
import { channelDatumAfterAcknowledgement } from '../packet.service';

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
      next_sequence_send: 4n,
      next_sequence_recv: 5n,
      next_sequence_ack: 6n,
    },
  };
}

describe('channelDatumAfterAcknowledgement', () => {
  it('increments next_sequence_ack for an ordered channel without mutating the input', () => {
    const input = channelDatum(Order.Ordered);

    const output = channelDatumAfterAcknowledgement(input);

    expect(output.state.next_sequence_ack).toBe(7n);
    expect(input.state.next_sequence_ack).toBe(6n);
    expect(output.state.next_sequence_send).toBe(4n);
    expect(output.state.next_sequence_recv).toBe(5n);
  });

  it('leaves an unordered channel sequence unchanged', () => {
    const input = channelDatum(Order.Unordered);

    expect(channelDatumAfterAcknowledgement(input)).toBe(input);
    expect(input.state.next_sequence_ack).toBe(6n);
  });
});
