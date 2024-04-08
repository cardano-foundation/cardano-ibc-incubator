class ChannelDatumMockBuilder {
  private channelDatumMock: any;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.channelDatumMock = {
      state: {
        channel: {
          state: 'Init',
          ordering: 'Unordered',
          counterparty: { port_id: '62616e6b', channel_id: '' },
          connection_hops: ['636f6e6e656374696f6e2d30'],
          version: '69637332302d31',
        },
        next_sequence_send: 1n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map(),
        packet_receipt: new Map([
          [0n, ''],
          [4n, ''],
          [5n, ''],
          [6n, ''],
          [7n, ''],
          [8n, ''],
          [9n, ''],
          [13n, ''],
          [14n, ''],
          [15n, ''],
          [16n, ''],
          [17n, ''],
        ]),
        packet_acknowledgement: new Map(), // Initialize empty map
      },
      port: '706f72742d3939',
      token: {
        policyId: 'e1597bf17341dbdaf9df6b78bddaeef7927367a162c1decb8ee524f4',
        name: '72ecb81086ac8ac39d25ede0ddbc24eab0ae7ee3239b722030',
      },
    };
  }
  withChannelState(state: string): ChannelDatumMockBuilder {
    this.channelDatumMock.state.channel.state = state;
    return this;
  }
  reset(): void {
    this.setDefault();
  }

  build(): any {
    const builtChannelDatumMock = { ...this.channelDatumMock };
    this.reset();
    return builtChannelDatumMock;
  }
}

const channelDatumMockBuilder = new ChannelDatumMockBuilder();

export default channelDatumMockBuilder;
