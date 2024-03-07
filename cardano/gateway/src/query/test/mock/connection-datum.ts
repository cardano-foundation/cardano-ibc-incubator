const connectionDatumMock = {
  state: {
    client_id: '6962635f636c69656e742d333535',
    versions: [
      {
        identifier: '31',
        features: ['4f524445525f4f524445524544', '4f524445525f554e4f524445524544'],
      },
    ],
    state: 'Init',
    counterparty: {
      client_id: '3039392d63617264616e6f2d3234',
      connection_id: '',
      prefix: { key_prefix: '696263' },
    },
    delay_period: 0n,
  },
  token: {
    policyId: '8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff',
    name: '94051031ba171ddc7783efe491f76b4d2f1ba64019dd9b30323535',
  },
};

export { connectionDatumMock };
