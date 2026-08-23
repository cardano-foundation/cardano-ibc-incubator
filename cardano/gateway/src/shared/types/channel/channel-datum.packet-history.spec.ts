import * as Lucid from '@lucid-evolution/lucid';
import { ChannelDatum, decodeChannelDatum, encodeChannelDatum } from './channel-datum';
import { ChannelState } from './state';
import { Order } from './order';

describe('ChannelDatum appended fields', () => {
  it('round-trips proof heights and voucher supply without changing packet maps', async () => {
    const datum: ChannelDatum = {
      state: {
        channel: {
          state: ChannelState.Open,
          ordering: Order.Unordered,
          counterparty: {
            port_id: Buffer.from('transfer').toString('hex'),
            channel_id: Buffer.from('channel-7').toString('hex'),
          },
          connection_hops: [Buffer.from('connection-0').toString('hex')],
          version: Buffer.from('ics20-1').toString('hex'),
        },
        next_sequence_send: 4n,
        next_sequence_recv: 5n,
        next_sequence_ack: 6n,
        packet_commitment: new Map([[1n, 'aa']]),
        packet_receipt: new Map([[2n, '']]),
        packet_acknowledgement: new Map([[2n, 'bb']]),
        minimum_receive_proof_height: { revisionNumber: 1n, revisionHeight: 20n },
        maximum_receive_proof_height: { revisionNumber: 1n, revisionHeight: 30n },
      },
      port: Buffer.from('transfer').toString('hex'),
      token: { policyId: '11'.repeat(28), name: '22' },
      lifecycle: 'ChannelActive',
      voucher_supply: 12n,
    };

    const encoded = await encodeChannelDatum(datum, Lucid);
    const decoded = await decodeChannelDatum(encoded, Lucid);

    expect(decoded).toEqual(datum);
  });
});
