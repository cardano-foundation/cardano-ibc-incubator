const channelDatumMock = {
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
    packet_receipt: new Map(),
    packet_acknowledgement: new Map(),
  },
  port: '706f72742d3939',
  token: {
    policyId: 'e1597bf17341dbdaf9df6b78bddaeef7927367a162c1decb8ee524f4',
    name: '72ecb81086ac8ac39d25ede0ddbc24eab0ae7ee3239b722030',
  },
};

export { channelDatumMock };
