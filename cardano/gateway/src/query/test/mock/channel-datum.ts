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
    packet_commitment: new Map([[1n, '9a888e6fcbf89e9a0c461a84f448f5efb68791db772fd6426b48d34f7288b5fd']]),
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
    // improve this code to init value map
    packet_acknowledgement: new Map([
      [2n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [4n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [5n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [6n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [7n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [8n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [9n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [13n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [14n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [15n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [16n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
      [17n, '08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c'],
    ]),
  },
  port: '706f72742d3939',
  token: {
    policyId: 'e1597bf17341dbdaf9df6b78bddaeef7927367a162c1decb8ee524f4',
    name: '72ecb81086ac8ac39d25ede0ddbc24eab0ae7ee3239b722030',
  },
};

export { channelDatumMock };
